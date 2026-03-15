const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
}

function parseRole(prompt) {
  const m = String(prompt || "").match(/^READ FIRST \(role:\s*([^)]+)\)/m);
  return m ? String(m[1]).trim() : null;
}

function parseTurnNonce(prompt) {
  const m = String(prompt || "").match(/^turn_nonce:\s*(\S+)/m);
  return m ? String(m[1]).trim() : null;
}

function parseMarkerDoneRel(prompt) {
  const p = String(prompt || "");
  // Try to locate the marker path from the READ FIRST header/write list or notes.
  const m = p.match(/data[\\/]+turn_markers[\\/]+[^\s)]+\.done/);
  return m ? String(m[0]).trim().replace(/\\/g, "/") : null;
}

function writeTurnMarker({ cwd, markerDoneRel, turnNonce, logPath }) {
  const candidates = [];
  if (markerDoneRel) candidates.push(path.resolve(cwd, markerDoneRel));
  if (turnNonce) candidates.push(path.join(cwd, "data", "turn_markers", `${turnNonce}.done`));

  const unique = Array.from(new Set(candidates.filter(Boolean)));
  if (!unique.length) return;

  for (const doneAbs of unique) {
    try {
      const tmpAbs = doneAbs.replace(/\.done$/i, ".tmp");
      ensureDir(path.dirname(doneAbs));
      fs.writeFileSync(tmpAbs, "ok\n", "utf8");
      try {
        fs.renameSync(tmpAbs, doneAbs);
      } catch (e) {
        // If rename fails (e.g. target exists or cross-device), fall back to direct write.
        try {
          fs.writeFileSync(doneAbs, "ok\n", "utf8");
        } catch {
          // ignore
        }
        try {
          fs.rmSync(tmpAbs, { force: true });
        } catch {
          // ignore
        }
        throw e;
      }

      // Sanity check: ensure it exists (some environments can be quirky).
      if (!fs.existsSync(doneAbs)) {
        fs.writeFileSync(doneAbs, "ok\n", "utf8");
      }

      try {
        if (logPath) {
          ensureDir(path.dirname(logPath));
          fs.appendFileSync(logPath, `[fake] wrote marker: ${doneAbs}\n`, { encoding: "utf8" });
        }
      } catch {
        // ignore
      }
    } catch (e) {
      try {
        if (logPath) {
          ensureDir(path.dirname(logPath));
          fs.appendFileSync(logPath, `[fake] marker write failed: ${doneAbs} err=${String(e?.message || e)}\n`, { encoding: "utf8" });
        }
      } catch {
        // ignore
      }
    }
  }
}

function isPlanningPrompt(prompt) {
  return /\bPlanning protocol\b/i.test(String(prompt || ""));
}

function isReviewPrompt(prompt) {
  return /\bReview task\b/i.test(String(prompt || "")) || /\bmanager_review\.md\b/i.test(String(prompt || ""));
}

function isUserCommandPrompt(prompt) {
  const p = String(prompt || "");
  return /\bprocess the user command\b/i.test(p) || /\bUser command file:\s*\S+/i.test(p) || /\bWrite response file:\s*\S+/i.test(p);
}

function parseUserCommandResponseRel(prompt) {
  const p = String(prompt || "");
  const m = p.match(/^\s*Write response file:\s*(\S+)\s*$/im);
  return m ? String(m[1]).trim().replace(/\\/g, "/") : null;
}

function extractTaskIds(prompt) {
  const ids = [];
  const seen = new Set();
  const p = String(prompt || "");
  // Avoid matching example placeholders like `T-001_<slug>` (would otherwise produce `T-001_`).
  // Require that the matched id ends with an alphanumeric character.
  const re = /\bT-\d{3}(?:[A-Za-z0-9_-]*[A-Za-z0-9])\b/g;
  for (const m of p.matchAll(re)) {
    const id = String(m[0] || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function chooseAssignment(prompt) {
  const p = String(prompt || "");
  if (/assigned_developer\s*=\s*developer_antigravity/i.test(p)) return "developer_antigravity";
  if (/assigned_developer\s*=\s*developer_codex/i.test(p)) return "developer_codex";
  if (/\bdeveloper_antigravity\b|\bdev ag\b|\bantigravity\b/i.test(p)) return "developer_antigravity";
  return "developer_codex";
}

function writeTodoForTasks({ cwd, taskIds }) {
  const todoPath = path.join(cwd, "doc", "TODO.md");
  ensureDir(path.dirname(todoPath));
  const lines = ["# TODO", ""];
  let i = 1;
  for (const id of taskIds || []) {
    lines.push(`- [ ] P0 ${i}. ${id}`);
    i += 1;
  }
  if (lines.length <= 2) lines.push("- [ ] P0 1. T-001_smoke");
  fs.writeFileSync(todoPath, lines.join("\n") + "\n", "utf8");
}

function nextTaskFromState({ cwd, state }) {
  const cur = state?.current_task_id ? String(state.current_task_id) : null;
  const order = Array.isArray(state?._fake_task_order) ? state._fake_task_order.map((v) => String(v)) : null;
  if (cur && order && order.length) {
    const idx = order.indexOf(cur);
    if (idx >= 0 && idx + 1 < order.length) return order[idx + 1];
  }
  try {
    const tasksRoot = path.join(cwd, "data", "tasks");
    const dirs = fs
      .readdirSync(tasksRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b));
    if (!cur) return dirs[0] || null;
    const idx = dirs.indexOf(cur);
    if (idx >= 0 && idx + 1 < dirs.length) return dirs[idx + 1];
  } catch {
    // ignore
  }
  return null;
}

function createId(prefix) {
  const nonce = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex");
  return `${prefix}-${nonce.replace(/-/g, "").slice(0, 20)}`;
}

class FakeCodexAppServerClient extends EventEmitter {
  constructor() {
    super();
    this._running = false;
    this._initialized = false;
    this._threadCwds = new Map();
    this._logPath = null;
  }

  isRunning() {
    return this._running;
  }

  setLogPath(logPath) {
    this._logPath = logPath || null;
  }

  async start() {
    this._running = true;
  }

  async initialize() {
    this._initialized = true;
  }

  async threadStart({ cwd }) {
    const threadId = createId("thread");
    this._threadCwds.set(threadId, String(cwd || process.cwd()));
    return { thread: { id: threadId, path: null } };
  }

  async threadResume({ threadId, cwd }) {
    const tid = String(threadId || "");
    // Test hook: simulate a codex app-server error where the server cannot find the rollout for a known thread id.
    // This mirrors real-world failures like: {"code":-32600,"message":"no rollout found for thread id ..."}.
    try {
      const failTid = process.env.ANTIDEX_FAKE_RESUME_NO_ROLLOUT_THREAD_ID
        ? String(process.env.ANTIDEX_FAKE_RESUME_NO_ROLLOUT_THREAD_ID)
        : "";
      if (failTid && tid === failTid) {
        throw new Error(JSON.stringify({ code: -32600, message: `no rollout found for thread id ${tid}` }));
      }
    } catch (e) {
      throw e;
    }
    if (cwd) this._threadCwds.set(tid, String(cwd));
    return { thread: { id: tid, path: null } };
  }

  async turnInterrupt() {
    // best-effort; in fake mode turns complete quickly anyway
  }

  async turnStart({ threadId, prompt }) {
    const tid = String(threadId || "");
    const cwd = this._threadCwds.get(tid) || process.cwd();
    const turnId = createId("turn");
    const role = parseRole(prompt) || "unknown";
    const turnNonce = parseTurnNonce(prompt);
    const markerDoneRel = parseMarkerDoneRel(prompt);

    // Minimal "rpc log" so debugging is easier.
    try {
      if (this._logPath) {
        ensureDir(path.dirname(this._logPath));
        fs.appendFileSync(
          this._logPath,
          `[fake] role=${role} thread=${tid} turn=${turnId} cwd=${cwd} turnNonce=${turnNonce || "-"} markerDoneRel=${markerDoneRel || "-"}\n`,
          { encoding: "utf8" },
        );
      }
    } catch {
      // ignore
    }

    setTimeout(() => {
      this.emit("notification", {
        method: "turn/started",
        params: { threadId: tid, turnId, turn: { id: turnId }, model: "fake" },
      });
    }, 10);

    setTimeout(() => {
      this.emit("notification", {
        method: "item/agentMessage/delta",
        params: { threadId: tid, turnId, delta: `[fake] ${role} started\n` },
      });
    }, 20);

    setTimeout(async () => {
      try {
        if (role === "manager" && isUserCommandPrompt(prompt)) {
          const userCommandDelayMs = Math.max(0, Number(process.env.ANTIDEX_FAKE_USER_COMMAND_DELAY_MS || 0));
          if (userCommandDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, userCommandDelayMs));
          }
          const respRel = parseUserCommandResponseRel(prompt);
          if (respRel) {
            const respAbs = path.resolve(cwd, respRel);
            ensureDir(path.dirname(respAbs));
            fs.writeFileSync(
              respAbs,
              ["# User command response (fake)", "", `created_at: ${nowIso()}`, "", "OK (fake).", ""].join("\n"),
              "utf8",
            );
          }

          // In real runs, the Manager is expected to reconcile doc/TODO.md + data/tasks/*
          // so the override results in an actionable next step (otherwise a completed run can re-complete immediately).
          // Fake mode should simulate that behavior to keep e2e tests deterministic.
          try {
            const taskId = "T-999_usercmd_fix";
            const tasksRoot = path.join(cwd, "data", "tasks");
            const taskDir = path.join(tasksRoot, taskId);
            ensureDir(taskDir);
            fs.writeFileSync(
              path.join(taskDir, "task.md"),
              ["# " + taskId, "", "- Assigned developer: `developer_codex`", "", "DoD: Fix the reported issue(s) + add proof.", ""].join("\n"),
              "utf8",
            );
            fs.writeFileSync(
              path.join(taskDir, "manager_instruction.md"),
              ["# Manager Instruction", "", "Fake user_command: create a follow-up fix task.", ""].join("\n"),
              "utf8",
            );

            const todoPath = path.join(cwd, "doc", "TODO.md");
            ensureDir(path.dirname(todoPath));
            let todo = "";
            try {
              todo = fs.readFileSync(todoPath, "utf8");
            } catch {
              todo = "# TODO\n\n";
            }
            if (!todo.includes(taskId)) {
              todo = `${todo.trimEnd()}\n- [ ] P0 (Codex) ${taskId} — Follow-up after user command\n`;
              fs.writeFileSync(todoPath, todo.endsWith("\n") ? todo : todo + "\n", "utf8");
            }

            const statePath = path.join(cwd, "data", "pipeline_state.json");
            let state = {};
            try {
              const raw = fs.readFileSync(statePath, "utf8");
              state = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
            } catch {
              state = {};
            }
            state.phase = "dispatching";
            state.current_task_id = taskId;
            state.assigned_developer = "developer_codex";
            state.developer_status = "ongoing";
            state.manager_decision = null;
            state.summary = `fake user_command -> queued ${taskId}`;
            state.updated_at = nowIso();
            writeJsonAtomic(statePath, state);
          } catch {
            // ignore
          }
        } else if (role === "manager" && isReviewPrompt(prompt)) {
          // Write a minimal review and advance to the next task (or complete).
          const statePath = path.join(cwd, "data", "pipeline_state.json");
          let taskId = "T-001_smoke";
          let parsed = null;
          try {
            const raw = fs.readFileSync(statePath, "utf8");
            parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
            if (parsed?.current_task_id) taskId = String(parsed.current_task_id);
          } catch {
            // ignore
          }
          const taskDir = path.join(cwd, "data", "tasks", taskId);
          ensureDir(taskDir);
          fs.writeFileSync(
            path.join(taskDir, "manager_review.md"),
            [
              "# Manager Review - fake",
              "",
              "Decision: **ACCEPTED**",
              `Reviewed_at: ${nowIso()}`,
              `Turn nonce: ${turnNonce || "<missing>"}`,
              "",
              "Reasons (short):",
              "- fake acceptance",
              "",
              "Next actions:",
              "- none",
            ].join("\n") + "\n",
            "utf8",
          );
          try {
            const state = parsed && typeof parsed === "object" ? parsed : {};
            const next = nextTaskFromState({ cwd, state });
            if (next) {
              state.manager_decision = "continue";
              state.current_task_id = next;
              state.assigned_developer = state.assigned_developer || "developer_codex";
              state.developer_status = "ongoing";
              state.summary = `fake accepted ${taskId} -> next ${next}`;
            } else {
              state.manager_decision = "completed";
              state.summary = `fake accepted ${taskId} -> completed`;
            }
            state.updated_at = nowIso();
            writeJsonAtomic(statePath, state);
          } catch {
            // ignore
          }
        } else if (role === "manager" && isPlanningPrompt(prompt)) {
          // Create a single minimal task and update pipeline state.
          const tasksRoot = path.join(cwd, "data", "tasks");
          const assignment = chooseAssignment(prompt);
          const taskIds = extractTaskIds(prompt);
          const finalTaskIds = taskIds.length
            ? taskIds
            : [assignment === "developer_antigravity" ? "T-001_ag-smoke" : "T-001_ui-smoke"];

          for (const taskId of finalTaskIds) {
            const taskDir = path.join(tasksRoot, taskId);
            ensureDir(taskDir);
            fs.writeFileSync(
              path.join(taskDir, "task.md"),
              [
                `# ${taskId}`,
                "",
                `- Assigned developer: \`${assignment}\``,
                "",
                assignment === "developer_antigravity"
                  ? "DoD: AG writes ack/result + task pointer dev_result.json + turn marker."
                  : "DoD: create hello/world/files if relevant + dev_ack + dev_result + set ready_for_review.",
              ].join("\n") + "\n",
              "utf8",
            );
            fs.writeFileSync(
              path.join(taskDir, "manager_instruction.md"),
              ["# Manager Instruction", "", "This is a fake planning output for e2e tests."].join("\n") + "\n",
              "utf8",
            );
          }

          writeTodoForTasks({ cwd, taskIds: finalTaskIds });

          const statePath = path.join(cwd, "data", "pipeline_state.json");
          const state = {
            run_id: "fake",
            iteration: 1,
            phase: "dispatching",
            current_task_id: finalTaskIds[0],
            assigned_developer: assignment,
            developer_status: "ongoing",
            manager_decision: null,
            summary: "fake planning done",
            updated_at: nowIso(),
            _fake_task_order: finalTaskIds,
          };
          writeJsonAtomic(statePath, state);
        } else if (role === "developer" || role === "developer_codex") {
          // Implement the current task and mark ready_for_review.
          const statePath = path.join(cwd, "data", "pipeline_state.json");
          let taskId = "T-001_smoke";
          let assigned = "developer_codex";
          try {
            const raw = fs.readFileSync(statePath, "utf8");
            const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
            if (parsed?.current_task_id) taskId = String(parsed.current_task_id);
            if (parsed?.assigned_developer) assigned = String(parsed.assigned_developer);
          } catch {
            // ignore
          }
          if (assigned === "developer_antigravity") {
            // In AG mode, the orchestrator handles the developer step; do nothing here.
          } else {
            // Simulate the "hello/world/files" flow used by phase1-e2e.
            try {
              const lower = String(taskId).toLowerCase();
              if (lower.includes("hello")) fs.writeFileSync(path.join(cwd, "hello.txt"), "hello\n", "utf8");
              else if (lower.includes("world")) fs.writeFileSync(path.join(cwd, "world.txt"), "world\n", "utf8");
              else if (lower.includes("files")) {
                fs.writeFileSync(path.join(cwd, "files.md"), ["- hello.txt", "- world.txt"].join("\n") + "\n", "utf8");
              }
            } catch {
              // ignore
            }

            const taskDir = path.join(cwd, "data", "tasks", taskId);
            ensureDir(taskDir);
            writeJsonAtomic(path.join(taskDir, "dev_ack.json"), { status: "ack", task_id: taskId, started_at: nowIso() });
            fs.writeFileSync(path.join(taskDir, "dev_result.md"), `Done (fake).\n`, "utf8");
            try {
              const raw = fs.readFileSync(statePath, "utf8");
              const parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
              parsed.developer_status = "ready_for_review";
              parsed.manager_decision = null;
              parsed.summary = `fake dev done for ${taskId}`;
              parsed.updated_at = nowIso();
              writeJsonAtomic(statePath, parsed);
            } catch {
              // ignore
            }
          }
        }

        // Turn marker (handshake): prefer parsing explicit paths from prompt; fallback to turn_nonce.
        writeTurnMarker({ cwd, markerDoneRel, turnNonce, logPath: this._logPath });
      } catch {
        // ignore
      }

      this.emit("notification", {
        method: "turn/completed",
        params: { threadId: tid, turnId, turn: { id: turnId, status: "completed" } },
      });
    }, 250);

    return { turn: { id: turnId } };
  }
}

module.exports = { FakeCodexAppServerClient };
