const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const { PipelineStateStore } = require("./pipelineStateStore");
const { CodexAppServerClient } = require("../../Local_Codex_appserver/server/codexAppServerClient");

const DEFAULT_SANDBOX = "danger-full-access";
const DEFAULT_APPROVAL_POLICY = "never";

const TURN_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_AUTO_ITERATIONS = 10;
const CANONICAL_DOCS_RULES_PATH = path.resolve(__dirname, "..", "..", "doc", "DOCS_RULES.md");

function nowIso() {
  return new Date().toISOString();
}

function nowIsoForFile() {
  return new Date().toISOString().replace(/[:.]/g, "-");
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

function ensureProjectDocs({ cwd }) {
  const docDir = path.join(cwd, "doc");
  const walkthroughDir = path.join(docDir, "walkthrough");
  const dataDir = path.join(cwd, "data");
  ensureDir(docDir);
  ensureDir(walkthroughDir);
  ensureDir(dataDir);

  const projectRulesPath = path.join(docDir, "DOCS_RULES.md");
  const canonical = normalizePathForMd(CANONICAL_DOCS_RULES_PATH);
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
      "- Put AG walkthrough files under doc/walkthrough/ and reference them from doc/INDEX.md.",
      "",
    ].join("\n"),
  );

  const projectIndexPath = path.join(docDir, "INDEX.md");
  writeFileIfMissing(
    projectIndexPath,
    [
      "# Documentation Index (Project)",
      "",
      "Regle: maintain this file. See doc/DOCS_RULES.md.",
      "",
      "- `doc/DOCS_RULES.md` - Doc writing rules (canonical pointer). (owner: Both)",
      "- `doc/INDEX.md` - This index. (owner: Both)",
      "- `doc/SPEC.md` - Main spec / requirements. (owner: Manager/Codex/AG)",
      "- `doc/TODO.md` - Prioritized TODO / backlog. (owner: Manager/Codex/AG)",
      "- `doc/TESTING_PLAN.md` - Test plan + checklist. (owner: Both)",
      "- `doc/DECISIONS.md` - Decision log. (owner: Both)",
      "- `doc/walkthrough/` - AG walkthroughs (mirrors from ~/.gemini/...). (owner: AG)",
      "- `data/pipeline_state.json` - Runtime marker for Local Codex dual pipeline. (owner: Both)",
      "",
    ].join("\n"),
  );

  writeFileIfMissing(
    path.join(walkthroughDir, "README.md"),
    [
      "# Walkthroughs (AG)",
      "",
      "Put Antigravity (AG) walkthrough files here to avoid polluting doc/ root.",
      "",
      "Source examples:",
      "- `C:/Users/<you>/.gemini/antigravity/brain/<uuid>/walkthrough_*.md.resolved`",
      "",
      "Rule: update `doc/INDEX.md` when adding a walkthrough.",
      "",
    ].join("\n"),
  );

  writeFileIfMissing(
    path.join(docDir, "SPEC.md"),
    ["# SPEC", "", "Context:", "- (to be written)", "", "Acceptance criteria:", "- (to be written)", ""].join("\n"),
  );
  writeFileIfMissing(
    path.join(docDir, "TODO.md"),
    ["# TODO", "", "Format:", "- [ ] P0 (Owner) Task (proof: files/tests)", ""].join("\n"),
  );
  writeFileIfMissing(
    path.join(docDir, "TESTING_PLAN.md"),
    ["# Testing Plan", "", "Checklist:", "- [ ] (to be written)", ""].join("\n"),
  );
  writeFileIfMissing(path.join(docDir, "DECISIONS.md"), ["# Decisions", "", "- YYYY-MM-DD: (decision) (rationale)", ""].join("\n"));

  const agentsPath = path.join(cwd, "AGENTS.md");
  writeFileIfMissing(
    agentsPath,
    [
      "# Agent Instructions (Project)",
      "",
      "Documentation discipline:",
      "- Read doc/DOCS_RULES.md and follow it.",
      "- Keep doc/INDEX.md updated.",
      "",
      "Default workflow:",
      "- Start by updating doc/SPEC.md + doc/TODO.md + doc/TESTING_PLAN.md.",
      "- Update doc/DECISIONS.md when you make a significant decision.",
      "",
    ].join("\n"),
  );

  return { docDir, dataDir, projectRulesPath, projectIndexPath, agentsPath };
}

function readJsonBestEffort(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, value: null };
    const raw = fs.readFileSync(filePath, "utf8");
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
    await this._codex.start({ cwd: this._dataDir });
    await this._codex.initialize({});
    this._initialized = true;
  }

  _newRunId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
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
    const { docDir: projectDocDir, dataDir: projectDataDir, projectRulesPath, projectIndexPath, agentsPath } = ensureProjectDocs({
      cwd,
    });
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
      managerThreadId: null,
      developerThreadId: null,
      managerRolloutPath: null,
      developerRolloutPath: null,
      logFiles: [],
      developerStatus: "idle", // idle | ongoing | ready_for_review | blocked
      managerDecision: null, // continue | completed | blocked | null
      projectDocRulesPath: projectRulesPath,
      projectDocIndexPath: projectIndexPath,
      projectAgentsPath: agentsPath,
      projectSpecPath: path.join(projectDocDir, "SPEC.md"),
      projectTodoPath: path.join(projectDocDir, "TODO.md"),
      projectTestingPlanPath: path.join(projectDocDir, "TESTING_PLAN.md"),
      projectDecisionsPath: path.join(projectDocDir, "DECISIONS.md"),
      projectPipelineStatePath: path.join(projectDataDir, "pipeline_state.json"),
      lastError: null,
    };

    this._state.setRun(runId, run);
    this._emitRun(run);

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

    if (dev) run.developerStatus = dev;
    if (decision) run.managerDecision = decision;
    if (typeof r.value.summary === "string") run.lastSummary = clampString(r.value.summary, 20_000);
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

    let resp;
    if (existing) resp = await this._codex.threadResume({ threadId: existing, cwd, sandbox, approvalPolicy, model });
    else resp = await this._codex.threadStart({ cwd, sandbox, approvalPolicy, model });

    const resolvedThreadId = String(resp?.thread?.id ?? resp?.threadId ?? "");
    if (!resolvedThreadId) throw new Error("thread/start|resume did not return thread.id");
    if (!run[threadKey] || run[threadKey] !== resolvedThreadId) run[threadKey] = resolvedThreadId;
    const rolloutPath = resp?.thread?.path ? String(resp.thread.path) : null;
    if (rolloutPath) run[rolloutKey] = rolloutPath;
    this._setRun(runId, run);
    return resolvedThreadId;
  }

  _buildManagerPlanningPrompt(run) {
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);

    const protocol =
      "\n\nProtocol (MUST DO):" +
      "\n0) Read and follow the documentation rules and keep the index updated:" +
      `\n- ${docsRules}` +
      `\n- ${docsIndex}` +
      "\n1) Create or update these files under the project cwd:" +
      `\n- ${specPath}` +
      `\n- ${todoPath}` +
      `\n- ${testingPath}` +
      `\n- ${decisionsPath} (append important decisions)` +
      `\n- ${docsIndex} (must reference all docs)` +
      `\n- ${pipelineStatePath} (JSON, valid)` +
      `\n2) In ${pipelineStatePath} set at least:` +
      `\n{ \"run_id\": \"${run.runId}\", \"iteration\": 1, \"developer_status\": \"ongoing\", \"manager_decision\": null, \"updated_at\": \"${nowIso()}\" }` +
      "\n3) In the TODO, give a clear priority order (P0/P1/P2) and a development order (1,2,3...). " +
      "\n4) Do NOT implement code. Only planning and instructions for the developer agent.";

    return (
      String(run.managerPreprompt || "") +
      "\n\nUser request:\n" +
      run.userPrompt +
      protocol
    );
  }

  _buildDeveloperPrompt(run) {
    const pre =
      run.developerPreprompt ||
      "You are the primary developer. Follow the manager plan. Update docs as you go (SPEC/TODO/TESTING_PLAN/DECISIONS + INDEX). Implement the tasks and add tests.";

    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);

    const protocol =
      "\n\nProtocol (MUST DO at the end of this turn):" +
      `\n1) Update ${pipelineStatePath} under the project cwd (valid JSON).` +
      "\n2) Set developer_status to ready_for_review when you are done with this iteration." +
      "\n3) Include a short summary of changes and test results." +
      `\nExample: { \"run_id\": \"${run.runId}\", \"iteration\": ${run.iteration}, \"developer_status\": \"ready_for_review\", \"summary\": \"...\", \"tests_passed\": true, \"updated_at\": \"${nowIso()}\" }`;

    return (
      pre +
      `\n\nIteration: ${run.iteration}` +
      "\nRead and follow doc rules + index:" +
      `\n- ${docsRules}` +
      `\n- ${docsIndex}` +
      "\nRead these planning files under the project cwd:" +
      `\n- ${specPath}` +
      `\n- ${todoPath}` +
      `\n- ${testingPath}` +
      `\n- ${decisionsPath}` +
      "\nImplement the highest priority TODO items. Run tests as defined in the testing plan." +
      "\nUpdate TODO + SPEC if needed, and keep doc/INDEX.md updated." +
      `\nFinally update: ${pipelineStatePath}` +
      protocol
    );
  }

  _buildManagerReviewPrompt(run) {
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);

    const protocol =
      "\n\nProtocol (MUST DO):" +
      `\n1) Review code changes + ${todoPath} + ${testingPath}.` +
      `\n2) Decide and write manager_decision in ${pipelineStatePath} under the project cwd.` +
      "\n- completed: if everything is done and tests are sufficient" +
      "\n- continue: if corrections are needed" +
      "\n- blocked: if impossible to proceed" +
      `\n3) If continue, update ${todoPath} with the missing/correction tasks (prioritized).` +
      `\n4) Keep ${docsIndex} updated if you create/rename/move docs.` +
      `\nExample: { \"run_id\": \"${run.runId}\", \"iteration\": ${run.iteration}, \"manager_decision\": \"continue\", \"summary\": \"...\", \"updated_at\": \"${nowIso()}\" }`;

    return (
      String(run.managerPreprompt || "") +
      `\n\nReview iteration: ${run.iteration}` +
      "\nThe developer claims the work is ready for review (developer_status=ready_for_review)." +
      protocol
    );
  }

  async _stepManagerPlanning(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "planning";
    run.developerStatus = "idle";
    run.managerDecision = null;
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });
    const prompt = this._buildManagerPlanningPrompt(run);
    const result = await this._runTurn({ runId, role: "manager", step: "planning", threadId, model: run.managerModel, prompt });

    const updated = this._getRunRequired(runId);
    if (result.turnStatus === "failed") {
      updated.status = "failed";
      updated.lastError = { message: result.errorMessage || "Manager planning failed", at: nowIso(), where: "manager/planning" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    updated.status = "implementing";
    updated.iteration = 1;
    updated.developerStatus = "ongoing";
    updated.managerDecision = null;
    this._setRun(runId, updated);
    await this._syncFromProjectState(runId);
  }

  async _stepDeveloper(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "implementing";
    run.developerStatus = "ongoing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "developer" });
    const prompt = this._buildDeveloperPrompt(run);
    const result = await this._runTurn({
      runId,
      role: "developer",
      step: "implementing",
      threadId,
      model: run.developerModel,
      prompt,
    });

    const updated = this._getRunRequired(runId);
    if (result.turnStatus === "failed") {
      updated.status = "failed";
      updated.lastError = { message: result.errorMessage || "Developer failed", at: nowIso(), where: "developer" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    await this._syncFromProjectState(runId);
    const after = this._getRunRequired(runId);
    if (after.developerStatus === "ready_for_review") {
      after.status = "reviewing";
      this._setRun(runId, after);
    } else {
      after.lastError = after.lastError || { message: "Developer did not set developer_status=ready_for_review", at: nowIso(), where: "developer" };
      this._setRun(runId, after);
    }
  }

  async _stepManagerReview(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    run.status = "reviewing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });
    const prompt = this._buildManagerReviewPrompt(run);
    const result = await this._runTurn({ runId, role: "manager", step: "reviewing", threadId, model: run.managerModel, prompt });

    const updated = this._getRunRequired(runId);
    if (result.turnStatus === "failed") {
      updated.status = "failed";
      updated.lastError = { message: result.errorMessage || "Manager review failed", at: nowIso(), where: "manager/review" };
      this._setRun(runId, updated);
      this._runningRunId = null;
      return;
    }

    await this._syncFromProjectState(runId);
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
      return;
    }
  }
}

module.exports = { PipelineManager };
