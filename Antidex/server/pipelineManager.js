const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { PipelineStateStore } = require("./pipelineStateStore");
const { CodexAppServerClient } = require("../../Local_Codex_appserver/server/codexAppServerClient");

const DEFAULT_SANDBOX = "danger-full-access";
const DEFAULT_APPROVAL_POLICY = "never";

const TURN_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_AUTO_ITERATIONS = 10;
const CANONICAL_DOCS_RULES_PATH = path.resolve(__dirname, "..", "..", "doc", "DOCS_RULES.md");
const LOCAL_AGENTS_DOCS_RULES_PATH = path.resolve(__dirname, "..", "..", "..", "doc", "DOCS_RULES.md");
const AGENT_TEMPLATES_DIR = path.resolve(__dirname, "..", "doc", "agent_instruction_templates");
const GIT_WORKFLOW_TEMPLATE_PATH = path.resolve(__dirname, "..", "doc", "GIT_WORKFLOW.md");

function nowIso() {
  return new Date().toISOString();
}

function nowIsoForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function withTimeout(promise, ms, label) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(label || "timeout")), ms);
    timeoutId.unref?.();
  });
  return Promise.race([
    promise.finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    }),
    timeout,
  ]);
}

function safeErrorMessage(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileIfMissing(filePath, content) {
  if (fs.existsSync(filePath)) return false;
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

function fileExists(p) {
  try {
    return !!p && fs.existsSync(p);
  } catch {
    return false;
  }
}

function readTextHead(p, maxChars = 2000) {
  try {
    const raw = fs.readFileSync(p, "utf8");
    return raw.length > maxChars ? raw.slice(0, maxChars) : raw;
  } catch {
    return null;
  }
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function writeJsonIfMissing(filePath, value) {
  if (fs.existsSync(filePath)) return false;
  writeJsonAtomic(filePath, value);
  return true;
}

function readTextIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function applyUpdatedAt(template, iso) {
  let out = String(template || "");
  out = out.replace(/<ISO>/g, iso);
  if (out.match(/^updated_at:/m)) {
    out = out.replace(/^updated_at:.*$/m, `updated_at: ${iso}`);
  } else if (out.match(/^version:/m)) {
    out = out.replace(/^version:.*$/m, (line) => `${line}\nupdated_at: ${iso}`);
  } else {
    out = `updated_at: ${iso}\n` + out;
  }
  return out;
}

function copyTemplateIfMissing({ sourcePath, targetPath, transform }) {
  if (fs.existsSync(targetPath)) return false;
  const raw = readTextIfExists(sourcePath);
  if (raw === null) return false;
  const content = typeof transform === "function" ? transform(raw) : raw;
  ensureDir(path.dirname(targetPath));
  fs.writeFileSync(targetPath, content, "utf8");
  return true;
}

function normalizePathForMd(p) {
  return String(p || "").replace(/\\/g, "/");
}

function relPathForPrompt(cwd, filePath) {
  try {
    const rel = path.relative(cwd, filePath);
    if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) return normalizePathForMd(filePath);
    return normalizePathForMd(rel);
  } catch {
    return normalizePathForMd(filePath);
  }
}

function buildReadFirstHeader({ role, turnNonce, readPaths, writePaths, notes }) {
  const lines = [`READ FIRST (role: ${role})`];
  if (turnNonce) lines.push(`turn_nonce: ${turnNonce}`);
  if (readPaths?.length) {
    lines.push("Read:");
    for (const p of readPaths) lines.push(`- ${p}`);
  }
  if (writePaths?.length) {
    lines.push("Write:");
    for (const p of writePaths) lines.push(`- ${p}`);
  }
  if (notes?.length) {
    lines.push("Rules:");
    for (const n of notes) lines.push(`- ${n}`);
  }
  return lines.join("\n");
}

function taskContext(run) {
  const tasksRoot = run.projectTasksDir || path.join(run.cwd, "data", "tasks");
  const taskId = run.currentTaskId || "<current_task_id>";
  const taskDir = path.join(tasksRoot, taskId);
  return {
    taskId,
    taskDir,
    taskDirRel: relPathForPrompt(run.cwd, taskDir),
  };
}

function turnMarkerPaths(run, turnNonce) {
  const dirAbs = run.projectTurnMarkersDir || path.join(run.cwd, "data", "turn_markers");
  const doneAbs = path.join(dirAbs, `${turnNonce}.done`);
  const tmpAbs = path.join(dirAbs, `${turnNonce}.tmp`);
  return {
    dirAbs,
    doneAbs,
    tmpAbs,
    doneRel: relPathForPrompt(run.cwd, doneAbs),
    tmpRel: relPathForPrompt(run.cwd, tmpAbs),
  };
}

function ensureProjectDocs({ cwd, runId, threadPolicy }) {
  const created = [];
  const existing = [];

  const mark = (p, didCreate) => {
    if (!p) return;
    (didCreate ? created : existing).push(p);
  };

  const ensureDirTracked = (dirPath) => {
    const existed = fs.existsSync(dirPath);
    ensureDir(dirPath);
    mark(dirPath, !existed);
  };

  const docDir = path.join(cwd, "doc");
  const agentsDir = path.join(cwd, "agents");
  const dataDir = path.join(cwd, "data");
  const tasksDir = path.join(dataDir, "tasks");
  const mailboxDir = path.join(dataDir, "mailbox");
  const mailboxToCodex = path.join(mailboxDir, "to_developer_codex");
  const mailboxFromCodex = path.join(mailboxDir, "from_developer_codex");
  const mailboxToAg = path.join(mailboxDir, "to_developer_antigravity");
  const mailboxFromAg = path.join(mailboxDir, "from_developer_antigravity");
  const agRunsDir = path.join(dataDir, "antigravity_runs");
  const agReportsDir = path.join(dataDir, "AG_internal_reports");
  const turnMarkersDir = path.join(dataDir, "turn_markers");

  ensureDirTracked(docDir);
  ensureDirTracked(agentsDir);
  ensureDirTracked(dataDir);
  ensureDirTracked(tasksDir);
  ensureDirTracked(mailboxDir);
  ensureDirTracked(mailboxToCodex);
  ensureDirTracked(mailboxFromCodex);
  ensureDirTracked(mailboxToAg);
  ensureDirTracked(mailboxFromAg);
  ensureDirTracked(agRunsDir);
  ensureDirTracked(agReportsDir);
  ensureDirTracked(turnMarkersDir);

  const docsRulesSource = fs.existsSync(LOCAL_AGENTS_DOCS_RULES_PATH) ? LOCAL_AGENTS_DOCS_RULES_PATH : CANONICAL_DOCS_RULES_PATH;
  const projectRulesPath = path.join(docDir, "DOCS_RULES.md");
  const canonical = normalizePathForMd(docsRulesSource);
  mark(
    projectRulesPath,
    writeFileIfMissing(
      projectRulesPath,
      [
        "# Documentation Rules (Project)",
        "",
        "This project follows the canonical documentation rules:",
        `- ${canonical}`,
        "",
        "Minimum rules (summary):",
        "- Keep doc/INDEX.md updated when you create/rename/move a documentation file.",
        "- Start work by writing/updating: doc/SPEC.md + doc/TODO.md + doc/TESTING_PLAN.md.",
        "- During implementation, record important decisions in doc/DECISIONS.md.",
        "",
      ].join("\n"),
    ),
  );

  const projectIndexPath = path.join(docDir, "INDEX.md");
  mark(
    projectIndexPath,
    writeFileIfMissing(
      projectIndexPath,
      [
        "# Documentation Index (Project)",
        "",
        "Regle: maintain this file. See doc/DOCS_RULES.md.",
        "",
        "- `doc/DOCS_RULES.md` - Doc writing rules (canonical pointer). (owner: Both)",
        "- `doc/INDEX.md` - This index. (owner: Both)",
        "- `doc/SPEC.md` - Main spec / requirements. (owner: Manager)",
        "- `doc/TODO.md` - Prioritized TODO / backlog. (owner: Manager)",
        "- `doc/TESTING_PLAN.md` - Test plan + checklist. (owner: Manager)",
        "- `doc/DECISIONS.md` - Decision log. (owner: Manager)",
        "- `doc/GIT_WORKFLOW.md` - Git/GitHub policy (commit after ACCEPTED). (owner: Manager)",
        "- `data/pipeline_state.json` - Runtime marker + pointers. (owner: Manager)",
        "- `data/tasks/` - Task folders (task.md/dev_result/review/Q-A). (owner: Manager/Dev)",
        "- `data/mailbox/` - Q/A pointers. (owner: Both)",
        "- `data/antigravity_runs/` - AG run artifacts. (owner: AG)",
        "- `data/AG_internal_reports/` - AG internal reports (heartbeat, walkthrough). (owner: AG)",
        "- `data/recovery_log.jsonl` - watchdog log. (owner: Manager)",
        "",
      ].join("\n"),
    ),
  );

  mark(
    path.join(docDir, "SPEC.md"),
    writeFileIfMissing(path.join(docDir, "SPEC.md"), ["# SPEC", "", "Context:", "- (to be written)", "", "Acceptance criteria:", "- (to be written)", ""].join("\n")),
  );
  mark(
    path.join(docDir, "TODO.md"),
    writeFileIfMissing(path.join(docDir, "TODO.md"), ["# TODO", "", "Format:", "- [ ] P0 (Owner) Task (proof: files/tests)", ""].join("\n")),
  );
  mark(
    path.join(docDir, "TESTING_PLAN.md"),
    writeFileIfMissing(path.join(docDir, "TESTING_PLAN.md"), ["# Testing Plan", "", "Checklist:", "- [ ] (to be written)", ""].join("\n")),
  );
  mark(
    path.join(docDir, "DECISIONS.md"),
    writeFileIfMissing(path.join(docDir, "DECISIONS.md"), ["# Decisions", "", "- YYYY-MM-DD: (decision) (rationale)", ""].join("\n")),
  );

  const gitWorkflowPath = path.join(docDir, "GIT_WORKFLOW.md");
  const gitWorkflowCreated = copyTemplateIfMissing({
    sourcePath: GIT_WORKFLOW_TEMPLATE_PATH,
    targetPath: gitWorkflowPath,
  });
  if (!gitWorkflowCreated) {
    mark(
      gitWorkflowPath,
      writeFileIfMissing(
        gitWorkflowPath,
        ["# Git Workflow", "", "- Commit only after Manager ACCEPTED.", "- Format: [T-xxx] Summary", ""].join("\n"),
      ),
    );
  } else {
    mark(gitWorkflowPath, true);
  }

  const iso = nowIso();
  const agentTemplates = [
    { name: "manager.md" },
    { name: "developer_codex.md" },
    { name: "developer_antigravity.md" },
    { name: "AG_cursorrules.md" },
  ];
  for (const tmpl of agentTemplates) {
    const sourcePath = path.join(AGENT_TEMPLATES_DIR, tmpl.name);
    const targetPath = path.join(agentsDir, tmpl.name);
    const didCopy = copyTemplateIfMissing({
      sourcePath,
      targetPath,
      transform: (raw) => applyUpdatedAt(raw, iso),
    });
    if (fs.existsSync(targetPath)) mark(targetPath, didCopy);
  }

  const pipelineStatePath = path.join(dataDir, "pipeline_state.json");
  const initialState = {
    run_id: runId || null,
    iteration: 0,
    phase: "planning",
    current_task_id: null,
    assigned_developer: null,
    thread_policy: threadPolicy || {
      manager: "reuse",
      developer_codex: "reuse",
      developer_antigravity: "reuse",
    },
    developer_status: "idle",
    manager_decision: null,
    summary: "initialized",
    tests: { ran: false, passed: false, notes: "" },
    updated_at: nowIso(),
  };
  mark(pipelineStatePath, writeJsonIfMissing(pipelineStatePath, initialState));

  const recoveryLogPath = path.join(dataDir, "recovery_log.jsonl");
  mark(recoveryLogPath, writeFileIfMissing(recoveryLogPath, ""));

  return {
    created,
    existing,
    docDir,
    agentsDir,
    dataDir,
    tasksDir,
    turnMarkersDir,
    projectRulesPath,
    projectIndexPath,
    gitWorkflowPath,
    pipelineStatePath,
    recoveryLogPath,
  };
}

function readJsonBestEffort(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, value: null };
    let raw = fs.readFileSync(filePath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: safeErrorMessage(e) };
  }
}

function clampString(value, maxLen) {
  const s = String(value ?? "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n[...truncated]\n";
}

function normalizeDeveloperStatus(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "ready_for_review") return "ready_for_review";
  if (v === "ongoing") return "ongoing";
  if (v === "blocked") return "blocked";
  if (v === "failed") return "failed";
  if (v === "idle") return "idle";
  return null;
}

function normalizeManagerDecision(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "completed" || v === "done") return "completed";
  if (v === "continue") return "continue";
  if (v === "blocked") return "blocked";
  return null;
}

function normalizeThreadPolicy(input) {
  const base = {
    manager: "reuse",
    developer_codex: "reuse",
    developer_antigravity: "reuse",
  };
  if (!input || typeof input !== "object") return base;
  const pick = (value) => (value === "new_per_task" ? "new_per_task" : "reuse");
  return {
    manager: pick(input.manager),
    developer_codex: pick(input.developer_codex),
    developer_antigravity: pick(input.developer_antigravity),
  };
}

function extractRpcErrorMessage(err) {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || "";
  const maybeMessage = err.message || err.error?.message || err.data?.message;
  if (typeof maybeMessage === "string") return maybeMessage;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function parseSupportedEffortsFromError(message) {
  const m = String(message || "").match(/Supported values:\s*([^\n]+)/i);
  if (!m) return [];
  const raw = m[1] || "";
  const parts = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const known = new Set(["none", "low", "medium", "high", "xhigh"]);
  return parts.filter((p) => known.has(p));
}

function pickMaxEffort(list) {
  const order = { none: 0, low: 1, medium: 2, high: 3, xhigh: 4 };
  let best = null;
  let bestScore = -1;
  for (const e of list) {
    const s = order[e];
    if (s === undefined) continue;
    if (s > bestScore) {
      bestScore = s;
      best = e;
    }
  }
  return best;
}

function matchesActive(active, params) {
  if (!params || typeof params !== "object") return false;
  const tid = params.threadId ? String(params.threadId) : null;
  const turnId = params.turnId ? String(params.turnId) : null;
  const completedTurnId = params.turn?.id ? String(params.turn.id) : null;

  if (active.threadId && tid && tid !== active.threadId) return false;
  if (active.turnId && turnId && turnId !== active.turnId) return false;
  if (active.turnId && completedTurnId && completedTurnId !== active.turnId) return false;
  return true;
}

class PipelineManager extends EventEmitter {
  constructor({ dataDir }) {
    super();
    this._dataDir = dataDir;
    ensureDir(this._dataDir);
    this._logsDir = path.join(this._dataDir, "logs");
    ensureDir(this._logsDir);

    this._state = new PipelineStateStore({ filePath: path.join(this._dataDir, "pipeline_state.json") });
    this._codex = new CodexAppServerClient({ trace: false });
    this._initialized = false;

    this._active = null; // active turn descriptor
    this._runningRunId = null;
    this._stopRequested = new Set();

    this._codex.on("notification", (msg) => this._onNotification(msg));
  }

  async _ensureCodex() {
    if (this._initialized && this._codex.isRunning()) return;
    await withTimeout(this._codex.start({ cwd: this._dataDir }), 30_000, "codex start timed out");
    await withTimeout(this._codex.initialize({}), 30_000, "codex initialize timed out");
    this._initialized = true;
  }

  _newRunId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  }

  _newTurnNonce() {
    // Keep it file-name safe and shortish while still unique.
    const id = this._newRunId().replace(/-/g, "");
    return `turn-${id.slice(0, 20)}`;
  }

  _verifyTurnMarker({ run, marker }) {
    if (!marker?.doneAbs) return { ok: true };
    if (!fileExists(marker.doneAbs)) return { ok: false, reason: `Missing turn marker: ${marker.doneRel}` };
    const head = readTextHead(marker.doneAbs, 64);
    if (!head || !head.trim().toLowerCase().startsWith("ok")) {
      return { ok: false, reason: `Invalid turn marker content in ${marker.doneRel} (expected 'ok')` };
    }
    return { ok: true };
  }

  async _runTurnWithHandshake({ runId, role, step, threadId, model, buildPrompt, verifyPostconditions, maxAttempts = 2 }) {
    const baseRun = this._getRunRequired(runId);
    const turnNonce = this._newTurnNonce();
    const marker = turnMarkerPaths(baseRun, turnNonce);
    let lastReason = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const run = this._getRunRequired(runId);
      const prompt = buildPrompt({ run, turnNonce, marker, retryReason: attempt > 1 ? lastReason : null, attempt });
      const result = await this._runTurn({ runId, role, step: attempt === 1 ? step : `${step}_retry${attempt - 1}`, threadId, model, prompt });
      if (result.turnStatus === "failed") return { ok: false, failed: true, errorMessage: result.errorMessage || "turn failed" };

      await this._syncFromProjectState(runId);
      const after = this._getRunRequired(runId);

      const markerCheck = this._verifyTurnMarker({ run: after, marker });
      if (!markerCheck.ok) {
        lastReason = markerCheck.reason;
        continue;
      }

      const post = await verifyPostconditions({ run: after, marker });
      if (post?.ok) return { ok: true, turnNonce };
      lastReason = post?.reason || "Postconditions not met";
    }

    return { ok: false, failed: false, errorMessage: lastReason || "Postconditions not met" };
  }

  _emitRun(run) {
    this.emit("event", {
      runId: run.runId,
      event: "run",
      data: {
        runId: run.runId,
        status: run.status,
        iteration: run.iteration,
        developerStatus: run.developerStatus,
        managerDecision: run.managerDecision,
        updatedAt: run.updatedAt,
        lastError: run.lastError || null,
      },
    });
  }

  _setRun(runId, run) {
    run.updatedAt = nowIso();
    this._state.setRun(runId, run);
    this._emitRun(run);
  }

  _getRunRequired(runId) {
    const run = this._state.getRun(runId);
    if (!run) throw new Error("run not found");
    return run;
  }

  getRun(runId) {
    return this._state.getRun(runId);
  }

  listRuns() {
    return this._state
      .listRuns()
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

  async startPipeline(opts) {
    await this._ensureCodex();

    const cwd = String(opts?.cwd || "").trim();
    const userPrompt = String(opts?.userPrompt || "");
    const managerModel = String(opts?.managerModel || "").trim();
    const developerModel = String(opts?.developerModel || "").trim();
    const managerPreprompt = String(opts?.managerPreprompt || "");
    const developerPreprompt = opts?.developerPreprompt ? String(opts.developerPreprompt) : null;
    const autoRun = opts?.autoRun !== false;
    const threadPolicy = normalizeThreadPolicy(opts?.threadPolicy);

    if (!cwd) throw new Error("cwd is required");
    if (!userPrompt.trim()) throw new Error("userPrompt is required");
    if (!managerModel) throw new Error("managerModel is required");
    if (!developerModel) throw new Error("developerModel is required");
    if (!managerPreprompt.trim()) throw new Error("managerPreprompt is required");

    const estimatedLength = userPrompt.length + managerPreprompt.length;
    const MAX_PROMPT_LENGTH = 500_000; // ~500k chars safety limit
    if (estimatedLength > MAX_PROMPT_LENGTH) {
      throw new Error(`Combined prompt length (${estimatedLength}) exceeds safety limit (${MAX_PROMPT_LENGTH})`);
    }

    if (this._runningRunId) throw new Error("Another pipeline is already running");

    const runId = this._newRunId();
    const bootstrap = ensureProjectDocs({
      cwd,
      runId,
      threadPolicy,
    });
    const { docDir: projectDocDir, dataDir: projectDataDir, agentsDir, tasksDir, turnMarkersDir, projectRulesPath, projectIndexPath, gitWorkflowPath, pipelineStatePath, recoveryLogPath } =
      bootstrap;
    const run = {
      runId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "planning", // planning | implementing | reviewing | completed | failed | stopped
      iteration: 0,
      cwd,
      managerModel,
      developerModel,
      managerPreprompt,
      developerPreprompt,
      userPrompt,
      threadPolicy,
      managerThreadId: null,
      developerThreadId: null,
      developerThreadTaskId: null,
      managerRolloutPath: null,
      developerRolloutPath: null,
      logFiles: [],
      developerStatus: "idle", // idle | ongoing | ready_for_review | blocked | failed
      managerDecision: null, // continue | completed | blocked | null
      projectDocRulesPath: projectRulesPath,
      projectDocIndexPath: projectIndexPath,
      projectAgentsDir: agentsDir,
      projectManagerInstructionPath: path.join(agentsDir, "manager.md"),
      projectDeveloperInstructionPath: path.join(agentsDir, "developer_codex.md"),
      projectDeveloperAgInstructionPath: path.join(agentsDir, "developer_antigravity.md"),
      projectAgCursorRulesPath: path.join(agentsDir, "AG_cursorrules.md"),
      projectSpecPath: path.join(projectDocDir, "SPEC.md"),
      projectTodoPath: path.join(projectDocDir, "TODO.md"),
      projectTestingPlanPath: path.join(projectDocDir, "TESTING_PLAN.md"),
      projectDecisionsPath: path.join(projectDocDir, "DECISIONS.md"),
      projectGitWorkflowPath: gitWorkflowPath,
      projectTasksDir: tasksDir,
      projectTurnMarkersDir: turnMarkersDir,
      projectMailboxDir: path.join(projectDataDir, "mailbox"),
      projectPipelineStatePath: pipelineStatePath,
      projectRecoveryLogPath: recoveryLogPath,
      currentTaskId: null,
      assignedDeveloper: null,
      lastError: null,
    };

    this._state.setRun(runId, run);
    this._emitRun(run);

    if (bootstrap?.created?.length || bootstrap?.existing?.length) {
      const createdList = (bootstrap.created || []).map((p) => `+ ${normalizePathForMd(path.relative(run.cwd, p) || p)}`).join("\n");
      const existingList = (bootstrap.existing || []).map((p) => `= ${normalizePathForMd(path.relative(run.cwd, p) || p)}`).join("\n");
      const msgParts = [];
      if (createdList) msgParts.push("Bootstrap created:\n" + createdList);
      if (existingList) msgParts.push("Bootstrap existing:\n" + existingList);
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: msgParts.join("\n\n") },
      });
    }

    this._runningRunId = runId;
    this._stopRequested.delete(runId);

    if (autoRun) {
      void this.runAuto(runId).catch((e) => {
        const latest = this._state.getRun(runId);
        if (!latest) return;
        latest.status = "failed";
        latest.lastError = { message: safeErrorMessage(e), at: nowIso(), where: "auto" };
        this._setRun(runId, latest);
        this._runningRunId = null;
      });
    }

    return run;
  }

  async stopPipeline(runId) {
    const run = this._getRunRequired(runId);
    run.status = "stopped";
    run.lastError = run.lastError || { message: "Stopped by user", at: nowIso(), where: "stop" };
    this._setRun(runId, run);

    this._stopRequested.add(runId);
    if (this._active && this._active.runId === runId) {
      try {
        if (this._active.threadId && this._active.turnId) {
          await this._codex.turnInterrupt({ threadId: this._active.threadId, turnId: this._active.turnId });
        }
      } catch {
        // best-effort
      }
    }

    if (this._runningRunId === runId) this._runningRunId = null;
  }

  async continuePipeline(runId) {
    await this._ensureCodex();
    if (this._runningRunId && this._runningRunId !== runId) throw new Error("Another pipeline is already running");
    this._runningRunId = runId;
    this._stopRequested.delete(runId);
    return await this._advanceOneStep(runId);
  }

  async runAuto(runId) {
    await this._ensureCodex();
    let safety = 0;
    while (safety++ < 1000) {
      const run = this._getRunRequired(runId);
      if (this._stopRequested.has(runId) || run.status === "stopped") break;
      if (run.status === "completed" || run.status === "failed") break;

      if (run.iteration > MAX_AUTO_ITERATIONS) {
        run.status = "failed";
        run.lastError = { message: `Max iterations reached (${MAX_AUTO_ITERATIONS})`, at: nowIso(), where: "auto" };
        this._setRun(runId, run);
        break;
      }

      const changed = await this._advanceOneStep(runId);
      if (!changed) break; // paused (missing marker, blocked, etc.)
    }

    if (this._runningRunId === runId) this._runningRunId = null;
  }

  async _advanceOneStep(runId) {
    const run = this._getRunRequired(runId);

    if (run.status === "completed" || run.status === "failed" || run.status === "stopped") return false;

    if (run.status === "planning") {
      await this._stepManagerPlanning(runId);
      return true;
    }

    await this._syncFromProjectState(runId);
    const afterSync = this._getRunRequired(runId);
    if (afterSync.status === "failed" || afterSync.status === "stopped") return false;

    if (afterSync.status === "implementing") {
      if (!afterSync.currentTaskId) {
        afterSync.lastError = {
          message: `Missing current_task_id in ${afterSync.projectPipelineStatePath}`,
          at: nowIso(),
          where: "dispatch",
        };
        this._setRun(runId, afterSync);
        this.emit("event", {
          runId,
          event: "diag",
          data: { role: "system", type: "error", message: afterSync.lastError.message },
        });
        return false;
      }
      if (afterSync.developerStatus === "blocked") {
        await this._stepManagerAnswerQuestion(runId);
        return true;
      }
      if (afterSync.developerStatus === "ready_for_review") {
        afterSync.status = "reviewing";
        this._setRun(runId, afterSync);
        await this._stepManagerReview(runId);
        return true;
      }
      await this._stepDeveloper(runId);
      return true;
    }

    if (afterSync.status === "reviewing") {
      await this._stepManagerReview(runId);
      return true;
    }

    return false;
  }

  async _syncFromProjectState(runId) {
    const run = this._getRunRequired(runId);
    const p = run.projectPipelineStatePath;
    const r = readJsonBestEffort(p);
    if (!r.ok) {
      run.lastError = { message: `Invalid project pipeline_state.json: ${r.error}`, at: nowIso(), where: "sync" };
      this._setRun(runId, run);
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "error", message: run.lastError.message } });
      return;
    }
    if (!r.value || typeof r.value !== "object") return;

    const dev = normalizeDeveloperStatus(r.value.developer_status);
    const decision = normalizeManagerDecision(r.value.manager_decision);
    const phase = typeof r.value.phase === "string" ? String(r.value.phase) : null;
    const currentTaskId = typeof r.value.current_task_id === "string" ? String(r.value.current_task_id) : null;
    const assignedDeveloper = typeof r.value.assigned_developer === "string" ? String(r.value.assigned_developer) : null;
    const threadPolicy = r.value.thread_policy && typeof r.value.thread_policy === "object" ? normalizeThreadPolicy(r.value.thread_policy) : null;

    if (dev) run.developerStatus = dev;
    if (decision) run.managerDecision = decision;
    if (phase) run.projectPhase = phase;
    if (currentTaskId) run.currentTaskId = currentTaskId;
    if (assignedDeveloper) run.assignedDeveloper = assignedDeveloper;
    if (threadPolicy) run.threadPolicy = threadPolicy;
    if (typeof r.value.summary === "string") run.lastSummary = clampString(r.value.summary, 20_000);
    if (dev === "failed" && run.status !== "failed") {
      run.status = "failed";
      run.lastError = run.lastError || { message: "developer_status=failed in pipeline_state.json", at: nowIso(), where: "sync" };
    }
    this._setRun(runId, run);
  }

  async _ensureThread({ runId, role }) {
    const run = this._getRunRequired(runId);
    const cwd = run.cwd;
    const model = role === "manager" ? run.managerModel : run.developerModel;
    const threadKey = role === "manager" ? "managerThreadId" : "developerThreadId";
    const rolloutKey = role === "manager" ? "managerRolloutPath" : "developerRolloutPath";
    const existing = run[threadKey] ? String(run[threadKey]) : "";

    const sandbox = DEFAULT_SANDBOX;
    const approvalPolicy = DEFAULT_APPROVAL_POLICY;

    let shouldReuse = true;
    if (role === "developer") {
      const policy = run.threadPolicy?.developer_codex || "reuse";
      if (policy === "new_per_task" && run.currentTaskId) {
        if (!run.developerThreadTaskId || run.developerThreadTaskId !== run.currentTaskId) {
          shouldReuse = false;
        }
      }
    }

    let resp;
    if (existing && shouldReuse) resp = await this._codex.threadResume({ threadId: existing, cwd, sandbox, approvalPolicy, model });
    else resp = await this._codex.threadStart({ cwd, sandbox, approvalPolicy, model });

    const resolvedThreadId = String(resp?.thread?.id ?? resp?.threadId ?? "");
    if (!resolvedThreadId) throw new Error("thread/start|resume did not return thread.id");
    if (!run[threadKey] || run[threadKey] !== resolvedThreadId) run[threadKey] = resolvedThreadId;
    const rolloutPath = resp?.thread?.path ? String(resp.thread.path) : null;
    if (rolloutPath) run[rolloutKey] = rolloutPath;
    if (role === "developer") run.developerThreadTaskId = run.currentTaskId || null;
    this._setRun(runId, run);
    return resolvedThreadId;
  }

  _buildManagerPlanningPrompt(run, { turnNonce, retryReason } = {}) {
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const gitWorkflowPath = relPathForPrompt(run.cwd, run.projectGitWorkflowPath || path.join(run.cwd, "doc", "GIT_WORKFLOW.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);

    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        relPathForPrompt(run.cwd, run.projectManagerInstructionPath || path.join(run.cwd, "agents", "manager.md")),
        docsRules,
        docsIndex,
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        gitWorkflowPath,
        pipelineStatePath,
      ],
      writePaths: [
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        docsIndex,
        pipelineStatePath,
        "data/tasks/T-xxx_<slug>/task.md",
        "data/tasks/T-xxx_<slug>/manager_instruction.md",
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "doc/TODO.md is user-editable; reread before each dispatch and after each task.",
        "If you change agents/*.md, bump version+updated_at and log in doc/DECISIONS.md.",
        ...(marker
          ? [
              `TURN COMPLETION MARKER (required): write ${marker.tmpRel} then rename to ${marker.doneRel} with content 'ok' as the LAST step of this turn.`,
            ]
          : []),
        "Do NOT implement code in this step (planning only).",
      ],
    });

    const protocol =
      "\n\nPlanning protocol (MUST DO):" +
      "\n1) Update SPEC/TODO/TESTING_PLAN/DECISIONS and keep doc/INDEX.md current." +
      "\n2) Create task folders under data/tasks/T-xxx_<slug>/ with task.md + manager_instruction.md." +
      "\n3) Ensure each task has a Definition of Done + assigned developer." +
      `\n4) Update ${pipelineStatePath} with current_task_id, assigned_developer, thread_policy, developer_status=\"ongoing\", manager_decision=null, updated_at.` +
      `\n   Minimum example: { \"run_id\": \"${run.runId}\", \"iteration\": 1, \"phase\":\"dispatching\", \"current_task_id\":\"T-001_<slug>\", \"assigned_developer\":\"developer_codex\", \"developer_status\":\"ongoing\", \"manager_decision\": null, \"updated_at\":\"${nowIso()}\" }` +
      "\n5) In TODO, include P0/P1/P2 and explicit execution order (1,2,3...).";

    const retryBlock = retryReason
      ? `\n\nRETRY REQUIRED: ${retryReason}\nYou MUST write the files now. Do not respond with a plan or narration. If you cannot write files, say so explicitly.`
      : "";

    return [header, "", String(run.managerPreprompt || ""), "", "User request:", run.userPrompt, protocol, retryBlock].join("\n");
  }

  _buildDeveloperPrompt(run, { turnNonce, retryReason } = {}) {
    // Note: developer prompt always includes a per-turn marker when orchestrator provides it.
    const pre =
      run.developerPreprompt ||
      "You are the primary developer. Follow the manager plan. Implement the assigned task and add tests. Keep documentation consistent (SPEC/TODO/TESTING_PLAN/DECISIONS + INDEX).";

    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const instructionsPath = relPathForPrompt(run.cwd, run.projectDeveloperInstructionPath || path.join(run.cwd, "agents", "developer_codex.md"));
    const { taskId, taskDirRel } = taskContext(run);
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const header = buildReadFirstHeader({
      role: "developer_codex",
      turnNonce,
      readPaths: [
        instructionsPath,
        docsRules,
        docsIndex,
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        `${taskDirRel}/task.md`,
        `${taskDirRel}/manager_instruction.md`,
      ],
      writePaths: [
        `${taskDirRel}/dev_ack.json`,
        `${taskDirRel}/dev_result.md`,
        `${taskDirRel}/questions/Q-*.md (if blocked)`,
        pipelineStatePath,
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "If current_task_id is missing, ask a question and set developer_status=blocked.",
        "Include 'Ecarts & rationale' in dev_result.md for any initiative/deviation.",
        ...(marker
          ? [
              `TURN COMPLETION MARKER (required): write ${marker.tmpRel} then rename to ${marker.doneRel} with content 'ok' as the LAST step of this turn.`,
            ]
          : []),
      ],
    });

    const protocol =
      "\n\nProtocol (MUST DO):" +
      `\n1) Confirm the current task folder: ${taskDirRel} (task_id: ${taskId}).` +
      `\n2) Write ACK to ${taskDirRel}/dev_ack.json when you start.` +
      `\n3) If blocked, write a short question in ${taskDirRel}/questions/Q-*.md and set developer_status=blocked in ${pipelineStatePath}.` +
      `\n4) Otherwise implement the task, write ${taskDirRel}/dev_result.md (include tests + 'Ecarts & rationale').` +
      `\n5) Update ${pipelineStatePath} with developer_status=ready_for_review + summary + tests.` +
      (marker ? `\n6) Finally, write the turn marker ${marker.doneRel} (atomic via ${marker.tmpRel}) with content 'ok'.` : "") +
      `\nExample: { \"run_id\": \"${run.runId}\", \"iteration\": ${run.iteration}, \"current_task_id\":\"${taskId}\", \"developer_status\": \"ready_for_review\", \"summary\": \"...\", \"tests\": { \"ran\": true, \"passed\": false, \"notes\": \"...\" }, \"updated_at\": \"${nowIso()}\" }`;

    const retryBlock = retryReason
      ? `\n\nRETRY REQUIRED: ${retryReason}\nWrite the missing files now. Do not respond with a plan or narration.`
      : "";

    return (
      [
        header,
        "",
        pre,
        `\nIteration: ${run.iteration}`,
        "\nImplement ONLY the assigned task. Do not pick new tasks on your own.",
        protocol,
        retryBlock,
      ].join("\n")
    );
  }

  _buildManagerReviewPrompt(run, { turnNonce, retryReason } = {}) {
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const gitWorkflowPath = relPathForPrompt(run.cwd, run.projectGitWorkflowPath || path.join(run.cwd, "doc", "GIT_WORKFLOW.md"));
    const instructionsPath = relPathForPrompt(run.cwd, run.projectManagerInstructionPath || path.join(run.cwd, "agents", "manager.md"));
    const { taskId, taskDirRel } = taskContext(run);
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        instructionsPath,
        docsRules,
        todoPath,
        testingPath,
        gitWorkflowPath,
        pipelineStatePath,
        `${taskDirRel}/task.md`,
        `${taskDirRel}/dev_ack.json`,
        `${taskDirRel}/dev_result.md`,
      ],
      writePaths: [
        `${taskDirRel}/manager_review.md`,
        pipelineStatePath,
        todoPath,
        docsIndex,
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "Re-read doc/TODO.md for user changes before deciding.",
        "Commit only after ACCEPTED (see doc/GIT_WORKFLOW.md).",
        "Keep this review short: verify DoD + required files, then write manager_review.md + update pipeline_state.json.",
        ...(marker
          ? [
              `TURN COMPLETION MARKER (required): write ${marker.tmpRel} then rename to ${marker.doneRel} with content 'ok' as the LAST step of this turn.`,
            ]
          : []),
      ],
    });

    const protocol =
      "\n\nProtocol (MUST DO):" +
      `\n1) Review task ${taskId} results + ${todoPath} + ${testingPath} (focus on DoD + proofs).` +
      `\n2) Write ${taskDirRel}/manager_review.md with one of: ACCEPTED / REWORK, and short reasons.` +
      `\n3) Update ${pipelineStatePath} (project cwd) with:` +
      "\n   - manager_decision: one of completed|continue|blocked" +
      "\n   - summary: short + pointer to manager_review.md" +
      "\n   - updated_at: ISO" +
      `\n4) If ACCEPTED and there is a next task in TODO order:` +
      "\n   - set current_task_id to the next task id (e.g. T-002_world)" +
      "\n   - set phase=\"dispatching\" and developer_status=\"ongoing\"" +
      "\n   - set manager_decision=\"continue\"" +
      `\n5) If this was the last task and everything is done: set manager_decision=\"completed\".` +
      `\n6) If REWORK is needed: keep current_task_id unchanged and set manager_decision=\"continue\" (developer will re-run).` +
      `\n7) If ACCEPTED, commit after review (see ${gitWorkflowPath}) and record the commit hash in ${taskDirRel}/manager_review.md.` +
      (marker ? `\n8) Finally, write the turn marker ${marker.doneRel} (atomic via ${marker.tmpRel}) with content 'ok'.` : "") +
      `\nExample: { \"run_id\": \"${run.runId}\", \"iteration\": ${run.iteration}, \"phase\":\"dispatching\", \"current_task_id\":\"T-002_world\", \"assigned_developer\":\"developer_codex\", \"developer_status\":\"ongoing\", \"manager_decision\":\"continue\", \"summary\":\"ACCEPTED T-001_hello -> next T-002_world (see data/tasks/${taskId}/manager_review.md)\", \"updated_at\":\"${nowIso()}\" }`;

    const retryBlock = retryReason
      ? `\n\nRETRY REQUIRED: ${retryReason}\nWrite the missing files now. Do not respond with a plan or narration.`
      : "";

    return (
      [
        header,
        "",
        String(run.managerPreprompt || ""),
        `\nReview iteration: ${run.iteration}`,
        "\nThe developer claims the work is ready for review (developer_status=ready_for_review).",
        protocol,
        retryBlock,
      ].join("\n")
    );
  }

  _buildManagerAnswerPrompt(run, { turnNonce, retryReason } = {}) {
    // Note: answer prompt can include per-turn marker when orchestrator provides it.
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const instructionsPath = relPathForPrompt(run.cwd, run.projectManagerInstructionPath || path.join(run.cwd, "agents", "manager.md"));
    const { taskId, taskDirRel } = taskContext(run);
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        instructionsPath,
        docsRules,
        docsIndex,
        todoPath,
        decisionsPath,
        pipelineStatePath,
        `${taskDirRel}/task.md`,
        `${taskDirRel}/questions/`,
      ],
      writePaths: [
        `${taskDirRel}/answers/A-*.md`,
        pipelineStatePath,
        todoPath,
        decisionsPath,
        docsIndex,
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "Answer questions briefly and explicitly. Then set developer_status=ongoing.",
        ...(marker
          ? [
              `TURN COMPLETION MARKER (required): write ${marker.tmpRel} then rename to ${marker.doneRel} with content 'ok' as the LAST step of this turn.`,
            ]
          : []),
      ],
    });

    const protocol =
      "\n\nProtocol (MUST DO):" +
      `\n1) Read the latest question in ${taskDirRel}/questions/ and answer it in ${taskDirRel}/answers/A-*.md.` +
      `\n2) Update ${pipelineStatePath} with developer_status=\"ongoing\" and a summary pointing to the answer file.` +
      "\n3) If the answer changes scope/requirements, update TODO/SPEC/DECISIONS accordingly." +
      (marker ? `\n4) Finally, write the turn marker ${marker.doneRel} (atomic via ${marker.tmpRel}) with content 'ok'.` : "");

    const retryBlock = retryReason
      ? `\n\nRETRY REQUIRED: ${retryReason}\nWrite the missing files now. Do not respond with a plan or narration.`
      : "";

    return [header, "", String(run.managerPreprompt || ""), `\nClarification needed for task ${taskId}.`, protocol, retryBlock].join("\n");
  }

  async _stepManagerPlanning(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "planning";
    run.developerStatus = "idle";
    run.managerDecision = null;
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });

    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "manager",
      step: "planning",
      threadId,
      model: run.managerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => this._buildManagerPlanningPrompt(run, { turnNonce, retryReason }),
      verifyPostconditions: async ({ run }) => {
        if (!run.currentTaskId) return { ok: false, reason: `Missing current_task_id in ${run.projectPipelineStatePath}` };
        if (!run.assignedDeveloper) return { ok: false, reason: `Missing assigned_developer in ${run.projectPipelineStatePath}` };
        const { taskDir } = taskContext(run);
        const taskMd = path.join(taskDir, "task.md");
        const instr = path.join(taskDir, "manager_instruction.md");
        if (!fileExists(taskMd)) return { ok: false, reason: `Missing task.md for ${run.currentTaskId}` };
        if (!fileExists(instr)) return { ok: false, reason: `Missing manager_instruction.md for ${run.currentTaskId}` };
        return { ok: true };
      },
      maxAttempts: 2,
    });

    const updated = this._getRunRequired(runId);
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Manager planning postconditions failed", at: nowIso(), where: "manager/planning" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    updated.status = "implementing";
    updated.iteration = 1;
    updated.developerStatus = "ongoing";
    updated.managerDecision = null;
    this._setRun(runId, updated);
  }

  async _stepDeveloper(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    if (run.assignedDeveloper && run.assignedDeveloper !== "developer_codex") {
      run.status = "failed";
      run.lastError = {
        message: `Assigned developer ${run.assignedDeveloper} is not supported in Phase 1`,
        at: nowIso(),
        where: "developer/dispatch",
      };
      this._setRun(runId, run);
      this._runningRunId = null;
      return;
    }

    run.status = "implementing";
    run.developerStatus = "ongoing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "developer" });
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "developer",
      step: "implementing",
      threadId,
      model: run.developerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => this._buildDeveloperPrompt(run, { turnNonce, retryReason }),
      verifyPostconditions: async ({ run }) => {
        const { taskDir } = taskContext(run);
        const ack = path.join(taskDir, "dev_ack.json");
        const resultMd = path.join(taskDir, "dev_result.md");
        const resultJson = path.join(taskDir, "dev_result.json");
        if (!fileExists(ack)) return { ok: false, reason: `Missing dev_ack.json for ${run.currentTaskId}` };
        if (!fileExists(resultMd) && !fileExists(resultJson)) return { ok: false, reason: `Missing dev_result.* for ${run.currentTaskId}` };
        if (run.developerStatus !== "ready_for_review") {
          return { ok: false, reason: `developer_status is ${run.developerStatus || "(missing)"} (expected ready_for_review)` };
        }
        return { ok: true };
      },
      maxAttempts: 2,
    });

    const updated = this._getRunRequired(runId);
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Developer postconditions failed", at: nowIso(), where: "developer" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    const after = this._getRunRequired(runId);
    if (after.developerStatus === "ready_for_review") {
      after.status = "reviewing";
      this._setRun(runId, after);
    }
  }

  async _stepManagerReview(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "reviewing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "manager",
      step: "reviewing",
      threadId,
      model: run.managerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => this._buildManagerReviewPrompt(run, { turnNonce, retryReason }),
      verifyPostconditions: async ({ run }) => {
        const { taskDir } = taskContext(run);
        const review = path.join(taskDir, "manager_review.md");
        if (!fileExists(review)) return { ok: false, reason: `Missing manager_review.md for ${run.currentTaskId}` };
        if (!run.managerDecision) return { ok: false, reason: `Missing manager_decision in ${run.projectPipelineStatePath}` };
        return { ok: true };
      },
      maxAttempts: 2,
    });

    const updated = this._getRunRequired(runId);
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Manager review postconditions failed", at: nowIso(), where: "manager/review" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    const after = this._getRunRequired(runId);
    const decision = after.managerDecision;
    if (decision === "completed") {
      after.status = "completed";
      this._setRun(runId, after);
      this._runningRunId = null;
      return;
    }
    if (decision === "continue") {
      after.status = "implementing";
      after.iteration = Math.max(1, Number(after.iteration || 1)) + 1;
      after.developerStatus = "ongoing";
      after.managerDecision = null;
      this._setRun(runId, after);
      return;
    }
    if (decision === "blocked") {
      after.status = "failed";
      after.lastError = { message: "Pipeline blocked (manager_decision=blocked)", at: nowIso(), where: "manager/review" };
      this._setRun(runId, after);
      this._runningRunId = null;
      return;
    }

    // Pause until the manager writes an explicit decision marker.
    after.lastError = {
      message: `Missing manager_decision marker in ${after.projectPipelineStatePath}`,
      at: nowIso(),
      where: "manager/review",
    };
    this._setRun(runId, after);
  }

  async _stepManagerAnswerQuestion(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "reviewing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "manager",
      step: "answering",
      threadId,
      model: run.managerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => this._buildManagerAnswerPrompt(run, { turnNonce, retryReason }),
      verifyPostconditions: async ({ run }) => {
        const { taskDir } = taskContext(run);
        const answersDir = path.join(taskDir, "answers");
        let hasAnswer = false;
        try {
          const ents = fs.existsSync(answersDir) ? fs.readdirSync(answersDir) : [];
          hasAnswer = ents.some((n) => /^A-\d+.*\.md$/i.test(n));
        } catch {
          hasAnswer = false;
        }
        if (!hasAnswer) return { ok: false, reason: `Missing answers/A-*.md in ${relPathForPrompt(run.cwd, answersDir)}` };
        if (run.developerStatus !== "ongoing") {
          return { ok: false, reason: `developer_status is ${run.developerStatus || "(missing)"} (expected ongoing)` };
        }
        return { ok: true };
      },
      maxAttempts: 2,
    });

    const updated = this._getRunRequired(runId);
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Manager answer postconditions failed", at: nowIso(), where: "manager/answering" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    const after = this._getRunRequired(runId);
    if (after.developerStatus === "ongoing") {
      after.status = "implementing";
      this._setRun(runId, after);
    }
  }

  async _runTurn({ runId, role, step, threadId, model, prompt }) {
    if (this._active) throw new Error("Another turn is already running");
    if (this._stopRequested.has(runId)) throw new Error("Run stopped");

    const rpcLogPath = path.join(
      this._logsDir,
      `run_${runId.slice(0, 8)}_${role}_${step}_${nowIsoForFile()}_rpc.log`,
    );
    this._codex.setLogPath(rpcLogPath);

    const assistantLogPath = path.join(
      this._logsDir,
      `run_${runId.slice(0, 8)}_${role}_${step}_${nowIsoForFile()}_assistant.txt`,
    );

    const active = {
      runId,
      role,
      step,
      threadId,
      model,
      prompt,
      effort: "high",
      retryCount: 0,
      assistantText: "",
      turnId: null,
      lastErrorMessage: null,
      startedAtMs: Date.now(),
      assistantLogPath,
      rpcLogPath,
      _resolve: null,
      _reject: null,
      _timeout: null,
    };

    const promise = new Promise((resolve, reject) => {
      active._resolve = resolve;
      active._reject = reject;
    });

    this._active = active;

    try {
      const run = this._getRunRequired(runId);
      run.activeTurn = {
        role,
        step,
        threadId,
        turnId: null,
        startedAtMs: active.startedAtMs,
      };
      this._setRun(runId, run);
    } catch {
      // ignore
    }

    this.emit("event", {
      runId,
      event: "meta",
      data: { role, step, threadId, turnId: null, model, rpcLogPath, assistantLogPath },
    });

    try {
      const run = this._getRunRequired(runId);
      if (!Array.isArray(run.logFiles)) run.logFiles = [];
      run.logFiles.push({
        role,
        step,
        threadId,
        model,
        assistantLogPath,
        rpcLogPath,
        startedAtMs: active.startedAtMs,
      });
      this._setRun(runId, run);
    } catch {
      // ignore
    }

    active._timeout = setTimeout(() => {
      const still = this._active;
      if (!still || still !== active) return;
      still.lastErrorMessage = "Turn timed out";
      try {
        if (still.threadId && still.turnId) void this._codex.turnInterrupt({ threadId: still.threadId, turnId: still.turnId });
      } catch {
        // ignore
      }
      const err = new Error("Turn timed out");
      still._reject?.(err);
      this._active = null;
      this._codex.setLogPath(null);
    }, TURN_TIMEOUT_MS);
    active._timeout.unref?.();

    try {
      const turnResp = await this._codex.turnStart({
        threadId,
        prompt,
        approvalPolicy: DEFAULT_APPROVAL_POLICY,
        model,
        effort: active.effort,
      });
      const resolvedTurnId = String(turnResp?.turn?.id ?? "");
      if (resolvedTurnId) active.turnId = resolvedTurnId;
      this.emit("event", {
        runId,
        event: "meta",
        data: { role, step, threadId: active.threadId, turnId: active.turnId, model },
      });
      try {
        const run = this._getRunRequired(runId);
        if (run.activeTurn) {
          run.activeTurn.turnId = active.turnId;
          this._setRun(runId, run);
        }
      } catch {
        // ignore
      }
    } catch (e) {
      clearTimeout(active._timeout);
      this._active = null;
      this._codex.setLogPath(null);
      const msg = safeErrorMessage(e);
      this.emit("event", { runId, event: "diag", data: { role, type: "error", message: msg } });
      throw e;
    }

    let result;
    try {
      result = await promise;
    } finally {
      const still = this._active;
      if (still === active) {
        clearTimeout(active._timeout);
        this._active = null;
        this._codex.setLogPath(null);
      }
      try {
        const run = this._getRunRequired(runId);
        if (run.activeTurn) {
          run.activeTurn = null;
          this._setRun(runId, run);
        }
      } catch {
        // ignore
      }
    }

    return result;
  }

  _appendAssistantLog(active, text) {
    if (!active?.assistantLogPath) return;
    try {
      fs.appendFileSync(active.assistantLogPath, text, { encoding: "utf8" });
    } catch {
      // best-effort
    }
  }

  _onNotification(msg) {
    const active = this._active;
    if (!active) return;

    const method = String(msg?.method || "");
    const params = msg?.params;
    if (!matchesActive(active, params)) return;

    if (method === "turn/started") {
      try {
        active.threadId = String(params.threadId ?? active.threadId ?? "");
        active.turnId = String(params.turn?.id ?? active.turnId ?? "");
        this.emit("event", {
          runId: active.runId,
          event: "meta",
          data: { role: active.role, step: active.step, threadId: active.threadId, turnId: active.turnId, model: active.model },
        });
        try {
          const run = this._getRunRequired(active.runId);
          if (run.activeTurn) {
            run.activeTurn.threadId = active.threadId;
            run.activeTurn.turnId = active.turnId;
            this._setRun(active.runId, run);
          }
        } catch {
          // ignore
        }
      } catch {
        // ignore
      }
      return;
    }

    if (method === "item/agentMessage/delta") {
      const delta = String(params?.delta ?? "");
      if (!delta) return;
      active.assistantText += delta;
      this._appendAssistantLog(active, delta);
      this.emit("event", {
        runId: active.runId,
        event: "delta",
        data: { role: active.role, step: active.step, delta },
      });
      return;
    }

    if (method === "item/completed") {
      try {
        const item = params?.item;
        if (item && item.type === "agentMessage" && typeof item.text === "string") {
          active.assistantText = item.text;
        }
      } catch {
        // ignore
      }
      return;
    }

    if (method === "error") {
      try {
        const m = params?.error?.message ? String(params.error.message) : "Unknown error";
        active.lastErrorMessage = m;
        this.emit("event", {
          runId: active.runId,
          event: "diag",
          data: { role: active.role, step: active.step, type: "error", message: m },
        });
      } catch {
        // ignore
      }
      return;
    }

    if (method === "turn/completed") {
      const status = String(params?.turn?.status ?? "completed");
      const errMsg =
        status === "failed" && params?.turn?.error?.message ? String(params.turn.error.message) : active.lastErrorMessage || null;

      // Retry once if the model rejects the requested effort.
      if (status === "failed" && active.retryCount < 1) {
        const supported = parseSupportedEffortsFromError(errMsg || "");
        const clamped = pickMaxEffort(supported);
        if (clamped && clamped !== active.effort) {
          active.retryCount += 1;
          active.effort = clamped;
          active.assistantText = "";
          active.lastErrorMessage = null;
          this.emit("event", {
            runId: active.runId,
            event: "diag",
            data: { role: active.role, step: active.step, type: "info", message: `Retrying with effort=${clamped}` },
          });
          void (async () => {
            try {
              const turnResp = await this._codex.turnStart({
                threadId: active.threadId,
                prompt: active.prompt,
                approvalPolicy: DEFAULT_APPROVAL_POLICY,
                model: active.model,
                effort: active.effort,
              });
              const resolvedTurnId = String(turnResp?.turn?.id ?? "");
              if (resolvedTurnId) active.turnId = resolvedTurnId;
            } catch (e) {
              const m = extractRpcErrorMessage(e);
              active._resolve?.({
                role: active.role,
                step: active.step,
                threadId: active.threadId,
                turnId: active.turnId,
                turnStatus: "failed",
                assistantText: active.assistantText,
                errorMessage: m || "Retry failed",
              });
              this._active = null;
              this._codex.setLogPath(null);
            }
          })();
          return;
        }
      }

      clearTimeout(active._timeout);
      this._active = null;
      this._codex.setLogPath(null);

      const payload = {
        role: active.role,
        step: active.step,
        threadId: active.threadId,
        turnId: active.turnId,
        turnStatus: status,
        assistantText: active.assistantText,
        errorMessage: errMsg,
      };

      this.emit("event", { runId: active.runId, event: "completed", data: payload });
      active._resolve?.(payload);
      try {
        const run = this._getRunRequired(active.runId);
        if (run.activeTurn) {
          run.activeTurn = null;
          this._setRun(active.runId, run);
        }
      } catch {
        // ignore
      }
      return;
    }
  }
}

module.exports = { PipelineManager };
