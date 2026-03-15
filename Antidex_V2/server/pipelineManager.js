const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { spawn } = require("node:child_process");

const { PipelineStateStore } = require("./pipelineStateStore");
const { CodexAppServerClient } = require("../../Local_Codex_appserver/server/codexAppServerClient");
const { FakeCodexAppServerClient } = require("./fakeCodexAppServerClient");
const { AntigravityConnectorClient } = require("./antigravityConnectorClient");
const { initAgRun } = require("./agRunProtocol");
const { waitForAck, waitForResult } = require("./waitForJsonFile");
const longJob = require("./longJobProtocol");

const DEFAULT_SANDBOX = "danger-full-access";
const DEFAULT_APPROVAL_POLICY = "never";

// Codex turn safety:
// - Primary guard is *inactivity*-based (reset on any RPC activity / deltas).
// - Keep a large hard cap as a last resort to prevent runaway turns.
const TURN_INACTIVITY_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS || 20 * 60 * 1000);
const TURN_HARD_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_HARD_TIMEOUT_MS || 2 * 60 * 60 * 1000);
// Soft timeout: does NOT interrupt. It triggers a "watch + warn" mode; if no activity is observed for
// TURN_SOFT_STALL_GRACE_MS after the soft timeout is reached, we escalate to a real incident.
// Default is disabled for non-command turns; enabled for long command executions.
const TURN_SOFT_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_SOFT_TIMEOUT_MS || 0);
const TURN_SOFT_TIMEOUT_MS_COMMAND = Number(process.env.ANTIDEX_TURN_SOFT_TIMEOUT_MS_COMMAND || 60 * 60 * 1000);
// Long commands can legitimately exceed the generic hard timeout; give them a larger cap by default.
const TURN_HARD_TIMEOUT_MS_COMMAND = Number(process.env.ANTIDEX_TURN_HARD_TIMEOUT_MS_COMMAND || 12 * 60 * 60 * 1000);
const TURN_SOFT_STALL_GRACE_MS = Number(process.env.ANTIDEX_TURN_SOFT_STALL_GRACE_MS || 15 * 60 * 1000);
// For file-based handshakes (turn markers, postconditions), we still use a wall-clock cap.
const TURN_MARKER_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_MARKER_TIMEOUT_MS || 30 * 60 * 1000);

// Long jobs (developer_codex only, V1):
// - Run status `waiting_job` means no agent is active; a background process is running.
// - Monitoring is driven by a Codex "monitor" turn at a fixed cadence (default hourly).
const LONG_JOB_TICK_MS = Number(process.env.ANTIDEX_LONG_JOB_TICK_MS || 5000);
const LONG_JOB_MONITOR_EVERY_MINUTES = Number(process.env.ANTIDEX_LONG_JOB_MONITOR_EVERY_MINUTES || 60);
const LONG_JOB_MONITOR_GRACE_MINUTES = Number(process.env.ANTIDEX_LONG_JOB_MONITOR_GRACE_MINUTES || 10);
const LONG_JOB_INITIAL_MONITOR_DELAY_MS = Number(process.env.ANTIDEX_LONG_JOB_INITIAL_MONITOR_DELAY_MS || 5 * 60 * 1000);
const LONG_JOB_SILENT_WARMUP_MS = Number(process.env.ANTIDEX_LONG_JOB_SILENT_WARMUP_MS || 10 * 60 * 1000);
const LONG_JOB_STALL_MS = Number(process.env.ANTIDEX_LONG_JOB_STALL_MS || 90 * 60 * 1000);
const AG_WATCHDOG_POLL_MS = Number(process.env.ANTIDEX_AG_WATCHDOG_POLL_MS || 30_000);
// "Inactivity" threshold for AG liveness. If nothing in the watched folders changes for this long,
// we treat AG as stalled and hand control back to the Manager.
const AG_STALL_MS = Number(process.env.ANTIDEX_AG_STALL_MS || 20 * 60 * 1000);
const AG_STALL_RESULT_MS = Number(process.env.ANTIDEX_AG_STALL_RESULT_MS || 60 * 60 * 1000);
const AG_BROWSER_SILENCE_MARGIN_MS = Number(process.env.ANTIDEX_AG_BROWSER_SILENCE_MARGIN_MS || 2 * 60 * 1000);
const AG_ACK_TIMEOUT_MS = Number(process.env.ANTIDEX_AG_ACK_TIMEOUT_MS || 2 * 60 * 1000);
// AG tasks can legitimately take longer than a single Codex turn. We rely primarily on the filesystem watchdog for liveness,
// and keep an additional (large) safety timeout for "no result.json ever arrives".
const AG_RESULT_TIMEOUT_MS = Number(process.env.ANTIDEX_AG_RESULT_TIMEOUT_MS || 12 * 60 * 60 * 1000);
// Additional liveness signal: watch project files for changes while AG works (excluding noisy dirs).
const AG_WATCH_PROJECT_FS = process.env.ANTIDEX_AG_WATCH_PROJECT_FS === "0" ? false : true;
const AG_PROJECT_WATCH_MAX_ENTRIES = Number(process.env.ANTIDEX_AG_PROJECT_WATCH_MAX_ENTRIES || 2500);
// Auto-run is meant to run until completion for long projects (potentially hours).
// Keep a very high default safety cap to avoid infinite loops on corrupted state.
const MAX_AUTO_ITERATIONS = Number(process.env.ANTIDEX_MAX_AUTO_ITERATIONS || 10_000);
const MAX_AUTO_STEPS = Number(process.env.ANTIDEX_MAX_AUTO_STEPS || Math.max(1_000, MAX_AUTO_ITERATIONS * 50));
const CANONICAL_DOCS_RULES_PATH = path.resolve(__dirname, "..", "..", "doc", "DOCS_RULES.md");
const LOCAL_AGENTS_DOCS_RULES_PATH = path.resolve(__dirname, "..", "..", "..", "doc", "DOCS_RULES.md");
const AGENT_TEMPLATES_DIR = path.resolve(__dirname, "..", "doc", "agent_instruction_templates");
const GIT_WORKFLOW_TEMPLATE_PATH = path.resolve(__dirname, "..", "doc", "GIT_WORKFLOW.md");

const ORCHESTRATOR_VERSION = (() => {
  try {
    // ../package.json from server/ -> Antidex/package.json
    // eslint-disable-next-line global-require
    const pkg = require("../package.json");
    return typeof pkg?.version === "string" && pkg.version.trim() ? pkg.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

const ANTIDEX_MARKER = "antidex_project";
const ANTIDEX_MARKER_VERSION = 1;
const ANTIDEX_LAYOUT_VERSION = 1;

function normalizeAgCodexRatio(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  return s.slice(0, 500);
}

function readAgQuotaSummary(quotaFilePath) {
  const p = typeof quotaFilePath === "string" ? quotaFilePath : "";
  if (!p) return { ok: false, filePath: null, reason: "missing_path" };
  if (!fs.existsSync(p)) return { ok: false, filePath: p, reason: "missing_file" };
  const r = readJsonBestEffort(p);
  if (!r.ok) return { ok: false, filePath: p, reason: `parse_error: ${r.error}` };
  const v = r.value && typeof r.value === "object" ? r.value : null;
  const modelsObj = v && v.models && typeof v.models === "object" ? v.models : null;
  const rows = [];
  let minPct = null;
  if (modelsObj) {
    for (const k of Object.keys(modelsObj)) {
      const m = modelsObj[k];
      if (!m || typeof m !== "object") continue;
      const pct = Number(m.remainingPercent);
      const pctOk = Number.isFinite(pct) ? pct : null;
      if (pctOk !== null) minPct = minPct === null ? pctOk : Math.min(minPct, pctOk);
      rows.push({
        key: k,
        label: typeof m.label === "string" ? m.label : null,
        remainingPercent: pctOk,
        resetTime: typeof m.resetTime === "string" ? m.resetTime : null,
      });
    }
  }
  return {
    ok: true,
    filePath: p,
    updatedAt: typeof v?.updatedAt === "string" ? v.updatedAt : null,
    minRemainingPercent: minPct,
    models: rows.slice(0, 6),
  };
}

function buildDynamicOptionsBlockForManager(run) {
  const useChatGPT = run && typeof run.useChatGPT === "boolean" ? run.useChatGPT : false;
  const useGitHub = run && typeof run.useGitHub === "boolean" ? run.useGitHub : false;
  const useLovable = run && typeof run.useLovable === "boolean" ? run.useLovable : false;
  const ratioDefault = run && typeof run.agCodexRatioDefault === "boolean" ? run.agCodexRatioDefault : true;
  const ratioText = run && typeof run.agCodexRatio === "string" ? run.agCodexRatio.trim() : "";
  const quotaFile = run && typeof run.agQuotaFilePath === "string" ? run.agQuotaFilePath : null;
  const quota = ratioDefault ? readAgQuotaSummary(quotaFile) : null;
  const quotaMin =
    quota && quota.ok && typeof quota.minRemainingPercent === "number" ? quota.minRemainingPercent : null;
  const quotaIsLow = typeof quotaMin === "number" ? quotaMin <= 40 : false;

  // Keep this block small: it gets injected into Manager prompts on every turn.
  const lines = [];
  lines.push("Dynamic options (from UI):");
  lines.push(`- useChatGPT: ${useChatGPT ? "ENABLED" : "disabled"} (optional; do NOT consult by default)`);
  lines.push(`- useGitHub: ${useGitHub ? "ENABLED" : "disabled"} (optional; do NOT create/push unless enabled or explicitly required)`);
  lines.push(`- useLovable: ${useLovable ? "ENABLED" : "disabled"} (optional; do NOT use by default)`);
  if (ratioDefault) {
    const quotaHint =
      typeof quotaMin === "number" ? ` (quota minRemainingPercent=${quotaMin}%)` : "";
    lines.push(`- agCodexRatio: DEFAULT (AG-first, quota-aware)${quotaHint}`);
    if (quotaFile) lines.push(`  - quota_file: ${normalizePathForMd(quotaFile)}`);
  } else if (ratioText) {
    lines.push(`- agCodexRatio: ${ratioText}`);
  }

  lines.push("");
  lines.push("Rules:");
  lines.push(
    "- ChatGPT: If useChatGPT is ENABLED, you MAY ask agent AG to consult ChatGPT when necessary (clarify/review). If disabled, avoid ChatGPT unless the user explicitly asked for it.",
  );
  lines.push(
    "- GitHub: If useGitHub is ENABLED and the project is not on GitHub yet, you MUST ask agent AG (browser) to create the GitHub repo + set remote + push (see doc/GIT_WORKFLOW.md). If you decide to use the Lovable workflow for a 'nice UI', it also requires the repo to exist on GitHub (see SPEC §14.4).",
  );
  lines.push(
    "- Lovable: If useLovable is ENABLED, you MAY ask agent AG to use Lovable (SPEC §14.4) to scaffold a nicer UI (mock/skeleton) and ensure it is committed/pushed to GitHub. Lovable requires a GitHub repo: if none exists, you MUST ask AG to create it even if useGitHub is disabled.",
  );
  lines.push(
    "- AG vs Codex ratio: This only applies when BOTH developers are viable for the task. If the task requires a browser/config action, it MUST go to agent AG regardless of ratio.",
  );
  if (ratioDefault) {
    if (quotaIsLow) {
      lines.push(
        "- Note (quota-aware): il est possible que vous, le Manager, deviez changer l'assignation des taches (doc/TODO.md) afin d'alterner AG/Codex tant que le quota reste bas (<= 40%).",
      );
    }
    lines.push(
      `- Default ratio policy (quota-aware) — IMPORTANT: treat this as a dispatch constraint, not just a suggestion.\n  - When BOTH developers are viable for a task, use agent AG as the default implementation developer.\n  - If AG quota is > 40% (see quota_file), then dispatch ALL such "either-dev" tasks to AG.\n  - If AG quota is <= 40% (see quota_file), then for tasks that could be done by either dev, alternate AG/Codex (~1 task out of 2 on AG) until quota recovers.${quotaIsLow ? " (quota is currently LOW)" : ""}`,
    );
  } else if (ratioText) {
    lines.push(
      "- Custom ratio: If agCodexRatio is provided, use it as a global heuristic for dispatch decisions (do not force technical incoherence).",
    );
  }
  return lines.join("\n");
}

function buildDynamicOptionsLineForAg(run) {
  const useChatGPT = run && typeof run.useChatGPT === "boolean" ? run.useChatGPT : false;
  const useGitHub = run && typeof run.useGitHub === "boolean" ? run.useGitHub : false;
  const useLovable = run && typeof run.useLovable === "boolean" ? run.useLovable : false;
  const ratioDefault = run && typeof run.agCodexRatioDefault === "boolean" ? run.agCodexRatioDefault : true;
  const ratio = run && typeof run.agCodexRatio === "string" ? run.agCodexRatio.trim() : "";
  const parts = [];
  parts.push(`useChatGPT=${useChatGPT ? "ENABLED" : "disabled"}`);
  parts.push(`useGitHub=${useGitHub ? "ENABLED" : "disabled"}`);
  parts.push(`useLovable=${useLovable ? "ENABLED" : "disabled"}`);
  if (ratioDefault) parts.push("agCodexRatio=DEFAULT(quota-aware)");
  else if (ratio) parts.push(`agCodexRatio="${ratio}"`);
  return parts.join(" | ");
}

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

function appendJsonlLine(filePath, obj) {
  try {
    if (!filePath) return false;
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function safeStatMtimeMs(p) {
  try {
    const s = fs.statSync(p);
    return typeof s?.mtimeMs === "number" ? s.mtimeMs : null;
  } catch {
    return null;
  }
}

function copyFileIfMissing({ src, dest }) {
  try {
    if (!src || !dest) return false;
    if (!fs.existsSync(src) || fs.existsSync(dest)) return false;
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

function copyFileIfChanged({ src, dest, maxBytes = 2 * 1024 * 1024 }) {
  try {
    if (!src || !dest) return false;
    if (!fs.existsSync(src)) return false;
    const srcStat = fs.statSync(src);
    if (!srcStat.isFile()) return false;
    if (srcStat.size > maxBytes) return false;

    const destExists = fs.existsSync(dest);
    if (!destExists) {
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      return true;
    }

    const destStat = fs.statSync(dest);
    if (!destStat.isFile()) return false;
    if (destStat.size !== srcStat.size) {
      fs.copyFileSync(src, dest);
      return true;
    }

    // If the source is newer, prefer copying even if size matches.
    if (Number(srcStat.mtimeMs) > Number(destStat.mtimeMs)) {
      fs.copyFileSync(src, dest);
      return true;
    }

    // Fallback: compare contents for small files.
    if (srcStat.size <= 512 * 1024) {
      const a = fs.readFileSync(src, "utf8");
      const b = fs.readFileSync(dest, "utf8");
      if (a !== b) {
        fs.copyFileSync(src, dest);
        return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function newUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function isProbablySafeDirName(name) {
  return /^[a-z0-9][a-z0-9_-]{1,48}[a-z0-9]$/.test(String(name || ""));
}

function slugifyDirName(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  const out = s
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  if (isProbablySafeDirName(out)) return out;
  return "project";
}

function pickDefaultProjectNameFromPrompt(prompt) {
  const p = String(prompt || "").trim();
  if (!p) return "project";
  // Prefer the first ~6 words to keep it stable and short.
  const words = p
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");
  return slugifyDirName(words);
}

function isDirEmpty(dirPath) {
  try {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return true;
    const ents = fs.readdirSync(dirPath);
    return ents.length === 0;
  } catch {
    return false;
  }
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

function parseExpectedSilenceMs(text) {
  if (!text) return null;
  let ms = null;
  const msMatch = String(text).match(/ag_expected_silence_ms\s*:\s*(\d+)/i);
  if (msMatch) {
    const value = Number(msMatch[1]);
    if (Number.isFinite(value) && value > 0) ms = value;
  }
  const minMatch = String(text).match(/ag_expected_silence_(?:minutes?|mins?)\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (minMatch) {
    const min = Number(minMatch[1]);
    if (Number.isFinite(min) && min > 0) {
      const v = Math.round(min * 60_000);
      ms = ms ? Math.max(ms, v) : v;
    }
  }
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.min(ms, AG_RESULT_TIMEOUT_MS);
}

function readAgExpectedSilenceMs(taskDir) {
  if (!taskDir) return null;
  const taskMd = path.join(taskDir, "task.md");
  const instr = path.join(taskDir, "manager_instruction.md");
  const taskText = fileExists(taskMd) ? readTextHead(taskMd, 4000) : null;
  const instrText = fileExists(instr) ? readTextHead(instr, 4000) : null;
  const values = [parseExpectedSilenceMs(taskText), parseExpectedSilenceMs(instrText)].filter(
    (v) => Number.isFinite(v) && v > 0,
  );
  if (!values.length) return null;
  return Math.max(...values);
}

function isBusyFsError(e) {
  const code = e && typeof e === "object" ? e.code : null;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function withBusyRetry(fn, { attempts = 8, baseDelayMs = 15, maxDelayMs = 200 } = {}) {
  let delay = baseDelayMs;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      if (!isBusyFsError(e) || i === attempts - 1) throw e;
      // Synchronous sleep to keep atomic write simple; best-effort only.
      const sab = new SharedArrayBuffer(4);
      const ia = new Int32Array(sab);
      Atomics.wait(ia, 0, 0, Math.max(0, delay | 0));
      delay = Math.min(maxDelayMs, Math.floor(delay * 1.7) + 1);
    }
  }
  throw lastErr;
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const json = JSON.stringify(value, null, 2) + "\n";
  withBusyRetry(() => fs.writeFileSync(tmp, json, "utf8"));
  try {
    withBusyRetry(() => fs.renameSync(tmp, filePath));
  } catch (e) {
    // Windows can fail rename if target exists; fall back to replace.
    try {
      withBusyRetry(() => fs.rmSync(filePath, { force: true }));
      withBusyRetry(() => fs.renameSync(tmp, filePath));
    } catch {
      // Last resort: non-atomic write (still valid JSON).
      withBusyRetry(() => fs.writeFileSync(filePath, json, "utf8"));
      try {
        withBusyRetry(() => fs.rmSync(tmp, { force: true }));
      } catch {
        // ignore
      }
      void e;
    }
  }
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = String(text ?? "") + (String(text ?? "").endsWith("\n") ? "" : "\n");
  withBusyRetry(() => fs.writeFileSync(tmp, payload, "utf8"));
  try {
    withBusyRetry(() => fs.renameSync(tmp, filePath));
  } catch (e) {
    try {
      withBusyRetry(() => fs.rmSync(filePath, { force: true }));
      withBusyRetry(() => fs.renameSync(tmp, filePath));
    } catch {
      withBusyRetry(() => fs.writeFileSync(filePath, payload, "utf8"));
      try {
        withBusyRetry(() => fs.rmSync(tmp, { force: true }));
      } catch {
        // ignore
      }
      void e;
    }
  }
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

function ensureEmptyFile(filePath) {
  try {
    ensureDir(path.dirname(filePath));
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, "", "utf8");
  } catch {
    // best-effort
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

function resumePacketAbsForRole(run, role) {
  if (!run || typeof run !== "object") return null;
  const packets = run.projectResumePackets && typeof run.projectResumePackets === "object" ? run.projectResumePackets : null;
  if (packets && packets[role]) return packets[role];
  return null;
}

function resumePacketRelForRole(run, role) {
  const abs = resumePacketAbsForRole(run, role);
  if (abs) return relPathForPrompt(run.cwd, abs);
  if (run && run.projectResumePacketPath) return relPathForPrompt(run.cwd, run.projectResumePacketPath);
  return null;
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

function extractManagerReviewTurnNonce(text) {
  const raw = String(text || "");
  const labeled = raw.match(/^\s*Turn nonce\s*:\s*(\S+)\s*$/im);
  if (labeled?.[1]) return String(labeled[1]).trim();
  const header = raw.match(/^\s*turn_nonce\s*:\s*(\S+)\s*$/im);
  if (header?.[1]) return String(header[1]).trim();
  const htmlComment = raw.match(/<!--\s*turn[_ -]?nonce\s*:\s*(\S+)\s*-->/i);
  return htmlComment?.[1] ? String(htmlComment[1]).trim() : null;
}

function taskContext(run, taskIdOverride) {
  const tasksRoot = run.projectTasksDir || path.join(run.cwd, "data", "tasks");
  const taskId = taskIdOverride || run.currentTaskId || "<current_task_id>";
  const taskDir = path.join(tasksRoot, taskId);
  return {
    taskId,
    taskDir,
    taskDirRel: relPathForPrompt(run.cwd, taskDir),
  };
}

function taskLongJobHistoryPaths(run, taskIdOverride) {
  const { taskDir, taskDirRel } = taskContext(run, taskIdOverride);
  const jsonAbs = path.join(taskDir, "long_job_history.json");
  const mdAbs = path.join(taskDir, "long_job_history.md");
  return {
    jsonAbs,
    mdAbs,
    jsonRel: relPathForPrompt(run.cwd, jsonAbs),
    mdRel: relPathForPrompt(run.cwd, mdAbs),
    taskDir,
    taskDirRel,
  };
}

function taskLongJobOutcomePaths(run, taskIdOverride) {
  const { taskDir, taskDirRel } = taskContext(run, taskIdOverride);
  const jsonAbs = path.join(taskDir, "latest_long_job_outcome.json");
  const mdAbs = path.join(taskDir, "latest_long_job_outcome.md");
  return {
    jsonAbs,
    mdAbs,
    jsonRel: relPathForPrompt(run.cwd, jsonAbs),
    mdRel: relPathForPrompt(run.cwd, mdAbs),
    taskDir,
    taskDirRel,
  };
}

function buildResultOutputs(result) {
  const nestedOutputs = Array.isArray(result?.outputs)
    ? result.outputs.slice(0, 6).map((entry) => ({
      label: typeof entry?.label === "string" ? entry.label : null,
      policy: typeof entry?.policy === "string" ? entry.policy : null,
      output: typeof entry?.output === "string" ? entry.output : null,
      summary: entry?.summary && typeof entry.summary === "object" ? entry.summary : null,
    }))
    : [];
  if (nestedOutputs.length) return nestedOutputs;
  if (typeof result?.output === "string" || (result?.summary && typeof result.summary === "object")) {
    return [{
      label: typeof result?.label === "string" ? result.label : "primary_output",
      policy: typeof result?.policy === "string" ? result.policy : null,
      output: typeof result?.output === "string" ? result.output : null,
      summary: result?.summary && typeof result.summary === "object" ? result.summary : null,
    }];
  }
  return [];
}

function extractMarkdownSectionBody(text, label) {
  const raw = String(text || "");
  if (!raw.trim() || !label) return "";
  const lines = raw.split(/\r?\n/);
  const labelRegex = new RegExp(`^\\s*${escapeRegex(label)}\\s*:\\s*$`, "i");
  const genericHeaderRegex = /^[A-Za-z][A-Za-z0-9 _/()\-]{2,80}:\s*$/;
  const out = [];
  let inSection = false;
  for (const line of lines) {
    if (!inSection) {
      if (labelRegex.test(line)) inSection = true;
      continue;
    }
    const trimmed = String(line || "").trim();
    if (!trimmed && !out.length) continue;
    if (/^#{1,6}\s+/.test(trimmed)) break;
    if (genericHeaderRegex.test(trimmed) && !/^\s*[-*]\s+/.test(trimmed) && !/^\s*\d+\)\s+/.test(trimmed) && !/^\s*\d+\.\s+/.test(trimmed)) {
      break;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

function extractMarkdownSectionItems(text, label) {
  const body = extractMarkdownSectionBody(text, label);
  if (!body) return [];
  return body
    .split(/\r?\n/)
    .map((line) => String(line || "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, "").trim())
    .filter(Boolean);
}

function parseManagerReviewSummary(text) {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const decisionMatch = raw.match(/^\s*Decision\s*:\s*\*\*(ACCEPTED|REWORK)\*\*/im);
  const reviewedAtMatch = raw.match(/^\s*Reviewed_at\s*:\s*(.+)\s*$/im);
  const turnNonce = extractManagerReviewTurnNonce(raw);
  const referencedJobIds = Array.from(new Set((raw.match(/\bjob-[A-Za-z0-9_-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\b/g) || []).map((v) => String(v))));
  return {
    decision: decisionMatch?.[1] ? String(decisionMatch[1]).toUpperCase() : null,
    reviewedAt: reviewedAtMatch?.[1] ? String(reviewedAtMatch[1]).trim() : null,
    turnNonce: turnNonce || null,
    reasons: extractMarkdownSectionItems(raw, "Reasons (short)"),
    goalCheck: extractMarkdownSectionItems(raw, "Goal check"),
    rerunJustification: extractMarkdownSectionItems(raw, "Rerun justification"),
    reworkRequest: extractMarkdownSectionItems(raw, "Rework request"),
    nextActions: extractMarkdownSectionItems(raw, "Next actions"),
    referencedJobIds,
    excerpt: clampString(raw, 4000),
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
  const toolsDir = path.join(cwd, "tools");
  const antidexDir = path.join(dataDir, "antidex");
  const manifestPath = path.join(antidexDir, "manifest.json");
  const migrationsPath = path.join(antidexDir, "migrations.jsonl");
  const tasksDir = path.join(dataDir, "tasks");
  const mailboxDir = path.join(dataDir, "mailbox");
  const mailboxToCodex = path.join(mailboxDir, "to_developer_codex");
  const mailboxFromCodex = path.join(mailboxDir, "from_developer_codex");
  const mailboxToAg = path.join(mailboxDir, "to_developer_antigravity");
  const mailboxFromAg = path.join(mailboxDir, "from_developer_antigravity");
  const userCommandsDir = path.join(dataDir, "user_commands");
  const agRunsDir = path.join(dataDir, "antigravity_runs");
  const agReportsDir = path.join(dataDir, "AG_internal_reports");
  const turnMarkersDir = path.join(dataDir, "turn_markers");
  const agentsMdPath = path.join(cwd, "AGENTS.md");

  ensureDirTracked(docDir);
  ensureDirTracked(agentsDir);
  ensureDirTracked(dataDir);
  ensureDirTracked(toolsDir);
  ensureDirTracked(antidexDir);
  ensureDirTracked(tasksDir);
  ensureDirTracked(mailboxDir);
  ensureDirTracked(mailboxToCodex);
  ensureDirTracked(mailboxFromCodex);
  ensureDirTracked(mailboxToAg);
  ensureDirTracked(mailboxFromAg);
  ensureDirTracked(userCommandsDir);
  ensureDirTracked(agRunsDir);
  ensureDirTracked(agReportsDir);
  ensureDirTracked(turnMarkersDir);

  // Ensure an AGENTS.md at the project root so Codex picks *project-local* instructions
  // instead of falling back to unrelated parent instructions (which can inject noisy "skills" blocks).
  // Keep this file intentionally short and stable; detailed role instructions live in agents/*.md.
  mark(
    agentsMdPath,
    writeFileIfMissing(
      agentsMdPath,
      [
        "# Antidex — AGENTS (Project Root)",
        "",
        "This file provides **project-local** instructions for Codex agents working in this repository.",
        "",
        "- Start by reading: `doc/INDEX.md` and `doc/DOCS_RULES.md`.",
        "- Follow role instructions in `agents/manager.md`, `agents/developer_codex.md`, `agents/developer_antigravity.md`.",
        "- Use file-based coordination under `data/` (tasks, Q/A, results, markers).",
        "- Keep changes traceable and documented; do not assume instructions from parent folders apply here.",
        "",
      ].join("\n"),
    ),
  );

  // Migration tracking file: created if missing (empty JSONL is fine).
  mark(migrationsPath, writeFileIfMissing(migrationsPath, ""));

  // Project-local Antidex CLI helper (used for long jobs).
  // This is intentionally small and self-contained so developers can start background jobs
  // without needing to hardcode paths to the orchestrator repo.
  const toolAntidexJs = path.join(toolsDir, "antidex.js");
  const toolAntidexCmd = path.join(toolsDir, "antidex.cmd");
  const toolAntidexPs1 = path.join(toolsDir, "antidex.ps1");
  const toolReadme = path.join(toolsDir, "README.md");
  mark(
    toolAntidexJs,
    writeFileIfMissing(
      toolAntidexJs,
      [
        "/* eslint-disable no-console */",
        'const fs = require("node:fs");',
        'const path = require("node:path");',
        'const os = require("node:os");',
        "",
        "function ensureDir(p) {",
        "  if (!p) return;",
        "  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });",
        "}",
        "",
        "function nowIso() {",
        "  return new Date().toISOString();",
        "}",
        "",
        "function nowIsoForFile() {",
        "  return nowIso().replace(/[:.]/g, \"-\");",
        "}",
        "",
        "function writeJsonAtomic(filePath, value) {",
        "  ensureDir(path.dirname(filePath));",
        "  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;",
        "  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + \"\\n\", \"utf8\");",
        "  try {",
        "    fs.renameSync(tmpPath, filePath);",
        "  } catch {",
        "    try { fs.rmSync(filePath, { force: true }); } catch { /* ignore */ }",
        "    fs.renameSync(tmpPath, filePath);",
        "  }",
        "}",
        "",
        "function usage() {",
        "  console.log([",
        "    \"Antidex project helper (local).\",",
        "    \"\",",
        "    \"Usage:\",",
        "    \"  tools\\\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 --script .\\\\scripts\\\\bench.cmd\",",
        "    \"  tools\\\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 -- node .\\\\scripts\\\\bench.js --seed 1\",",
        "    \"  tools\\\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 --command \\\"node scripts/bench.js\\\"\",",
        "    \"\",",
        "    \"Notes:\",",
        "    \"- Writes a request JSON to data/jobs/requests/*.json for the orchestrator.\",",
        "    \"- The orchestrator spawns the background process and monitors it.\",",
        "    \"- Prefer --script or the argv form after `--` on Windows; both avoid nested shell quoting bugs.\",",
        "    \"- --command remains supported for simple shell commands but is less robust on Windows.\",",
        "  ].join(\"\\n\"));",
        "}",
        "",
        "function parseArgs(argv) {",
        "  const out = { _: [] };",
        "  for (let i = 0; i < argv.length; i += 1) {",
        "    const a = argv[i];",
        "    if (a === \"--\") {",
        "      out._.push(...argv.slice(i + 1));",
        "      break;",
        "    }",
        "    if (a && a.startsWith(\"--\")) {",
        "      const k = a.slice(2);",
        "      const v = argv[i + 1];",
        "      if (v && !v.startsWith(\"--\")) {",
        "        out[k] = v;",
        "        i += 1;",
        "      } else {",
        "        out[k] = true;",
        "      }",
        "      continue;",
        "    }",
        "    out._.push(a);",
        "  }",
        "  return out;",
        "}",
        "",
        "function parseJsonArray(value, label) {",
        "  try {",
        "    const parsed = JSON.parse(String(value || \"\"));",
        "    if (!Array.isArray(parsed) || !parsed.length) throw new Error(\"must be a non-empty JSON array\");",
        "    return parsed.map((item) => String(item));",
        "  } catch (e) {",
        "    throw new Error(`${label} must be a JSON array of strings (${e instanceof Error ? e.message : String(e)})`);",
        "  }",
        "}",
        "",
        "function quoteArgForDisplay(value) {",
        "  const s = String(value ?? \"\");",
        "  if (!s) return '\\\"\\\"';",
        "  if (!/[\\s\"]/u.test(s)) return s;",
        "  return `\\\"${s.replace(/([\\\"\\\\\\\\])/g, \"\\\\$1\")}\\\"`;",
        "}",
        "",
        "function formatArgvForDisplay(argv) {",
        "  return argv.map((item) => quoteArgForDisplay(item)).join(\" \");",
        "}",
        "",
        "function inferScriptArgv(scriptPath) {",
        "  const p = String(scriptPath || \"\").trim();",
        "  if (!p) throw new Error(\"Missing --script path\");",
        "  const ext = path.extname(p).toLowerCase();",
        "  if (ext === \".ps1\") return [\"powershell.exe\", \"-NoProfile\", \"-ExecutionPolicy\", \"Bypass\", \"-File\", p];",
        "  if (ext === \".js\" || ext === \".cjs\" || ext === \".mjs\") return [\"node\", p];",
        "  if (ext === \".cmd\" || ext === \".bat\") return [\"cmd.exe\", \"/d\", \"/c\", p];",
        "  return os.platform() === \"win32\" ? [\"cmd.exe\", \"/d\", \"/c\", p] : [p];",
        "}",
        "",
        "function main() {",
        "  const argv = process.argv.slice(2);",
        "  if (!argv.length) return usage();",
        "",
        "  const cmd = argv[0];",
        "  const sub = argv[1];",
        "  const args = parseArgs(argv.slice(2));",
        "",
        "  if (cmd !== \"job\" || sub !== \"start\") {",
        "    return usage();",
        "  }",
        "",
        "  const runId = args[\"run-id\"] ? String(args[\"run-id\"]).trim() : \"\";",
        "  const taskId = args[\"task-id\"] ? String(args[\"task-id\"]).trim() : \"\";",
        "  const expectedMinutes = args[\"expected-minutes\"] ? Number(args[\"expected-minutes\"]) : null;",
        "  const monitorEveryMinutes = args[\"monitor-every-minutes\"] ? Number(args[\"monitor-every-minutes\"]) : null;",
        "  const monitorGraceMinutes = args[\"monitor-grace-minutes\"] ? Number(args[\"monitor-grace-minutes\"]) : null;",
        "  const jobId = args[\"job-id\"] ? String(args[\"job-id\"]).trim() : \"\";",
        "  const scriptPath = args.script ? String(args.script).trim() : \"\";",
        "  const argvFromJson = args[\"command-argv-json\"] ? parseJsonArray(args[\"command-argv-json\"], \"--command-argv-json\") : [];",
        "  const argvFromRemainder = Array.isArray(args._) && args._.length ? args._.map((item) => String(item)) : [];",
        "  const commandArgv = scriptPath ? inferScriptArgv(scriptPath) : (argvFromJson.length ? argvFromJson : argvFromRemainder);",
        "  const launchKind = scriptPath ? \"script\" : (commandArgv.length ? \"argv\" : (rawCommand.trim() ? \"command\" : null));",
        "  const rawCommand = args.command ? String(args.command) : \"\";",
        "",
        "  if (scriptPath && (rawCommand.trim() || argvFromJson.length || argvFromRemainder.length)) {",
        "    console.error(\"Use either --script, --command-argv-json, argv after --, or --command, but not several forms at once.\");",
        "    process.exitCode = 2;",
        "    return;",
        "  }",
        "  if (argvFromJson.length && argvFromRemainder.length) {",
        "    console.error(\"Use either --command-argv-json or argv after --, but not both.\");",
        "    process.exitCode = 2;",
        "    return;",
        "  }",
        "",
        "  const command = commandArgv.length ? formatArgvForDisplay(commandArgv) : rawCommand.trim();",
        "  if (!command) {",
        "    console.error(\"Missing launch command. Use --script, argv after --, --command-argv-json, or --command.\");",
        "    process.exitCode = 2;",
        "    return;",
        "  }",
        "",
        "  const cwd = process.cwd();",
        "  const requestsDir = path.join(cwd, \"data\", \"jobs\", \"requests\");",
        "  ensureDir(requestsDir);",
        "",
        "  const ts = nowIsoForFile().slice(0, 19);",
        "  const safeTask = (taskId || \"task\").replace(/[^A-Za-z0-9_-]/g, \"-\");",
        "  const safeRun = (runId || \"run\").replace(/[^A-Za-z0-9_-]/g, \"-\").slice(0, 12);",
        "  const file = `REQ-${ts}-${safeRun}-${safeTask}.json`;",
        "  const outPath = path.join(requestsDir, file);",
        "",
        "  const payload = {",
        "    schema: \"antidex.long_job.request.v1\",",
        "    created_at: nowIso(),",
        "    run_id: runId || null,",
        "    task_id: taskId || null,",
        "    job_id: jobId || null,",
        "    expected_minutes: Number.isFinite(expectedMinutes) ? expectedMinutes : null,",
        "    monitor_every_minutes: Number.isFinite(monitorEveryMinutes) ? monitorEveryMinutes : null,",
        "    monitor_grace_minutes: Number.isFinite(monitorGraceMinutes) ? monitorGraceMinutes : null,",
        "    launch_kind: launchKind,",
        "    script_path: scriptPath || null,",
        "    command,",
        "    command_argv: commandArgv.length ? commandArgv : null,",
      "  };",
        "  writeJsonAtomic(outPath, payload);",
        "  console.log(`Wrote job request: ${path.relative(cwd, outPath)}`);",
        "}",
        "",
        "try {",
        "  main();",
        "} catch (e) {",
        "  console.error(e && e.stack ? e.stack : String(e));",
        "  process.exitCode = 1;",
        "}",
        "",
      ].join("\n"),
    ),
  );
  mark(toolAntidexCmd, writeFileIfMissing(toolAntidexCmd, ['@echo off', 'node \"%~dp0antidex.js\" %*', ''].join("\r\n")));
  mark(
    toolAntidexPs1,
    writeFileIfMissing(
      toolAntidexPs1,
      [
        "param([Parameter(ValueFromRemainingArguments=$true)][string[]]$Args)",
        "node \"$PSScriptRoot\\antidex.js\" @Args",
        "",
      ].join("\r\n"),
    ),
  );
  mark(
    toolReadme,
    writeFileIfMissing(
      toolReadme,
      [
        "# tools/ — Antidex helpers",
        "",
        "This folder contains small, project-local helpers used by the Antidex orchestrator.",
        "",
        "## Long jobs (background compute)",
        "",
        "Start a background job request (the orchestrator will spawn + monitor it):",
        "",
        "```bat",
        "tools\\antidex.cmd job start --run-id <RUN_ID> --task-id <TASK_ID> --expected-minutes 120 --script .\\scripts\\bench.cmd",
        "tools\\antidex.cmd job start --run-id <RUN_ID> --task-id <TASK_ID> --expected-minutes 120 -- node .\\scripts\\bench.js --seed 1",
        "```",
        "",
        "The request is written under `data/jobs/requests/`.",
        "",
        "Notes:",
        "- Prefer `--script` or the argv form after `--` on Windows.",
        "- `--command \"...\"` is still supported for simple cases, but nested shell quoting is fragile on Windows.",
        "",
      ].join("\n"),
    ),
  );

  // Load manifest early so we can decide whether a migration is required.
  const manifestRead = readJsonBestEffort(manifestPath);
  const hadManifest = fs.existsSync(manifestPath);
  let manifest = manifestRead.ok ? manifestRead.value : null;
  let manifestInvalid = false;
  if (hadManifest && !manifestRead.ok) {
    manifestInvalid = true;
    // Keep the invalid file as a backup, then recreate a valid manifest.
    try {
      const backup = path.join(antidexDir, `manifest.invalid.${nowIsoForFile()}.json`);
      fs.renameSync(manifestPath, backup);
      mark(backup, true);
    } catch {
      // ignore; we'll still attempt to overwrite the manifest path below
    }
    manifest = null;
  }

  const fromLayoutVersionRaw = manifest && typeof manifest === "object" ? manifest.layout_version : null;
  const fromLayoutVersion = Number.isInteger(fromLayoutVersionRaw) ? fromLayoutVersionRaw : 0;
  const needsMigration = hadManifest && !manifestInvalid && fromLayoutVersion < ANTIDEX_LAYOUT_VERSION;

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
        "- `data/antidex/manifest.json` - Antidex project marker (project_id + layout_version). (owner: System/Manager)",
        "- `data/antidex/migrations.jsonl` - Layout migration log (JSONL). (owner: System)",
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
    writeFileIfMissing(
      path.join(docDir, "TODO.md"),
      [
        "# TODO",
        "",
        "Règle: ce fichier est user-editable. Le Manager le relit avant chaque dispatch.",
        "",
        "Format:",
        "- Chaque tÃ¢che doit Ãªtre une checklist item (commence par: - [ ] ou - [x]).",
        "- Chaque item doit contenir exactement UN owner dans des parenthÃ¨ses: (developer_codex) OU (developer_antigravity).",
        "- Chaque item doit contenir un identifiant de tÃ¢che du style: T-001_short_slug (lettres/chiffres/_/-).",
        "",
        "Note: n’utilise pas (Manager) dans les items TODO. Les tâches doivent être dispatchables à un dev.",
        "",
      ].join("\n"),
    ),
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
    ag_conversation: {
      started: false,
      started_at: null,
      last_used_at: null,
      last_reset_at: null,
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

  // Ensure or migrate Antidex manifest (non-destructive, traceable).
  if (!hadManifest || manifestInvalid || !manifest || typeof manifest !== "object") {
    const iso = nowIso();
    const newManifest = {
      marker: ANTIDEX_MARKER,
      marker_version: ANTIDEX_MARKER_VERSION,
      project_id: newUuid(),
      project_name: path.basename(cwd),
      layout_version: ANTIDEX_LAYOUT_VERSION,
      ag_conversation: {
        started: false,
        started_at: null,
        last_used_at: null,
        last_reset_at: null,
      },
      created_at: iso,
      updated_at: iso,
      antidex_orchestrator: { name: "Antidex", version: ORCHESTRATOR_VERSION },
    };
    writeJsonAtomic(manifestPath, newManifest);
    mark(manifestPath, !hadManifest);
  } else if (needsMigration) {
    const iso = nowIso();
    const updated = { ...manifest };
    updated.marker = ANTIDEX_MARKER;
    updated.marker_version = ANTIDEX_MARKER_VERSION;
    if (typeof updated.project_id !== "string" || !updated.project_id.trim()) updated.project_id = newUuid();
    if (typeof updated.project_name !== "string" || !updated.project_name.trim()) updated.project_name = path.basename(cwd);
    updated.layout_version = ANTIDEX_LAYOUT_VERSION;
    if (!updated.ag_conversation || typeof updated.ag_conversation !== "object") {
      updated.ag_conversation = { started: false, started_at: null, last_used_at: null, last_reset_at: null };
    } else {
      const ag = updated.ag_conversation;
      if (ag.started !== true && ag.started !== false) ag.started = false;
      if (typeof ag.started_at !== "string") ag.started_at = null;
      if (typeof ag.last_used_at !== "string") ag.last_used_at = null;
      if (typeof ag.last_reset_at !== "string") ag.last_reset_at = null;
    }
    if (typeof updated.created_at !== "string" || !updated.created_at.trim()) updated.created_at = iso;
    updated.updated_at = iso;
    updated.antidex_orchestrator = { name: "Antidex", version: ORCHESTRATOR_VERSION };

    writeJsonAtomic(manifestPath, updated);

    try {
      const relActions = created
        .map((p) => normalizePathForMd(path.relative(cwd, p) || p))
        .filter(Boolean);
      const actions = relActions.length > 60 ? [...relActions.slice(0, 60), `... (+${relActions.length - 60} more)`] : relActions;
      fs.appendFileSync(
        migrationsPath,
        JSON.stringify(
          {
            at: iso,
            from_layout_version: fromLayoutVersion,
            to_layout_version: ANTIDEX_LAYOUT_VERSION,
            actions,
            status: "ok",
          },
          null,
          0,
        ) + "\n",
        "utf8",
      );
    } catch {
      // best-effort
    }
  } else {
    mark(manifestPath, false);
  }

  return {
    created,
    existing,
    docDir,
    agentsDir,
    dataDir,
    antidexDir,
    manifestPath,
    migrationsPath,
    tasksDir,
    userCommandsDir,
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

function tryParseIsoToMs(value) {
  const s = typeof value === "string" ? value.trim() : "";
  if (!s) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function safeStat(filePath) {
  try {
    return fs.existsSync(filePath) ? fs.statSync(filePath) : null;
  } catch {
    return null;
  }
}

function maxMtimeMsUnderPath(p, { maxEntries = 2000, ignoreDirNames } = {}) {
  const root = typeof p === "string" ? p : null;
  if (!root) return null;

  const ignore =
    ignoreDirNames instanceof Set
      ? new Set(Array.from(ignoreDirNames).map((v) => String(v || "").trim().toLowerCase()).filter(Boolean))
      : null;

  let max = null;
  const stack = [root];
  let seen = 0;

  while (stack.length && seen < maxEntries) {
    const cur = stack.pop();
    const st = safeStat(cur);
    if (!st) continue;
    max = max == null ? st.mtimeMs : Math.max(max, st.mtimeMs);
    seen += 1;

    if (st.isDirectory()) {
      if (ignore) {
        const base = path.basename(cur).trim().toLowerCase();
        if (base && ignore.has(base)) continue;
      }
      try {
        const names = fs.readdirSync(cur);
        for (const name of names) stack.push(path.join(cur, name));
      } catch {
        // ignore
      }
    }
  }

  return max;
}

function appendRecoveryLog(run, entry) {
  const logPath = run?.projectRecoveryLogPath || run?.recoveryLogPath || null;
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, JSON.stringify({ at: nowIso(), ...(entry || {}) }) + "\n", "utf8");
  } catch {
    // best-effort
  }
}

function writeTaskQuestion({ taskDir, prefix = "Q", title, body }) {
  ensureDir(path.join(taskDir, "questions"));
  const safePrefix = String(prefix || "Q").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || "Q";
  const ts = nowIsoForFile().slice(0, 19);
  const fileName = `${safePrefix}-${ts}.md`;
  const p = path.join(taskDir, "questions", fileName);
  const content = [`# ${title || "Question"}`, "", String(body || "").trim(), ""].join("\n");
  fs.writeFileSync(p, content, "utf8");
  return p;
}

function clampString(value, maxLen) {
  const s = String(value ?? "");
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "\n[...truncated]\n";
}

function clampInt(value, min, max) {
  const n = Number.isFinite(value) ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function todoHasDisallowedManagerOwner(todoText) {
  const t = String(todoText ?? "");
  if (!t.trim()) return false;
  return /\(\s*manager\s*\)/i.test(t) || /\bP[0-9]\s*\(\s*manager\s*\)/i.test(t) || /\bowner\s*:\s*manager\b/i.test(t);
}

function readTextBestEffort(p, maxBytes = 200_000) {
  try {
    if (!p || !fs.existsSync(p)) return "";
    const buf = fs.readFileSync(p);
    const sliced = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
    return sliced.toString("utf8");
  } catch {
    return "";
  }
}

function escapeRegex(value) {
  return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTaskKindFromText(taskText) {
  const text = String(taskText || "");
  const match = text.match(/^\s*task_kind\s*:\s*([^\n\r#]+)/im);
  return match ? String(match[1]).trim().toLowerCase() : "";
}

function isOutcomeDrivenTask({ taskKind, taskText } = {}) {
  const kind = String(taskKind || "").trim().toLowerCase();
  const text = String(taskText || "").toLowerCase();
  if (kind === "manual_test") return true;
  if (kind === "ai_baseline_fix") return true;
  if (/(^|_)(benchmark|gate|tuning|research)(_|$)/.test(kind)) return true;
  if (/\bstrength\s+gate\b/.test(text)) return true;
  if (/\bbenchmark(?:s|ing)?\b/.test(text)) return true;
  if (/\btuning\b/.test(text)) return true;
  if (/\bresearch\b/.test(text)) return true;
  if (/\bmanual\s+(?:test|validation)\b/.test(text)) return true;
  return false;
}

function readTaskSpecMeta(taskDir, { maxChars = 12_000 } = {}) {
  const taskMdAbs = path.join(taskDir || "", "task.md");
  const taskText = readTextHead(taskMdAbs, maxChars) || "";
  const taskKind = parseTaskKindFromText(taskText);
  return {
    taskText,
    taskKind,
    outcomeDriven: isOutcomeDrivenTask({ taskKind, taskText }),
  };
}

function readMarkdownLabeledValue(text, label) {
  const lines = String(text || "").split(/\r?\n/);
  const labelRe = new RegExp(`^\\s*(?:[-*]\\s*)?${escapeRegex(label)}\\s*:\\s*(.*)$`, "i");
  const otherLabelRe = /^\s*(?:[-*]\s*)?[A-Za-z][A-Za-z0-9 _/?()-]{2,80}\s*:\s*(.*)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(labelRe);
    if (!match) continue;
    const inline = String(match[1] || "").trim();
    if (inline) return inline;
    for (let j = i + 1; j < lines.length; j += 1) {
      const raw = String(lines[j] || "");
      const trimmed = raw.trim();
      if (!trimmed) continue;
      if (/^\s*#{1,6}\s+/.test(trimmed)) break;
      if (otherLabelRe.test(raw)) break;
      return trimmed;
    }
    return "";
  }
  return null;
}

function hasMarkdownLabeledValue(text, label) {
  const value = readMarkdownLabeledValue(text, label);
  if (value !== null && value !== "") return true;
  const sectionBody = extractMarkdownSectionBody(text, label);
  return typeof sectionBody === "string" && sectionBody.trim().length > 0;
}

function extractMarkdownNamedBlock(text, heading, stopLabels = []) {
  const lines = String(text || "").split(/\r?\n/);
  const headingRe = new RegExp(`^\\s*${escapeRegex(heading)}\\s*:\\s*$`, "i");
  const stopRes = (Array.isArray(stopLabels) ? stopLabels : [])
    .map((label) => String(label || "").trim())
    .filter(Boolean)
    .map((label) => new RegExp(`^\\s*${escapeRegex(label)}\\s*:\\s*$`, "i"));
  const idx = lines.findIndex((line) => headingRe.test(String(line || "")));
  if (idx < 0) return null;
  const body = [];
  for (let i = idx + 1; i < lines.length; i += 1) {
    const raw = String(lines[i] || "");
    const trimmed = raw.trim();
    if (/^\s*#{1,6}\s+/.test(trimmed)) break;
    if (stopRes.some((re) => re.test(trimmed))) break;
    body.push(raw);
  }
  return body.join("\n");
}

function normalizeOutcomeFailureType(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "local_task_issue") return v;
  if (v === "measurement_or_protocol_issue") return v;
  if (v === "upstream_plan_issue") return v;
  return null;
}

function normalizeReviewedEvidenceReuseDirective(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v) return null;
  if (["yes", "y", "true", "allowed", "allow", "reuse", "ok"].includes(v)) return "yes";
  if (["no", "n", "false", "forbid", "forbidden", "deny", "ask_manager"].includes(v)) return "no";
  return null;
}

function getOutcomeSuggestionObject(jsonValue) {
  if (!jsonValue || typeof jsonValue !== "object") return null;
  if (jsonValue.what_this_suggests_next && typeof jsonValue.what_this_suggests_next === "object") {
    return jsonValue.what_this_suggests_next;
  }
  if (
    jsonValue.output &&
    typeof jsonValue.output === "object" &&
    jsonValue.output.what_this_suggests_next &&
    typeof jsonValue.output.what_this_suggests_next === "object"
  ) {
    return jsonValue.output.what_this_suggests_next;
  }
  return null;
}

function validateOutcomeSuggestionObject(obj) {
  const value = obj && typeof obj === "object" ? obj : null;
  if (!value) return { ok: false, missing: ["what_this_suggests_next"] };
  const required = [
    "observed_signal",
    "likely_cause",
    "can_current_task_still_succeed_as_is",
    "recommended_next_step",
    "smallest_confirming_experiment",
  ];
  const missing = required.filter((key) => {
    const field = value[key];
    return typeof field !== "string" || !field.trim();
  });
  return { ok: missing.length === 0, missing };
}

function validateOutcomeSuggestionMarkdown(text) {
  const required = [
    "Observed signal",
    "Likely cause",
    "Can current task still succeed as-is?",
    "Recommended next step",
    "Smallest confirming experiment",
  ];
  const missing = [];
  if (!/^\s*What this suggests next\s*:\s*$/im.test(String(text || ""))) {
    missing.push("What this suggests next");
  }
  for (const label of required) {
    if (!hasMarkdownLabeledValue(text, label)) missing.push(label);
  }
  return { ok: missing.length === 0, missing };
}

function findRulesSummaryPaths(projectCwd) {
  const out = [];
  try {
    const tasksDir = path.join(projectCwd, "data", "tasks");
    if (!fs.existsSync(tasksDir)) return out;
    const ents = fs.readdirSync(tasksDir, { withFileTypes: true });
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const p = path.join(tasksDir, ent.name, "rules_summary.md");
      if (fs.existsSync(p)) out.push(p);
    }
  } catch {
    return out;
  }
  return out;
}

function specHasConfirmedRulesMarker(specText) {
  const t = String(specText ?? "");
  if (!t.trim()) return false;
  return /^\s*##\s+R[èe]gles\s+confirm[ée]es\b/im.test(t) || /\bANTIDEX_CONFIRMED_RULES\s*:\s*YES\b/i.test(t);
}

function parseTodoNextUndone(todoText) {
  const text = String(todoText ?? "");
  const lines = text.split(/\r?\n/);

  const normalizeOwner = (raw) => {
    const r = String(raw ?? "").trim().toLowerCase();
    if (!r) return null;
    if (r.includes("ag") || r.includes("antigravity")) return "developer_antigravity";
    if (r.includes("codex") || r.includes("dev") || r.includes("developer")) return "developer_codex";
    return null;
  };

  for (const line of lines) {
    // Typical formats supported:
    // 1. [ ] (AG) T-001_xxx — ...
    // - [ ] P0 (Codex) T-001_xxx — ...
    // - [ ] P0 (developer_antigravity) T-001_xxx ...
    const m = line.match(/\[\s*([xX ])\s*\].*?\(\s*([^)]+?)\s*\).*?\b(T-[A-Za-z0-9][A-Za-z0-9_-]*)\b/);
    if (!m) continue;
    const checked = String(m[1]).trim().toLowerCase() === "x";
    const ownerRaw = m[2];
    const taskId = m[3];
    // Ignore template/example lines that document the format (not actionable tasks).
    // Common pattern: pipe-separated owner like "(developer_codex|developer_antigravity)" and/or placeholder task id.
    if (String(ownerRaw || "").includes("|")) continue;
    if (/^T-xxx_slug$/i.test(String(taskId || ""))) continue;
    if (checked) continue;
    const owner = normalizeOwner(ownerRaw);
    return { taskId, owner, rawLine: line };
  }
  return null;
}

function computeTodoFingerprint(todoText) {
  const normalizedText = String(todoText ?? "").replace(/\r\n/g, "\n");
  const next = parseTodoNextUndone(normalizedText);
  return {
    hash: crypto.createHash("sha256").update(normalizedText).digest("hex"),
    firstUncheckedTaskId: next?.taskId || null,
    firstUncheckedOwner: next?.owner || null,
    firstUncheckedLine: next?.rawLine ? String(next.rawLine).trim().slice(0, 500) : null,
  };
}

function sameTodoFingerprint(a, b) {
  return Boolean(a && b && a.hash && b.hash && String(a.hash) === String(b.hash));
}

function normalizeDeveloperStatus(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "ready_for_review") return "ready_for_review";
  if (v === "ongoing") return "ongoing";
  if (v === "waiting_job") return "waiting_job";
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

function readManifestAgConversationStarted(manifestPath) {
  const r = readJsonBestEffort(manifestPath);
  if (!r.ok) return false;
  const m = r.value;
  if (!m || typeof m !== "object") return false;
  const ag = m.ag_conversation;
  if (!ag || typeof ag !== "object") return false;
  return ag.started === true;
}

function updateManifestAgConversation({ manifestPath, wantNewThread, atIso }) {
  try {
    const r = readJsonBestEffort(manifestPath);
    if (!r.ok || !r.value || typeof r.value !== "object") return false;
    const updated = { ...r.value };
    const prev = updated.ag_conversation && typeof updated.ag_conversation === "object" ? updated.ag_conversation : {};
    const ag = { ...prev };
    ag.started = true;
    if (!ag.started_at) ag.started_at = atIso;
    ag.last_used_at = atIso;
    if (wantNewThread) ag.last_reset_at = atIso;
    updated.ag_conversation = ag;
    updated.updated_at = atIso;
    writeJsonAtomic(manifestPath, updated);
    return true;
  } catch {
    return false;
  }
}

function quoteArgForDisplay(value) {
  const s = String(value ?? "");
  if (!s) return '""';
  if (!/[\s"]/u.test(s)) return s;
  return `"${s.replace(/(["\\])/g, "\\$1")}"`;
}

function formatArgvForDisplay(argv) {
  return Array.isArray(argv) ? argv.map((item) => quoteArgForDisplay(item)).join(" ") : "";
}

class PipelineManager extends EventEmitter {
  constructor({ dataDir, rootDir } = {}) {
    super();
    this._dataDir = dataDir;
    ensureDir(this._dataDir);
    this._logsDir = path.join(this._dataDir, "logs");
    ensureDir(this._logsDir);
    this._rootDir = rootDir ? path.resolve(String(rootDir)) : path.resolve(this._dataDir, "..");

    this._state = new PipelineStateStore({ filePath: path.join(this._dataDir, "pipeline_state.json") });
    this._codex = process.env.ANTIDEX_FAKE_CODEX === "1" ? new FakeCodexAppServerClient() : new CodexAppServerClient({ trace: false });
    this._connector = null;
    this._connectorBaseUrl = null;
    this._initialized = false;
    this._codexHomeDir = path.join(this._dataDir, "_codex_home");

    this._active = null; // active turn descriptor
    this._runningRunId = null;
    this._runningLockMeta = null; // { runId, acquiredAtMs, lastTouchedAtMs }
    this._stopRequested = new Set();
    this._autoRunLoops = new Map(); // runId -> Promise
    this._autoRunLoopGuard = new Map(); // runId -> { sig: string, repeats: number, incidents: number }
    this._runTraceSnapshots = new Map(); // runId -> small snapshot of last traced state
    this._runSummaryThrottle = new Map(); // runId -> last write timestamp (ms)
    this._runSummarySig = new Map(); // runId -> last summary signature
    this._longJobMonitors = new Map(); // runId -> { running: boolean, lastStartedAtMs: number }

    this._codex.on("notification", (msg) => this._onNotification(msg));

    // Background long-job supervisor: no LLM turns while waiting_job, but still needs watchdog + hourly monitor.
    this._longJobTickInterval = setInterval(() => {
      void this._tickLongJobs();
    }, Math.max(1000, LONG_JOB_TICK_MS | 0));
    this._longJobTickInterval.unref?.();
  }

  _startAutoRun(runId) {
    const id = String(runId || "");
    if (!id) return { started: false, reason: "missing_runId" };
    if (this._autoRunLoops.has(id)) {
      try {
        const run = this._state.getRun(id);
        const staleLoop =
          this._runningRunId !== id &&
          !this._active &&
          !this._isRunActivelyProcessing(run || null);
        if (staleLoop) this._autoRunLoops.delete(id);
      } catch {
        // ignore
      }
    }
    if (this._autoRunLoops.has(id)) return { started: false, reason: "already_running" };
    const p = this.runAuto(id)
      .catch((e) => {
        const latest = this._state.getRun(id);
        if (!latest) return;
        latest.status = "failed";
        latest.lastError = { message: safeErrorMessage(e), at: nowIso(), where: "auto" };
        this._setRun(id, latest);
      })
      .finally(() => {
        this._autoRunLoops.delete(id);
      });
    this._autoRunLoops.set(id, p);
    return { started: true, reason: null };
  }

  _jobDirAbsForRun(run, jobId) {
    const cwd = run?.cwd ? String(run.cwd) : "";
    return longJob.jobDirAbs(cwd, jobId);
  }

  _jobPaths(run, jobId) {
    const jobDirAbs = this._jobDirAbsForRun(run, jobId);
    const jobJsonAbs = path.join(jobDirAbs, "job.json");
    const requestAbs = path.join(jobDirAbs, "request.json");
    const stdoutAbs = path.join(jobDirAbs, "stdout.log");
    const stderrAbs = path.join(jobDirAbs, "stderr.log");
    const heartbeatAbs = path.join(jobDirAbs, "heartbeat.json");
    const progressAbs = path.join(jobDirAbs, "progress.json");
    const resultAbs = path.join(jobDirAbs, "result.json");
    const monitorDirAbs = path.join(jobDirAbs, "monitor_reports");
    const latestMonitorJsonAbs = path.join(monitorDirAbs, "latest.json");
    const latestMonitorMdAbs = path.join(monitorDirAbs, "latest.md");
    return {
      jobDirAbs,
      jobJsonAbs,
      requestAbs,
      stdoutAbs,
      stderrAbs,
      heartbeatAbs,
      progressAbs,
      resultAbs,
      monitorDirAbs,
      latestMonitorJsonAbs,
      latestMonitorMdAbs,
      jobDirRel: relPathForPrompt(run.cwd, jobDirAbs),
      jobJsonRel: relPathForPrompt(run.cwd, jobJsonAbs),
      requestRel: relPathForPrompt(run.cwd, requestAbs),
      stdoutRel: relPathForPrompt(run.cwd, stdoutAbs),
      stderrRel: relPathForPrompt(run.cwd, stderrAbs),
      heartbeatRel: relPathForPrompt(run.cwd, heartbeatAbs),
      progressRel: relPathForPrompt(run.cwd, progressAbs),
      resultRel: relPathForPrompt(run.cwd, resultAbs),
      monitorDirRel: relPathForPrompt(run.cwd, monitorDirAbs),
      latestMonitorJsonRel: relPathForPrompt(run.cwd, latestMonitorJsonAbs),
      latestMonitorMdRel: relPathForPrompt(run.cwd, latestMonitorMdAbs),
    };
  }

  _taskLongJobHistoryPaths(run, taskIdOverride) {
    return taskLongJobHistoryPaths(run, taskIdOverride);
  }

  _taskLongJobOutcomePaths(run, taskIdOverride) {
    return taskLongJobOutcomePaths(run, taskIdOverride);
  }

  _taskReviewedEvidenceReuseDirective(run, { taskDir } = {}) {
    if (!run?.cwd || !taskDir) return null;
    const candidates = [
      { kind: "manager_instruction", abs: path.join(taskDir, "manager_instruction.md") },
      { kind: "manager_review", abs: path.join(taskDir, "manager_review.md") },
    ];
    for (const candidate of candidates) {
      if (!fileExists(candidate.abs)) continue;
      const text = readTextBestEffort(candidate.abs, 80_000);
      const raw = readMarkdownLabeledValue(text, "Reviewed evidence may be reused for planning this step");
      const value = normalizeReviewedEvidenceReuseDirective(raw);
      if (!value) continue;
      return {
        value,
        raw,
        kind: candidate.kind,
        abs: candidate.abs,
        rel: relPathForPrompt(run.cwd, candidate.abs),
      };
    }
    return null;
  }

  _collectTaskLongJobAttempts(run, taskIdOverride) {
    if (!run?.cwd) return [];
    const { taskId } = taskContext(run, taskIdOverride);
    const attempts = [];
    try {
      longJob.ensureJobsLayout(run.cwd);
      const ids = longJob.listJobIds(run.cwd);
      for (const id of ids) {
        const paths = this._jobPaths(run, id);
        const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
        if (!job || typeof job !== "object") continue;
        const jobTaskId = job.task_id ? String(job.task_id) : "";
        if (jobTaskId && taskId && jobTaskId !== taskId) continue;
        const request = this._readLongJobJsonBestEffort(paths.requestAbs);
        const display = this._getLongJobDisplayState(
          run,
          id,
          run.activeJobId && String(run.activeJobId) === String(id) ? { activeJob: run.activeJob || null } : {},
        );
        const result = this._readLongJobJsonBestEffort(paths.resultAbs);
        const resultState = this._getLongJobResultState(result);
        const outputs = buildResultOutputs(result);
        const endedAt =
          (result && typeof result.at === "string" ? result.at : null) ||
          (job && typeof job.finished_at === "string" ? job.finished_at : null) ||
          (job && typeof job.stopped_at === "string" ? job.stopped_at : null) ||
          null;
        attempts.push({
          job_id: String(id),
          run_id: job.run_id ? String(job.run_id) : null,
          task_id: jobTaskId || taskId || null,
          request_created_at: request && typeof request.created_at === "string" ? request.created_at : null,
          started_at: job.started_at || null,
          ended_at: endedAt,
          expected_minutes: job.expected_minutes ?? request?.expected_minutes ?? null,
          launch_kind: typeof request?.launch_kind === "string" ? request.launch_kind : null,
          script_path: typeof request?.script_path === "string" ? request.script_path : null,
          command: typeof job.command === "string" ? job.command : typeof request?.command === "string" ? request.command : null,
          command_argv: Array.isArray(job.command_argv)
            ? job.command_argv
            : Array.isArray(request?.command_argv)
              ? request.command_argv
              : null,
          job_status: typeof job.status === "string" ? String(job.status).toLowerCase() : null,
          result_status: resultState.status || null,
          display_status: display?.latest?.status || null,
          pid: job.pid ?? null,
          pid_alive: display?.latest?.pidAlive ?? null,
          active: Boolean(display?.latest?.active),
          result_summary: typeof result?.summary === "string" ? result.summary : null,
          result_error: typeof result?.error === "string" ? result.error : null,
          outputs,
          latest_monitor: display?.monitor
            ? {
              status: display.monitor.status || null,
              decision: display.monitor.decision || null,
              summary: display.monitor.summary || null,
              at: display.monitor.at || null,
              synthetic: Boolean(display.monitor.synthetic),
            }
            : null,
          refs: {
            job_json: paths.jobJsonRel,
            request_json: paths.requestRel,
            result_json: paths.resultRel,
            monitor_md: paths.latestMonitorMdRel,
            stdout_log: paths.stdoutRel,
            stderr_log: paths.stderrRel,
          },
        });
      }
    } catch {
      return [];
    }
    const score = (attempt) =>
      tryParseIsoToMs(attempt?.request_created_at) ??
      tryParseIsoToMs(attempt?.started_at) ??
      tryParseIsoToMs(attempt?.ended_at) ??
      0;
    attempts.sort((a, b) => score(a) - score(b));
    attempts.forEach((attempt, index) => {
      attempt.attempt_index = index + 1;
    });
    return attempts;
  }

  _buildTaskLongJobHistory(run, taskIdOverride) {
    const { taskId } = taskContext(run, taskIdOverride);
    const paths = this._taskLongJobHistoryPaths(run, taskId);
    const attempts = this._collectTaskLongJobAttempts(run, taskId);
    const reviewAbs = path.join(paths.taskDir, "manager_review.md");
    const reviewText = readTextBestEffort(reviewAbs, 200_000);
    const managerReview = parseManagerReviewSummary(reviewText);
    if (managerReview?.referencedJobIds?.length) {
      for (const attempt of attempts) {
        if (managerReview.referencedJobIds.includes(attempt.job_id)) {
          attempt.latest_manager_review = {
            decision: managerReview.decision,
            reviewedAt: managerReview.reviewedAt,
            reasons: managerReview.reasons,
            rerunJustification: managerReview.rerunJustification,
            nextActions: managerReview.nextActions,
          };
        }
      }
    }
    const latestAttempt = attempts.length ? attempts[attempts.length - 1] : null;
    const data = {
      schema: "antidex.long_job.history.v1",
      generated_at: nowIso(),
      run_id: run.runId,
      task_id: taskId,
      current_pipeline: {
        run_status: run.status || null,
        developer_status: run.developerStatus || null,
        manager_decision: run.managerDecision || null,
        active_turn_role: run.activeTurn?.role || null,
        summary: run.lastSummary || null,
      },
      counts: {
        attempts_total: attempts.length,
        terminal_attempts: attempts.filter((attempt) => Boolean(attempt.result_status)).length,
        successful_attempts: attempts.filter((attempt) => attempt.result_status === "done").length,
      },
      latest_attempt: latestAttempt ? { job_id: latestAttempt.job_id, display_status: latestAttempt.display_status, result_status: latestAttempt.result_status } : null,
      latest_manager_review: managerReview,
      attempts,
    };

    const lines = [
      `# Long Job History - ${taskId}`,
      "",
      `Generated_at: ${data.generated_at}`,
      `Run_id: ${run.runId}`,
      "",
      "## Current state",
      `- run_status: ${data.current_pipeline.run_status || "(none)"}`,
      `- developer_status: ${data.current_pipeline.developer_status || "(none)"}`,
      `- manager_decision: ${data.current_pipeline.manager_decision || "(none)"}`,
      `- active_turn_role: ${data.current_pipeline.active_turn_role || "(none)"}`,
      `- attempts_total: ${data.counts.attempts_total}`,
      `- terminal_attempts: ${data.counts.terminal_attempts}`,
      `- successful_attempts: ${data.counts.successful_attempts}`,
    ];
    if (data.current_pipeline.summary) lines.push(`- pipeline_summary: ${data.current_pipeline.summary}`);
    if (managerReview) {
      lines.push("", "## Latest manager assessment", `- decision: ${managerReview.decision || "(missing)"}`);
      if (managerReview.reviewedAt) lines.push(`- reviewed_at: ${managerReview.reviewedAt}`);
      if (managerReview.referencedJobIds?.length) lines.push(`- referenced_jobs: ${managerReview.referencedJobIds.join(", ")}`);
      if (managerReview.reasons?.length) {
        lines.push("- reasons:");
        managerReview.reasons.forEach((item) => lines.push(`  - ${item}`));
      }
      if (managerReview.rerunJustification?.length) {
        lines.push("- rerun_justification:");
        managerReview.rerunJustification.forEach((item) => lines.push(`  - ${item}`));
      }
      if (managerReview.reworkRequest?.length) {
        lines.push("- rework_request:");
        managerReview.reworkRequest.forEach((item) => lines.push(`  - ${item}`));
      }
      if (managerReview.nextActions?.length) {
        lines.push("- next_actions:");
        managerReview.nextActions.forEach((item) => lines.push(`  - ${item}`));
      }
    }
    lines.push("", "## Attempts");
    if (!attempts.length) {
      lines.push("- none");
    } else {
      attempts
        .slice()
        .reverse()
        .forEach((attempt) => {
          lines.push(
            `- #${attempt.attempt_index} ${attempt.job_id}: display=${attempt.display_status || "(none)"} job=${attempt.job_status || "(none)"} result=${attempt.result_status || "(none)"}`
          );
          if (attempt.request_created_at) lines.push(`  - requested_at: ${attempt.request_created_at}`);
          if (attempt.started_at) lines.push(`  - started_at: ${attempt.started_at}`);
          if (attempt.ended_at) lines.push(`  - ended_at: ${attempt.ended_at}`);
          if (attempt.script_path) lines.push(`  - script: ${attempt.script_path}`);
          else if (attempt.command) lines.push(`  - command: ${attempt.command}`);
          if (attempt.result_summary) lines.push(`  - result_summary: ${attempt.result_summary}`);
          if (attempt.result_error) lines.push(`  - result_error: ${attempt.result_error}`);
          if (attempt.latest_monitor) {
            lines.push(
              `  - monitor: status=${attempt.latest_monitor.status || "(none)"} decision=${attempt.latest_monitor.decision || "(none)"}${attempt.latest_monitor.synthetic ? " synthetic=yes" : ""}`
            );
            if (attempt.latest_monitor.summary) lines.push(`    - summary: ${attempt.latest_monitor.summary}`);
          }
          if (attempt.outputs?.length) {
            attempt.outputs.forEach((output) => {
              const wins = output?.summary?.wins_by_seat ? JSON.stringify(output.summary.wins_by_seat) : null;
              const illegal = output?.summary && Object.prototype.hasOwnProperty.call(output.summary, "illegal_moves") ? output.summary.illegal_moves : null;
              lines.push(
                `  - output ${output.label || "(label)"}${output.policy ? ` (${output.policy})` : ""}: wins_by_seat=${wins || "(n/a)"} illegal_moves=${illegal ?? "(n/a)"}`
              );
            });
          }
          lines.push(`  - refs: ${attempt.refs.result_json || attempt.refs.job_json}`);
        });
    }
    const markdown = `${lines.join("\n")}\n`;
    return { paths, data, markdown };
  }

  _refreshTaskLongJobHistory(runId, { taskId } = {}) {
    const run = this._getRunRequired(runId);
    const effectiveTaskId = taskId || run.currentTaskId;
    if (!effectiveTaskId) return false;
    const { paths, data, markdown } = this._buildTaskLongJobHistory(run, effectiveTaskId);
    try {
      writeJsonAtomic(paths.jsonAbs, data);
      writeTextAtomic(paths.mdAbs, markdown);
      this._refreshTaskLatestLongJobOutcome(runId, { taskId: effectiveTaskId });
      return true;
    } catch {
      return false;
    }
  }

  _attemptOutcomeFingerprint(attempt) {
    if (!attempt || typeof attempt !== "object") return "";
    const normalizedOutputs = Array.isArray(attempt.outputs)
      ? attempt.outputs.map((output) => ({
        label: output?.label || null,
        policy: output?.policy || null,
        output: output?.output || null,
        summary: output?.summary || null,
      }))
      : [];
    const payload = {
      script_path: attempt.script_path || null,
      command: attempt.command || null,
      command_argv: Array.isArray(attempt.command_argv) ? attempt.command_argv : null,
      result_status: attempt.result_status || null,
      result_summary: attempt.result_summary || null,
      result_error: attempt.result_error || null,
      outputs: normalizedOutputs,
    };
    try {
      return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    } catch {
      return "";
    }
  }

  _describeAttemptDeltaForOutcome(latestAttempt, previousAttempt) {
    if (!latestAttempt) return { summary: "No terminal attempt recorded yet.", changed: false };
    if (!previousAttempt) {
      return {
        summary: "This is the first terminal long-job attempt recorded for this task.",
        changed: true,
      };
    }
    const changes = [];
    if ((latestAttempt.script_path || null) !== (previousAttempt.script_path || null)) {
      changes.push(`script changed: ${previousAttempt.script_path || "(none)"} -> ${latestAttempt.script_path || "(none)"}`);
    }
    const latestArgv = Array.isArray(latestAttempt.command_argv) ? JSON.stringify(latestAttempt.command_argv) : null;
    const prevArgv = Array.isArray(previousAttempt.command_argv) ? JSON.stringify(previousAttempt.command_argv) : null;
    if ((latestArgv || latestAttempt.command || null) !== (prevArgv || previousAttempt.command || null)) {
      changes.push("launch parameters changed");
    }
    if ((latestAttempt.result_status || null) !== (previousAttempt.result_status || null)) {
      changes.push(`terminal status changed: ${previousAttempt.result_status || "(none)"} -> ${latestAttempt.result_status || "(none)"}`);
    }
    if (this._attemptOutcomeFingerprint(latestAttempt) !== this._attemptOutcomeFingerprint(previousAttempt)) {
      changes.push("terminal outcome differs from previous attempt");
    }
    if (!changes.length) {
      return {
        summary: "No launch-level or outcome-level change detected versus the previous terminal attempt.",
        changed: false,
      };
    }
    return { summary: changes.join("; "), changed: true };
  }

  _buildTaskLatestLongJobOutcome(run, taskIdOverride) {
    const { taskId } = taskContext(run, taskIdOverride);
    const paths = this._taskLongJobOutcomePaths(run, taskId);
    const taskSpec = this._taskSpecPaths(run, taskId);
    const attempts = this._collectTaskLongJobAttempts(run, taskId);
    const terminalAttempts = attempts.filter((attempt) => Boolean(attempt?.result_status));
    const latestAttempt = terminalAttempts.length ? terminalAttempts[terminalAttempts.length - 1] : null;
    if (!latestAttempt) return { paths, data: null, markdown: null };
    const previousAttempt = terminalAttempts.length > 1 ? terminalAttempts[terminalAttempts.length - 2] : null;
    const delta = this._describeAttemptDeltaForOutcome(latestAttempt, previousAttempt);
    const outputRefs = Array.isArray(latestAttempt.outputs)
      ? latestAttempt.outputs
        .map((output) => output?.output)
        .filter(Boolean)
      : [];
    const keyResults = [];
    if (latestAttempt.result_summary) keyResults.push(latestAttempt.result_summary);
    if (latestAttempt.result_error) keyResults.push(latestAttempt.result_error);
    if (!keyResults.length && latestAttempt.latest_monitor?.summary) keyResults.push(latestAttempt.latest_monitor.summary);
    if (Array.isArray(latestAttempt.outputs)) {
      for (const output of latestAttempt.outputs) {
        const wins = output?.summary?.wins_by_seat ? JSON.stringify(output.summary.wins_by_seat) : null;
        const illegal =
          output?.summary && Object.prototype.hasOwnProperty.call(output.summary, "illegal_moves")
            ? output.summary.illegal_moves
            : null;
        const generatedAt = output?.summary?.generated_at || output?.summary?.meta?.generated_at || null;
        keyResults.push(
          `${output.label || "(output)"}${output.policy ? ` (${output.policy})` : ""}: wins_by_seat=${wins || "(n/a)"}; illegal_moves=${illegal ?? "(n/a)"}${generatedAt ? `; generated_at=${generatedAt}` : ""}`
        );
      }
    }
    const terminalRefMs = tryParseIsoToMs(latestAttempt.ended_at) || 0;
    const managerDocFreshness = [
      { label: "manager_instruction.md", abs: taskSpec.managerInstrAbs },
      { label: "manager_review.md", abs: path.join(taskSpec.taskDir, "manager_review.md") },
    ].map((entry) => {
      const st = safeStat(entry.abs);
      const mtimeMs = st && typeof st.mtimeMs === "number" ? st.mtimeMs : null;
      return {
        label: entry.label,
        exists: Boolean(st),
        mtime_ms: mtimeMs,
        stale_vs_latest_terminal_attempt: Boolean(terminalRefMs && mtimeMs && mtimeMs < terminalRefMs),
      };
    });
    const staleManagerDocs = managerDocFreshness.filter((entry) => entry.stale_vs_latest_terminal_attempt).map((entry) => entry.label);
    const developerAction =
      staleManagerDocs.length
        ? (latestAttempt.result_status === "done"
          ? "First summarize this terminal result in dev_result.md and update pipeline_state.json. If more work still seems necessary after that, set developer_status=blocked and ask the manager for updated guidance instead of choosing a new rerun from stale docs."
          : "First summarize this terminal failure in dev_result.md and update pipeline_state.json. If more work still seems necessary after that, set developer_status=blocked and ask the manager for updated guidance instead of choosing a new rerun from stale docs.")
        : (latestAttempt.result_status === "done"
          ? "First summarize this terminal result in dev_result.md and update pipeline_state.json. Only after that may you decide whether another rerun is still justified."
          : "First summarize this terminal failure in dev_result.md and update pipeline_state.json. Only after that may you decide whether another rerun is still justified.");
    const managerDocsNote = staleManagerDocs.length
      ? `Manager docs older than this terminal result: ${staleManagerDocs.join(", ")}. Treat them as stale background until dev_result.md has consumed this result.`
      : "Manager docs are not older than the latest terminal result.";
    const data = {
      schema: "antidex.long_job.outcome.v1",
      generated_at: nowIso(),
      run_id: run.runId,
      task_id: taskId,
      current_pipeline: {
        run_status: run.status || null,
        developer_status: run.developerStatus || null,
        manager_decision: run.managerDecision || null,
        active_turn_role: run.activeTurn?.role || null,
        summary: run.lastSummary || null,
      },
      latest_terminal_attempt: latestAttempt,
      previous_terminal_attempt: previousAttempt
        ? {
          job_id: previousAttempt.job_id,
          attempt_index: previousAttempt.attempt_index,
          ended_at: previousAttempt.ended_at || null,
          result_status: previousAttempt.result_status || null,
          script_path: previousAttempt.script_path || null,
          command: previousAttempt.command || null,
          command_argv: Array.isArray(previousAttempt.command_argv) ? previousAttempt.command_argv : null,
        }
        : null,
      delta_vs_previous_terminal_attempt: {
        summary: delta.summary,
        changed: delta.changed,
      },
      manager_doc_freshness: managerDocFreshness,
      manager_docs_note: managerDocsNote,
      developer_action_now: developerAction,
      forbidden_next_action_now: staleManagerDocs.length
        ? "Do not start another long job from stale manager docs, historical Q/A, or historical 2p diagnostics before dev_result.md summarizes this result and the manager has refreshed the plan."
        : "Do not start another long job before dev_result.md explicitly summarizes this terminal result and pipeline_state.json reflects that consumption.",
      output_refs: outputRefs,
      key_results: keyResults,
    };

    const lines = [
      `# Latest Long Job Outcome - ${taskId}`,
      "",
      `Generated_at: ${data.generated_at}`,
      `Run_id: ${run.runId}`,
      `Job_id: ${latestAttempt.job_id}`,
      `Attempt_index: ${latestAttempt.attempt_index}`,
      `Outcome: ${latestAttempt.result_status || latestAttempt.display_status || "(none)"}`,
      latestAttempt.ended_at ? `Ended_at: ${latestAttempt.ended_at}` : null,
      "",
      "This file is the canonical post-long-job handoff for the developer immediately after wake_developer.",
      "Read it before manager_instruction.md / manager_review.md when the latest long job has just finished.",
      "",
      "## Latest artifacts",
      `- result_json: ${latestAttempt.refs?.result_json || "(none)"}`,
      `- monitor_md: ${latestAttempt.refs?.monitor_md || "(none)"}`,
      `- stdout_log: ${latestAttempt.refs?.stdout_log || "(none)"}`,
      `- stderr_log: ${latestAttempt.refs?.stderr_log || "(none)"}`,
      "",
      "## Key results",
      ...(keyResults.length ? keyResults.map((item) => `- ${item}`) : ["- (none)"]),
      "",
      "## Delta vs previous terminal attempt",
      `- ${delta.summary}`,
      "",
      "## Manager doc freshness",
      `- ${managerDocsNote}`,
      "",
      "## Developer must do now",
      `- ${developerAction}`,
      "",
      "## Developer must NOT do now",
      `- ${data.forbidden_next_action_now}`,
      "",
    ].filter((line) => line !== null);
    return { paths, data, markdown: `${lines.join("\n")}\n` };
  }

  _refreshTaskLatestLongJobOutcome(runId, { taskId } = {}) {
    const run = this._getRunRequired(runId);
    const effectiveTaskId = taskId || run.currentTaskId;
    if (!effectiveTaskId) return false;
    const { paths, data, markdown } = this._buildTaskLatestLongJobOutcome(run, effectiveTaskId);
    try {
      if (!data || !markdown) {
        try {
          fs.rmSync(paths.jsonAbs, { force: true });
        } catch {
          // ignore
        }
        try {
          fs.rmSync(paths.mdAbs, { force: true });
        } catch {
          // ignore
        }
        return false;
      }
      writeJsonAtomic(paths.jsonAbs, data);
      writeTextAtomic(paths.mdAbs, markdown);
      return true;
    } catch {
      return false;
    }
  }

  _normalizeLongJobLaunch(source) {
    const commandArgv = Array.isArray(source?.command_argv)
      ? source.command_argv.map((item) => String(item))
      : [];
    const commandText = source?.command ? String(source.command).trim() : "";
    if (commandArgv.length) {
      return {
        command: commandText || formatArgvForDisplay(commandArgv),
        commandArgv,
        spawnCommand: commandArgv[0],
        spawnArgs: commandArgv.slice(1),
        shell: false,
      };
    }
    if (commandText) {
      return {
        command: commandText,
        commandArgv: null,
        spawnCommand: commandText,
        spawnArgs: [],
        shell: true,
      };
    }
    return null;
  }

  _spawnLongJobProcess(run, paths, launch, { jobId, taskId } = {}) {
    if (!launch || !launch.spawnCommand) throw new Error("Missing long-job launch command");
    const stdoutFd = fs.openSync(paths.stdoutAbs, "a");
    const stderrFd = fs.openSync(paths.stderrAbs, "a");
    try {
      const env = {
        ...process.env,
        ANTIDEX_RUN_ID: run.runId,
        ANTIDEX_TASK_ID: taskId || "",
        ANTIDEX_JOB_ID: jobId,
        ANTIDEX_JOB_DIR_ABS: paths.jobDirAbs,
        ANTIDEX_JOB_RESULT_PATH: paths.resultAbs,
        ANTIDEX_JOB_HEARTBEAT_PATH: paths.heartbeatAbs,
        ANTIDEX_JOB_PROGRESS_PATH: paths.progressAbs,
        ANTIDEX_JOB_STDOUT_LOG_PATH: paths.stdoutAbs,
        ANTIDEX_JOB_STDERR_LOG_PATH: paths.stderrAbs,
      };
      const child = spawn(launch.spawnCommand, launch.spawnArgs, {
        cwd: run.cwd,
        shell: launch.shell,
        detached: true,
        windowsHide: true,
        env,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
      child.unref();
      return child;
    } finally {
      try {
        fs.closeSync(stdoutFd);
      } catch {
        // ignore
      }
      try {
        fs.closeSync(stderrFd);
      } catch {
        // ignore
      }
    }
  }

  _shouldDeferLongJobDecision(runId, report) {
    const decision = String(report?.decision || "").trim().toLowerCase();
    if (!decision || decision === "continue") return null;
    if (decision !== "stop" && decision !== "restart" && decision !== "wake_developer" && decision !== "escalate_manager") {
      return null;
    }
    const run = this._getRunRequired(runId);
    const jobId = run.activeJobId ? String(run.activeJobId) : "";
    if (!jobId) return null;
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) return null;
    const pid = job.pid != null ? Number(job.pid) : null;
    if (pid == null || !longJob.isPidAlive(pid)) return null;
    if (fileExists(paths.resultAbs)) return null;
    const startedAtMs = tryParseIsoToMs(job.started_at);
    if (!Number.isFinite(startedAtMs)) return null;
    const elapsedMs = Math.max(0, Date.now() - startedAtMs);
    if (elapsedMs >= LONG_JOB_SILENT_WARMUP_MS) return null;
    const stdoutSt = longJob.safeStat(paths.stdoutAbs);
    const stderrSt = longJob.safeStat(paths.stderrAbs);
    const hbSt = longJob.safeStat(paths.heartbeatAbs);
    const progSt = longJob.safeStat(paths.progressAbs);
    const sawActivity = Boolean(
      (stdoutSt && stdoutSt.size > 0) ||
      (stderrSt && stderrSt.size > 0) ||
      hbSt ||
      progSt
    );
    if (sawActivity) return null;
    return {
      ok: true,
      reason:
        `Ignoring premature monitor decision '${decision}' for ${jobId}: ` +
        `job is alive and still within the ${Math.round(LONG_JOB_SILENT_WARMUP_MS / 60000)} minute silent warmup window.`,
    };
  }

  _readLongJobJsonBestEffort(p) {
    const r = longJob.readJsonBestEffort(p);
    if (!r.ok) return null;
    if (!r.value || typeof r.value !== "object") return null;
    return r.value;
  }

  _writeLongJobJson(p, value) {
    try {
      longJob.writeJsonAtomic(p, value);
      return true;
    } catch {
      return false;
    }
  }

  _writeSyntheticLongJobMonitorReport(run, jobId, { taskId, status, decision, summary, decisionReason, suggestedNextSteps } = {}) {
    if (!run || !jobId) return false;
    const paths = this._jobPaths(run, jobId);
    try {
      longJob.ensureDir(paths.monitorDirAbs);
      const at = nowIso();
      const report = {
        schema: "antidex.long_job.monitor_report.v1",
        at,
        job_id: jobId,
        run_id: run.runId,
        task_id: taskId || run.currentTaskId || null,
        status: status || "unknown",
        summary: summary || "",
        decision: decision || "continue",
        decision_reason: decisionReason || "",
        suggested_next_steps: Array.isArray(suggestedNextSteps) ? suggestedNextSteps : [],
      };
      const ts = longJob.nowIsoForFile().slice(0, 19);
      const repJsonAbs = path.join(paths.monitorDirAbs, `REP-${ts}.json`);
      const repMdAbs = path.join(paths.monitorDirAbs, `REP-${ts}.md`);
      const mdLines = [
        `**Status** ${report.status}`,
        `**Decision** ${report.decision}`,
        `**Summary** ${report.summary || "(none)"}`,
        "",
      ];
      if (report.decision_reason) mdLines.push(`**Reason** ${report.decision_reason}`, "");
      if (report.suggested_next_steps.length) {
        mdLines.push("**Suggested Next Steps**");
        report.suggested_next_steps.forEach((step, index) => mdLines.push(`${index + 1}. ${step}`));
        mdLines.push("");
      }
      const md = `${mdLines.join("\n").trimEnd()}\n`;
      longJob.writeJsonAtomic(repJsonAbs, report);
      fs.writeFileSync(repMdAbs, md, "utf8");
      longJob.writeJsonAtomic(paths.latestMonitorJsonAbs, report);
      fs.writeFileSync(paths.latestMonitorMdAbs, md, "utf8");
      return true;
    } catch {
      return false;
    }
  }

  _jobRequestMatchesRun(run, req) {
    if (!req || typeof req !== "object") return false;
    const rid = req.run_id ? String(req.run_id) : "";
    if (rid && rid !== run.runId) return false;
    const tid = req.task_id ? String(req.task_id) : "";
    if (tid && run.currentTaskId && tid !== run.currentTaskId) return false;
    return true;
  }

  _pickNextLongJobRequest(run) {
    const usable = this._collectUsableLongJobRequests(run);
    return usable.length ? { path: usable[0].path, request: usable[0].request } : null;
  }

  _hasProtocolAwareLiveLongJob(run, taskId) {
    try {
      const ids = longJob.listJobIds(run.cwd);
      for (const id of ids) {
        const jobDirAbs = longJob.jobDirAbs(run.cwd, id);
        const jobJsonAbs = path.join(jobDirAbs, "job.json");
        const j = longJob.readJsonBestEffort(jobJsonAbs);
        if (!j.ok || !j.value || typeof j.value !== "object") continue;
        const rid = j.value.run_id ? String(j.value.run_id) : "";
        const tid = j.value.task_id ? String(j.value.task_id) : "";
        const status = j.value.status ? String(j.value.status).toLowerCase() : "";
        const pid = j.value.pid != null ? Number(j.value.pid) : null;
        if (rid && rid !== run.runId) continue;
        if (tid && tid !== taskId) continue;
        if (status !== "running") continue;
        if (pid == null || !longJob.isPidAlive(pid)) continue;
        const resultAbs = path.join(jobDirAbs, "result.json");
        const result = longJob.readJsonBestEffort(resultAbs);
        const resultState = this._getLongJobResultState(result.ok ? result.value : null);
        if (resultState.isTerminal) continue;
        if (this._longJobRequestLooksProtocolAware(j.value)) return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  _adoptActiveLongJobFromDisk(runId) {
    const run = this._getRunRequired(runId);
    if (run.activeJobId) return false;
    try {
      longJob.ensureJobsLayout(run.cwd);
      const ids = longJob.listJobIds(run.cwd);
      let best = null;
      for (const id of ids) {
        const paths = this._jobPaths(run, id);
        const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
        if (!job) continue;
        if (job.run_id && String(job.run_id) !== run.runId) continue;
        const pid = job.pid != null ? Number(job.pid) : null;
        const alive = pid != null ? longJob.isPidAlive(pid) : false;
        if (!alive) continue;
        const status = String(job.status || "").toLowerCase();
        if (status !== "running") continue;
        const startedAtMs = tryParseIsoToMs(job.started_at) ?? 0;
        if (!best || startedAtMs > best.startedAtMs) best = { jobId: id, startedAtMs };
      }
      if (!best) return false;
      run.activeJobId = best.jobId;
      const runStatus = String(run.status || "").trim().toLowerCase();
      const preserveStoppedPipeline =
        runStatus === "stopped" || runStatus === "paused" || runStatus === "canceled";
      if (!preserveStoppedPipeline) {
        run.status = "waiting_job";
      }
      if (!preserveStoppedPipeline || String(run.developerStatus || "").trim().toLowerCase() !== "idle") {
        run.developerStatus = "waiting_job";
      }
      this._setRun(runId, run);
      return true;
    } catch {
      return false;
    }
  }

  _setProjectDeveloperStatusBestEffort(run, developerStatus, summary) {
    if (!run?.projectPipelineStatePath) return false;
    try {
      const r = longJob.readJsonBestEffort(run.projectPipelineStatePath);
      const st = r.ok && r.value && typeof r.value === "object" ? r.value : {};
      st.developer_status = developerStatus;
      if (summary) st.summary = String(summary).slice(0, 20_000);
      st.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, st);
      return true;
    } catch {
      return false;
    }
  }

  _setProjectWakeDeveloperContextBestEffort(run, { summary, jobId, resultState, latestAttempt } = {}) {
    if (!run?.projectPipelineStatePath) return false;
    try {
      const r = longJob.readJsonBestEffort(run.projectPipelineStatePath);
      const st = r.ok && r.value && typeof r.value === "object" ? r.value : {};
      st.developer_status = "ongoing";
      st.manager_decision = null;
      if (summary) st.summary = String(summary).slice(0, 20_000);
      const tests = st.tests && typeof st.tests === "object" ? { ...st.tests } : {};
      const firstOutput = Array.isArray(latestAttempt?.outputs) && latestAttempt.outputs.length ? latestAttempt.outputs[0] : null;
      const wins = firstOutput?.summary?.wins_by_seat ? JSON.stringify(firstOutput.summary.wins_by_seat) : null;
      const generatedAt = firstOutput?.summary?.generated_at || firstOutput?.summary?.meta?.generated_at || null;
      tests.notes =
        resultState?.isDone
          ? `Latest long job ${jobId} completed; developer must consume the terminal result before any new rerun.${wins ? ` First output wins_by_seat=${wins}.` : ""}${generatedAt ? ` generated_at=${generatedAt}.` : ""}`
          : `Latest long job ${jobId} ended with terminal failure status=${resultState?.status || "error"}; developer must consume the terminal result before any new rerun.`;
      st.tests = tests;
      st.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, st);
      return true;
    } catch {
      return false;
    }
  }

  _autoPromoteDeveloperStatusFromEvidence(run, { taskId, reason } = {}) {
    if (!run) return { ok: false, reason: "missing run" };
    const current = normalizeDeveloperStatus(run.developerStatus);
    if (current === "ready_for_review" || current === "waiting_job") {
      return { ok: true, changed: false, developerStatus: current };
    }
    if (current && current !== "ongoing") {
      return { ok: false, reason: `developer_status is ${current}` };
    }

    const targetTaskId = taskId || run.currentTaskId || null;
    let wantsWaitingJob = false;
    let hasRequest = false;
    let hasRunningJob = false;
    const targetTaskDir = (() => {
      try {
        const ctx = taskContext(run, targetTaskId);
        return ctx?.taskDir || null;
      } catch {
        return null;
      }
    })();
    try {
      const usableRequests = this._collectUsableLongJobRequests(run, { taskId: targetTaskId });
      if (usableRequests.length) {
        hasRequest = true;
        wantsWaitingJob = true;
      }
      if (!wantsWaitingJob) {
        if (this._hasProtocolAwareLiveLongJob(run, targetTaskId)) {
          hasRunningJob = true;
          wantsWaitingJob = true;
        }
      }
    } catch {
      // ignore
    }

    const nextStatus = wantsWaitingJob ? "waiting_job" : "ready_for_review";
    if (nextStatus === "ready_for_review" && targetTaskDir) {
      try {
        const taskMeta = readTaskSpecMeta(targetTaskDir, { maxChars: 4000 });
        if (taskMeta.outcomeDriven) {
          const freshEvidence = this._validateFreshEvidenceForOutcomeRework(run, { taskDir: targetTaskDir, taskId: targetTaskId });
          if (!freshEvidence.ok) {
            return { ok: false, reason: freshEvidence.reason || "stale outcome-driven evidence" };
          }
        }
      } catch {
        return { ok: false, reason: "failed to validate outcome-driven evidence during auto-promotion" };
      }
    }
    run.developerStatus = nextStatus;
    this._setRun(run.runId, run);
    this._setProjectDeveloperStatusBestEffort(run, nextStatus);
    appendRecoveryLog(run, {
      role: "system",
      step: "handshake",
      status: "auto_dev_status",
      task_id: targetTaskId,
      developer_status: nextStatus,
      reason: reason || "dev_status_missing_or_ongoing",
      has_long_job_request: hasRequest,
      has_running_job: hasRunningJob,
    });
    try {
      this._appendRunTimeline(run.runId, {
        type: "developer_status_auto_promoted",
        taskId: targetTaskId,
        developerStatus: nextStatus,
        inferredWaitingJob: wantsWaitingJob,
      });
    } catch {
      // ignore
    }
    return { ok: true, changed: true, developerStatus: nextStatus };
  }

  _startLongJobFromRequest(runId, requestPath, request) {
    const run = this._getRunRequired(runId);
    if (!run.cwd) throw new Error("Missing run.cwd");
    if (!request || typeof request !== "object") throw new Error("Invalid long job request");
    const taskId = request.task_id ? String(request.task_id) : run.currentTaskId || null;
    if (taskId) {
      const taskDir = path.join(run.cwd, "data", "tasks", taskId);
      const requestCheck = this._validateLongJobRequestAgainstTask(run, { taskDir, taskId, requestValue: request });
      if (!requestCheck.ok) {
        try {
          if (requestPath && fs.existsSync(requestPath)) fs.rmSync(requestPath, { force: true });
        } catch {
          // ignore
        }
        throw new Error(requestCheck.reason || "Long job request does not match task scope");
      }
    }
    const launch = this._normalizeLongJobLaunch(request);
    if (!launch) throw new Error("Long job request missing command");

    longJob.ensureJobsLayout(run.cwd);

    const jobId =
      (request.job_id ? String(request.job_id).trim() : "") ||
      `job-${String(taskId || "task").replace(/[^A-Za-z0-9_-]/g, "-")}-${longJob.nowIsoForFile().slice(0, 19)}`;
    const paths = this._jobPaths(run, jobId);
    longJob.ensureDir(paths.jobDirAbs);
    longJob.ensureDir(paths.monitorDirAbs);

    // Move/copy request into the job dir for auditability.
    try {
      if (requestPath && fs.existsSync(requestPath)) {
        try {
          fs.renameSync(requestPath, paths.requestAbs);
        } catch {
          try {
            fs.copyFileSync(requestPath, paths.requestAbs);
          } catch {
            // ignore
          }
          try {
            fs.rmSync(requestPath, { force: true });
          } catch {
            // ignore
          }
        }
      } else {
        longJob.writeJsonAtomic(paths.requestAbs, request);
      }
    } catch {
      // ignore
    }

    const startedAt = nowIso();
    const child = this._spawnLongJobProcess(run, paths, launch, { jobId, taskId });

    const jobJson = {
      schema: "antidex.long_job.v1",
      job_id: jobId,
      run_id: run.runId,
      task_id: taskId,
      created_at: request.created_at || nowIso(),
      started_at: startedAt,
      status: "running",
      pid: child.pid,
      command: launch.command,
      command_argv: launch.commandArgv,
      expected_minutes: request.expected_minutes ?? null,
      monitor_every_minutes: request.monitor_every_minutes ?? null,
      monitor_grace_minutes: request.monitor_grace_minutes ?? null,
      stdout_log: "stdout.log",
      stderr_log: "stderr.log",
      request_path: "request.json",
      heartbeat_path: "heartbeat.json",
      progress_path: "progress.json",
      result_path: "result.json",
      restart_count: 0,
      updated_at: nowIso(),
    };
    this._writeLongJobJson(paths.jobJsonAbs, jobJson);

    // Reflect waiting_job in the project state so restarts are recoverable.
    this._setProjectDeveloperStatusBestEffort(
      run,
      "waiting_job",
      `Long job started (${jobId}). Monitor: ${paths.latestMonitorMdRel}.`,
    );

    run.activeJobId = jobId;
    run.activeJob = {
      jobId,
      taskId,
      status: "running",
      pid: child.pid,
      startedAt,
      jobDirRel: paths.jobDirRel,
      jobJsonRel: paths.jobJsonRel,
      stdoutRel: paths.stdoutRel,
      stderrRel: paths.stderrRel,
      latestMonitorMdRel: paths.latestMonitorMdRel,
      latestMonitorJsonRel: paths.latestMonitorJsonRel,
    };
    run.status = "waiting_job";
    run.developerStatus = "waiting_job";
    run.lastError = null;
    run._longJobAutoResume = run._longJobAutoResume !== false; // default true unless explicitly disabled
    this._setRun(runId, run);

    this.emit("event", {
      runId,
      event: "diag",
      data: { role: "system", type: "info", message: `Long job started: ${jobId} (pid=${child.pid})` },
    });
    this._refreshTaskLongJobHistory(runId, { taskId });
  }

  _refreshActiveLongJobSummary(runId) {
    const run = this._getRunRequired(runId);
    if (!run.activeJobId) return;
    const jobId = String(run.activeJobId);
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) return;
    const pid = job.pid != null ? Number(job.pid) : null;
    const alive = pid != null ? longJob.isPidAlive(pid) : false;
    const stdoutSt = longJob.safeStat(paths.stdoutAbs);
    const stderrSt = longJob.safeStat(paths.stderrAbs);
    const hbSt = longJob.safeStat(paths.heartbeatAbs);
    const progSt = longJob.safeStat(paths.progressAbs);
    const resSt = longJob.safeStat(paths.resultAbs);
    const monSt = longJob.safeStat(paths.latestMonitorJsonAbs);
    const mon = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);

    run.activeJob = {
      jobId,
      taskId: job.task_id || run.currentTaskId || null,
      status: String(job.status || "unknown"),
      pid,
      pidAlive: alive,
      startedAt: job.started_at || null,
      updatedAt: job.updated_at || null,
      jobDirRel: paths.jobDirRel,
      jobJsonRel: paths.jobJsonRel,
      stdoutRel: paths.stdoutRel,
      stderrRel: paths.stderrRel,
      heartbeatRel: paths.heartbeatRel,
      progressRel: paths.progressRel,
      resultRel: paths.resultRel,
      latestMonitorJsonRel: paths.latestMonitorJsonRel,
      latestMonitorMdRel: paths.latestMonitorMdRel,
      stdoutMtimeIso: stdoutSt ? new Date(stdoutSt.mtimeMs).toISOString() : null,
      stderrMtimeIso: stderrSt ? new Date(stderrSt.mtimeMs).toISOString() : null,
      heartbeatMtimeIso: hbSt ? new Date(hbSt.mtimeMs).toISOString() : null,
      progressMtimeIso: progSt ? new Date(progSt.mtimeMs).toISOString() : null,
      resultMtimeIso: resSt ? new Date(resSt.mtimeMs).toISOString() : null,
      lastMonitorAtIso: monSt ? new Date(monSt.mtimeMs).toISOString() : null,
      lastMonitorDecision: mon && typeof mon.decision === "string" ? mon.decision : null,
      lastMonitorStatus: mon && typeof mon.status === "string" ? mon.status : null,
      lastMonitorSummary: mon && typeof mon.summary === "string" ? clampString(mon.summary, 2000) : null,
    };
    this._setRun(runId, run);
  }

  _reconcileActiveLongJobReference(runId) {
    const run = this._getRunRequired(runId);
    if (!run.activeJobId) return false;
    const jobId = String(run.activeJobId);
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) {
      this._clearActiveLongJobReference(run, { preserveLastJobId: true });
      this._setRun(runId, run);
      return true;
    }
    const jobStatus = String(job.status || "").trim().toLowerCase();
    const pid = job.pid != null ? Number(job.pid) : null;
    const alive = pid != null ? longJob.isPidAlive(pid) : false;
    const result = this._readLongJobJsonBestEffort(paths.resultAbs);
    const resultState = this._getLongJobResultState(result);
    const shouldClear =
      jobStatus !== "running" ||
      resultState.isTerminal ||
      !alive;
    if (!shouldClear) return false;
    this._clearActiveLongJobReference(run, { preserveLastJobId: true });
    this._setRun(runId, run);
    return true;
  }

  _wakeDeveloperAfterLongJob(runId, { reason } = {}) {
    const run = this._getRunRequired(runId);
    const finishedJobId = run.activeJobId ? String(run.activeJobId) : null;
    if (finishedJobId) run.lastJobId = finishedJobId;
    run.activeJobId = null;
    run.activeJob = null;
    run.status = "implementing";
    run.developerStatus = "ongoing";
    run.lastError = null;
    this._setRun(runId, run);
    this._setProjectDeveloperStatusBestEffort(
      run,
      "ongoing",
      this._describeLongJobWakeOutcome(run, finishedJobId, reason),
    );
    this._refreshTaskLongJobHistory(runId, { taskId: run.currentTaskId || null });
    if (run._longJobAutoResume && !this._runningRunId && !this._active) {
      this._startAutoRun(runId);
    }
  }

  _recoverStaleWaitingJob(runId, { reason = "stale_waiting_job" } = {}) {
    const run = this._getRunRequired(runId);
    const isWaiting =
      String(run.status || "").trim().toLowerCase() === "waiting_job" ||
      String(run.developerStatus || "").trim().toLowerCase() === "waiting_job";
    if (!isWaiting) return false;

    if (run.activeJobId) {
      this._reconcileActiveLongJobReference(runId);
    }

    const cur = this._getRunRequired(runId);
    if (cur.activeJobId) return false;
    if (this._adoptActiveLongJobFromDisk(runId)) return false;

    const latest = this._getRunRequired(runId);
    if (latest.activeJobId) return false;

    const pendingReq = this._pickNextLongJobRequest(latest);
    if (pendingReq) return false;
    if (this._reconcileTerminalLatestLongJobState(runId, { reason })) return true;

    this._clearActiveLongJobReference(latest, { preserveLastJobId: true });
    latest.status = "implementing";
    latest.developerStatus = "ongoing";
    latest.lastError = null;
    this._setRun(runId, latest);
    this._setProjectDeveloperStatusBestEffort(
      latest,
      "ongoing",
      `Recovered from stale waiting_job (${reason}); no live long job or pending request remained.`,
    );
    try {
      this._appendRunTimeline(runId, { type: "waiting_job_recovered", reason });
    } catch {
      // ignore
    }
    return true;
  }

  _reconcileTerminalLatestLongJobState(runId, { reason = "terminal_latest_job" } = {}) {
    const run = this._getRunRequired(runId);
    const turnStillActive =
      (run.activeTurn && typeof run.activeTurn === "object") ||
      this._runningRunId === runId ||
      (this._active && this._active.runId === runId);
    if (turnStillActive) return false;
    const runStatus = String(run.status || "").trim().toLowerCase();
    const runDeveloperStatus = String(run.developerStatus || "").trim().toLowerCase();
    const runLastErrorWhere = String(run.lastError?.where || "").trim().toLowerCase();
    const waitingInRun = runStatus === "waiting_job" || runDeveloperStatus === "waiting_job";
    const blockedOnTerminalRecoverableIncidentInRun =
      runDeveloperStatus === "blocked" &&
      (runLastErrorWhere === "job/monitor_missed" || runLastErrorWhere === "guardrail/post_incident_review");
    const projectRead = run.projectPipelineStatePath ? readJsonBestEffort(run.projectPipelineStatePath) : { ok: false };
    const projectState = projectRead.ok && projectRead.value && typeof projectRead.value === "object" ? projectRead.value : null;
    const projectDeveloperStatus = normalizeDeveloperStatus(projectState?.developer_status);
    const waitingInProject = projectDeveloperStatus === "waiting_job";
    const blockedOnTerminalRecoverableIncidentInProject =
      projectDeveloperStatus === "blocked" &&
      /Long job monitor failed|Post-incident review required/i.test(String(projectState?.summary || ""));
    if (!waitingInRun && !waitingInProject && !blockedOnTerminalRecoverableIncidentInRun && !blockedOnTerminalRecoverableIncidentInProject) {
      return false;
    }

    const jobId = run.activeJobId ? String(run.activeJobId) : run.lastJobId ? String(run.lastJobId) : "";
    if (!jobId) return false;
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) return false;
    if (job.run_id && String(job.run_id) !== run.runId) return false;
    if (job.task_id && run.currentTaskId && String(job.task_id) !== String(run.currentTaskId)) return false;

    const result = this._readLongJobJsonBestEffort(paths.resultAbs);
    const resultState = this._getLongJobResultState(result);
    if (!resultState.isTerminal) return false;
    const history = this._buildTaskLongJobHistory(run, run.currentTaskId || null);
    const latestAttempt =
      Array.isArray(history?.data?.attempts) && history.data.attempts.length
        ? history.data.attempts[history.data.attempts.length - 1]
        : null;

    const recoveringBlockedIncident =
      blockedOnTerminalRecoverableIncidentInRun || blockedOnTerminalRecoverableIncidentInProject;
    const summary = this._describeLongJobWakeOutcome(
      run,
      jobId,
      recoveringBlockedIncident
        ? `Recovered stale blocked long-job state (${String(reason || "terminal_latest_job")}); terminal result exists and the developer must interpret it now.`
        : `Recovered stale waiting_job (${String(reason || "terminal_latest_job")}); developer must interpret the terminal result and finalize.`,
    );

    this._clearActiveLongJobReference(run, { preserveLastJobId: true });
    if (runDeveloperStatus === "waiting_job" || blockedOnTerminalRecoverableIncidentInRun) run.developerStatus = "ongoing";
    if (runStatus === "waiting_job") run.status = "implementing";
    if (blockedOnTerminalRecoverableIncidentInRun) run.lastError = null;
    if (run.managerDecision) run.managerDecision = null;
    run.lastSummary = summary;
    this._setRun(runId, run);
    this._setProjectWakeDeveloperContextBestEffort(run, { summary, jobId, resultState, latestAttempt });
    this._refreshTaskLongJobHistory(runId, { taskId: run.currentTaskId || null });
    try {
      const runStatus = String(run.status || "").trim().toLowerCase();
      if (runStatus === "stopped" || runStatus === "paused" || runStatus === "canceled") {
        this._writeResumePacket(this._getRunRequired(runId), { reason: "terminal_result_reconciled" });
      }
    } catch {
      // best-effort
    }
    try {
      this._appendRunTimeline(runId, { type: "waiting_job_terminal_result_reconciled", reason, jobId });
    } catch {
      // ignore
    }
    return true;
  }

  _reconcileTerminalLongJobArtifacts(runId, jobId, { refreshHistory = true } = {}) {
    const run = this._getRunRequired(runId);
    const id = String(jobId || "").trim();
    if (!id) return false;
    const paths = this._jobPaths(run, id);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) return false;
    const result = this._readLongJobJsonBestEffort(paths.resultAbs);
    const resultState = this._getLongJobResultState(result);
    if (!resultState.isTerminal) return false;

    let changed = false;
    const terminalAt =
      (result && typeof result.at === "string" && result.at.trim()) ||
      (job && typeof job.finished_at === "string" && job.finished_at.trim()) ||
      nowIso();
    const desiredJobStatus = resultState.isDone ? "done" : "error";
    const currentJobStatus = typeof job.status === "string" ? String(job.status).trim().toLowerCase() : "";
    if (
      currentJobStatus !== desiredJobStatus ||
      !job.finished_at ||
      (resultState.isFailure &&
        typeof result?.error === "string" &&
        result.error.trim() &&
        String(job.error || "").trim() !== result.error.trim())
    ) {
      const nextJob = {
        ...job,
        status: desiredJobStatus,
        finished_at: terminalAt,
        updated_at: nowIso(),
      };
      if (resultState.isFailure) {
        nextJob.error =
          typeof result?.error === "string" && result.error.trim()
            ? result.error.trim()
            : nextJob.error || `result_status_${resultState.status || "error"}`;
      }
      this._writeLongJobJson(paths.jobJsonAbs, nextJob);
      changed = true;
    }

    const latestMonitor = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);
    const desiredMonitorStatus = resultState.isDone ? "done" : "failed";
    const desiredDecision = "wake_developer";
    const currentMonitorStatus = typeof latestMonitor?.status === "string" ? String(latestMonitor.status).trim().toLowerCase() : "";
    const currentDecision = typeof latestMonitor?.decision === "string" ? String(latestMonitor.decision).trim().toLowerCase() : "";
    const needsTerminalMonitor =
      !latestMonitor ||
      currentMonitorStatus === "running" ||
      currentDecision === "continue" ||
      currentMonitorStatus !== desiredMonitorStatus ||
      currentDecision !== desiredDecision;
    if (needsTerminalMonitor) {
      this._writeSyntheticLongJobMonitorReport(run, id, {
        taskId: job.task_id || run.currentTaskId || null,
        status: desiredMonitorStatus,
        decision: desiredDecision,
        summary:
          resultState.isDone
            ? typeof result?.summary === "string" && result.summary.trim()
              ? result.summary.trim()
              : `Long job ${id} completed successfully.`
            : typeof result?.error === "string" && result.error.trim()
              ? result.error.trim()
              : `Long job ${id} ended with result.json status=${resultState.status || "error"}.`,
        decisionReason:
          resultState.isDone
            ? "Terminal result.json already exists."
            : "Terminal failure result.json already exists.",
        suggestedNextSteps: [
          "Developer should consume the terminal result and update dev_result.md / pipeline_state.json.",
        ],
      });
      changed = true;
    }

    if (refreshHistory) this._refreshTaskLongJobHistory(runId, { taskId: run.currentTaskId || null });
    return changed;
  }

  _clearActiveLongJobReference(run, { preserveLastJobId = true } = {}) {
    if (!run || typeof run !== "object") return;
    const activeJobId = run.activeJobId ? String(run.activeJobId) : null;
    if (preserveLastJobId && activeJobId) run.lastJobId = activeJobId;
    run.activeJobId = null;
    run.activeJob = null;
  }

  _getLongJobResultState(result) {
    const rawStatus = result && typeof result.status === "string" ? String(result.status).trim().toLowerCase() : "";
    const isDone = rawStatus === "done" || rawStatus === "completed" || rawStatus === "success" || rawStatus === "ok";
    const isFailure =
      rawStatus === "error" ||
      rawStatus === "failed" ||
      rawStatus === "failure" ||
      rawStatus === "stopped" ||
      rawStatus === "canceled" ||
      rawStatus === "cancelled";
    return {
      status: rawStatus,
      isDone,
      isFailure,
      isTerminal: isDone || isFailure,
    };
  }

  _resolveLongJobDisplayStatus({ activeJob = null, job = null, report = null, resultState = null, pidAlive = null } = {}) {
    if (resultState?.isDone) return "done";
    if (resultState?.isFailure) return resultState.status || "failed";
    const activeStatus = activeJob && typeof activeJob.status === "string" ? String(activeJob.status).trim().toLowerCase() : "";
    const reportStatus = report && typeof report.status === "string" ? String(report.status).trim().toLowerCase() : "";
    const jobStatus = job && typeof job.status === "string" ? String(job.status).trim().toLowerCase() : "";
    const displayStatus = activeStatus || reportStatus || jobStatus || "";
    if (displayStatus === "running" && pidAlive === false) {
      if (reportStatus && reportStatus !== "running") return reportStatus;
      return "crashed";
    }
    return displayStatus || null;
  }

  _buildSyntheticLongJobMonitorReport({ run, jobId, latestStatus, resultState, result } = {}) {
    const status = String(latestStatus || "").trim().toLowerCase();
    if (!status) return null;
    const taskId = run?.currentTaskId || null;
    let decision = "continue";
    let summary = "";
    let decisionReason = "";
    if (resultState?.isDone) {
      decision = "wake_developer";
      summary = typeof result?.summary === "string" && result.summary.trim() ? result.summary.trim() : `Long job ${jobId} completed successfully.`;
      decisionReason = "Synthetic monitor: terminal result.json already exists.";
    } else if (resultState?.isFailure) {
      decision = "wake_developer";
      summary =
        typeof result?.error === "string" && result.error.trim()
          ? result.error.trim()
          : `Long job ${jobId} ended with result.json status=${resultState.status || "failed"}.`;
      decisionReason = "Synthetic monitor: terminal failure result.json already exists.";
    } else if (status === "crashed") {
      decision = "restart";
      summary = `Long job ${jobId} is no longer alive and no authoritative monitor report exists.`;
      decisionReason = "Synthetic monitor: pid is dead and the displayed status is crashed.";
    } else if (status === "stopped") {
      decision = "wake_developer";
      summary = `Long job ${jobId} was stopped.`;
      decisionReason = "Synthetic monitor: stopped job without monitor report.";
    } else {
      return null;
    }
    const at = nowIso();
    const report = {
      schema: "antidex.long_job.monitor_report.v1",
      at,
      job_id: jobId || null,
      run_id: run?.runId || null,
      task_id: taskId,
      status,
      summary,
      decision,
      decision_reason: decisionReason,
      suggested_next_steps:
        decision === "wake_developer"
          ? ["Developer should consume the terminal result and update dev_result.md / pipeline_state.json."]
          : decision === "restart"
            ? ["Inspect request.json, stdout.log, stderr.log and restart the long job if still needed."]
            : [],
      synthetic: true,
    };
    const md = [
      `**Status** ${report.status}`,
      `**Decision** ${report.decision}`,
      `**Summary** ${report.summary || "(none)"}`,
      "",
      `**Reason** ${report.decision_reason || "(none)"}`,
      "",
      "_Synthetic monitor report generated by Antidex because no monitor report file exists for this terminal job._",
      "",
    ].join("\n");
    return { report, md };
  }

  _describeLongJobWakeOutcome(run, jobId, reason) {
    const taskId = run?.currentTaskId || "(task)";
    const label = jobId || "job";
    const suffix = reason ? ` ${String(reason).trim()}` : " Developer must interpret results and finalize.";
    if (!jobId) return `Long job ended for ${taskId} (${label}).${suffix}`;
    try {
      const paths = this._jobPaths(run, jobId);
      const result = this._readLongJobJsonBestEffort(paths.resultAbs);
      const resultState = this._getLongJobResultState(result);
      if (resultState.isDone) return `Long job completed for ${taskId} (${label}).${suffix}`;
      if (resultState.isFailure) return `Long job failed for ${taskId} (${label}).${suffix}`;
      const report = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);
      const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
      const rawStatus =
        (report && typeof report.status === "string" && report.status) ||
        (job && typeof job.status === "string" && job.status) ||
        "";
      const status = String(rawStatus).trim().toLowerCase();
      if (status === "crashed") return `Long job crashed for ${taskId} (${label}).${suffix}`;
      if (status === "done") return `Long job completed for ${taskId} (${label}).${suffix}`;
      if (status === "error" || status === "failed" || status === "failure") return `Long job failed for ${taskId} (${label}).${suffix}`;
      if (status === "stopped") return `Long job stopped for ${taskId} (${label}).${suffix}`;
    } catch {
      // Fall back to a neutral wording when job artifacts are missing.
    }
    return `Long job ended for ${taskId} (${label}).${suffix}`;
  }

  _getLongJobDisplayState(run, jobId, { activeJob = null } = {}) {
    const id = String(jobId || "").trim();
    if (!run || !id) return null;
    const paths = this._jobPaths(run, id);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    const result = this._readLongJobJsonBestEffort(paths.resultAbs);
    const resultState = this._getLongJobResultState(result);
    let report = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);
    let reportMd = fileExists(paths.latestMonitorMdAbs) ? readTextHead(paths.latestMonitorMdAbs, 50_000) : null;
    const pid = activeJob?.pid ?? (job?.pid != null ? Number(job.pid) : null);
    const pidAlive =
      activeJob && Object.prototype.hasOwnProperty.call(activeJob, "pidAlive")
        ? activeJob.pidAlive
        : pid != null
          ? longJob.isPidAlive(pid)
          : null;
    const latestStatus = this._resolveLongJobDisplayStatus({ activeJob, job, report, resultState, pidAlive });
    if (!report) {
      const synthetic = this._buildSyntheticLongJobMonitorReport({ run, jobId: id, latestStatus, resultState, result });
      if (synthetic) {
        report = synthetic.report;
        reportMd = synthetic.md;
      }
    }
    const latest = {
      jobId: id,
      status: latestStatus,
      pid,
      pidAlive,
      startedAt:
        (activeJob && activeJob.startedAt) ||
        (job && typeof job.started_at === "string" ? job.started_at : null),
      updatedAt:
        (activeJob && activeJob.updatedAt) ||
        (job && typeof job.updated_at === "string" ? job.updated_at : null),
      stoppedAt: job && typeof job.stopped_at === "string" ? job.stopped_at : null,
      jobDirRel: paths.jobDirRel,
      jobJsonRel: paths.jobJsonRel,
      stdoutRel: paths.stdoutRel,
      stderrRel: paths.stderrRel,
      heartbeatRel: paths.heartbeatRel,
      progressRel: paths.progressRel,
      resultRel: paths.resultRel,
      latestMonitorJsonRel: paths.latestMonitorJsonRel,
      latestMonitorMdRel: paths.latestMonitorMdRel,
      lastMonitorAtIso:
        (activeJob && activeJob.lastMonitorAtIso) ||
        (report && typeof report.at === "string" ? report.at : null),
      lastMonitorDecision:
        (activeJob && activeJob.lastMonitorDecision) ||
        (report && typeof report.decision === "string" ? report.decision : null),
      lastMonitorStatus:
        (activeJob && activeJob.lastMonitorStatus) ||
        (report && typeof report.status === "string" ? report.status : null),
      lastMonitorSummary:
        (activeJob && activeJob.lastMonitorSummary) ||
        (report && typeof report.summary === "string" ? clampString(report.summary, 2000) : null),
      active: Boolean(activeJob),
    };
    return { latest, job, monitor: report, monitor_md: reportMd };
  }

  _stopActiveLongJob(runId, { reason, wakeDeveloper = true, preserveRunStatus = false } = {}) {
    const run = this._getRunRequired(runId);
    const jobId = run.activeJobId ? String(run.activeJobId) : "";
    if (!jobId) return { ok: false, reason: "no_active_job" };
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    const pid = job?.pid != null ? Number(job.pid) : null;
    let kill = { ok: false, reason: "no_pid" };
    if (pid != null) kill = longJob.killProcessTreeBestEffort(pid);
    const updatedJob = {
      ...(job || { schema: "antidex.long_job.v1", job_id: jobId, run_id: run.runId, task_id: run.currentTaskId || null }),
      status: "stopped",
      stopped_at: nowIso(),
      stop_reason: reason || null,
      updated_at: nowIso(),
    };
    this._writeLongJobJson(paths.jobJsonAbs, updatedJob);

    this.emit("event", {
      runId,
      event: "diag",
      data: { role: "system", type: "warning", message: `Long job stopped: ${jobId} (${kill.ok ? "killed" : "kill_failed"})` },
    });

    run.lastJobId = jobId;
    run.activeJobId = null;
    run.activeJob = null;

    if (wakeDeveloper && !preserveRunStatus) {
      run.status = "implementing";
      run.developerStatus = "ongoing";
      this._setRun(runId, run);
      this._setProjectDeveloperStatusBestEffort(run, "ongoing", `Long job stopped (${jobId}). ${reason ? String(reason) : ""}`.trim());
      if (run._longJobAutoResume && !this._runningRunId && !this._active) this._startAutoRun(runId);
    } else {
      if (run.developerStatus === "waiting_job") run.developerStatus = "ongoing";
      this._setRun(runId, run);
      this._setProjectDeveloperStatusBestEffort(
        run,
        run.developerStatus || "ongoing",
        `Long job stopped (${jobId}) while pipeline status remained ${run.status || "unchanged"}. ${reason ? String(reason) : ""}`.trim(),
      );
    }
    this._refreshTaskLongJobHistory(runId, { taskId: run.currentTaskId || null });
    return { ok: true, kill };
  }

  _restartActiveLongJob(runId, { reason } = {}) {
    const run = this._getRunRequired(runId);
    const jobId = run.activeJobId ? String(run.activeJobId) : "";
    if (!jobId) return { ok: false, reason: "no_active_job" };
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    const launch = this._normalizeLongJobLaunch(job);
    if (!launch) return { ok: false, reason: "missing_command" };

    // Stop first (best-effort).
    try {
      this._stopActiveLongJob(runId, { reason: reason || "restart", wakeDeveloper: false });
    } catch {
      // ignore
    }

    // Rotate logs.
    const ts = longJob.nowIsoForFile().slice(0, 19);
    try {
      if (fs.existsSync(paths.stdoutAbs)) fs.renameSync(paths.stdoutAbs, path.join(paths.jobDirAbs, `stdout-${ts}.log`));
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(paths.stderrAbs)) fs.renameSync(paths.stderrAbs, path.join(paths.jobDirAbs, `stderr-${ts}.log`));
    } catch {
      // ignore
    }

    const child = this._spawnLongJobProcess(run, paths, launch, { jobId, taskId: job?.task_id || run.currentTaskId || null });

    const next = {
      ...(job || { schema: "antidex.long_job.v1", job_id: jobId, run_id: run.runId, task_id: run.currentTaskId || null }),
      status: "running",
      pid: child.pid,
      command: launch.command,
      command_argv: launch.commandArgv,
      restarted_at: nowIso(),
      restart_reason: reason || null,
      restart_count: Number(job?.restart_count || 0) + 1,
      updated_at: nowIso(),
    };
    this._writeLongJobJson(paths.jobJsonAbs, next);
    run.status = "waiting_job";
    run.developerStatus = "waiting_job";
    this._setRun(runId, run);
    this._setProjectDeveloperStatusBestEffort(run, "waiting_job", `Long job restarted (${jobId}).`);
    this.emit("event", { runId, event: "diag", data: { role: "system", type: "info", message: `Long job restarted: ${jobId} (pid=${child.pid})` } });
    return { ok: true };
  }

  async _runLongJobMonitorTurn(runId, { force, reason } = {}) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return { ok: false, reason: "run_stopped" };
    if (run.status === "stopped" || run.status === "paused" || run.status === "canceled") {
      return { ok: false, reason: "run_not_active" };
    }
    const jobId = run.activeJobId ? String(run.activeJobId) : "";
    if (!jobId) return { ok: false, reason: "no_active_job" };
    const paths = this._jobPaths(run, jobId);
    const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
    if (!job) return { ok: false, reason: "missing_job_json" };

    longJob.ensureDir(paths.monitorDirAbs);
    const ts = longJob.nowIsoForFile().slice(0, 19);
    const repJsonAbs = path.join(paths.monitorDirAbs, `REP-${ts}.json`);
    const repMdAbs = path.join(paths.monitorDirAbs, `REP-${ts}.md`);
    const repJsonRel = relPathForPrompt(run.cwd, repJsonAbs);
    const repMdRel = relPathForPrompt(run.cwd, repMdAbs);
    const pid = job.pid != null ? Number(job.pid) : null;
    const pidAlive = pid != null ? longJob.isPidAlive(pid) : false;
    const startedAtMs = tryParseIsoToMs(job.started_at);
    const nowMs = Date.now();
    const elapsedMinutes = Number.isFinite(startedAtMs) ? Math.max(0, Math.round((nowMs - startedAtMs) / 60000)) : null;
    const stdoutSt = longJob.safeStat(paths.stdoutAbs);
    const stderrSt = longJob.safeStat(paths.stderrAbs);
    const hbSt = longJob.safeStat(paths.heartbeatAbs);
    const progSt = longJob.safeStat(paths.progressAbs);
    const resultSt = longJob.safeStat(paths.resultAbs);
    const result = this._readLongJobJsonBestEffort(paths.resultAbs);
    const lastMonitor = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);

    const threadId = await this._ensureThread({ runId, role: "monitor" });
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "monitor",
      step: force ? "job_monitor_forced" : "job_monitor",
      threadId,
      model: run.developerModel,
      buildPrompt: ({ run, turnNonce, marker, retryReason }) => {
        const header = buildReadFirstHeader({
          role: "monitor",
          turnNonce,
          readPaths: [
            relPathForPrompt(run.cwd, run.projectDeveloperInstructionPath || path.join(run.cwd, "agents", "developer_codex.md")),
            paths.jobJsonRel,
            paths.requestRel,
            paths.heartbeatRel,
            paths.progressRel,
            paths.stdoutRel,
            paths.stderrRel,
            paths.resultRel,
            paths.latestMonitorJsonRel,
            paths.latestMonitorMdRel,
          ],
          writePaths: [repJsonRel, repMdRel, paths.latestMonitorJsonRel, paths.latestMonitorMdRel, ...(marker ? [marker.tmpRel, marker.doneRel] : [])],
          notes: [
            "You are the LONG-JOB MONITOR. Keep output short and actionable.",
            "You MUST write both REP-*.json and REP-*.md, and also update monitor_reports/latest.{json,md}.",
            "Decision must be one of: continue | stop | restart | wake_developer | escalate_manager.",
            ...(marker
              ? [`TURN COMPLETION MARKER (required): write ${marker.tmpRel} then rename to ${marker.doneRel} with content 'ok' as the LAST step of this turn.`]
              : []),
          ],
        });

        const retry = retryReason ? `\n\nRETRY REQUIRED: ${retryReason}\nWrite the files now; do not narrate.` : "";
        return [
          header,
          "",
          `Job: ${jobId}`,
          `Run: ${run.runId}`,
          `Task: ${job.task_id || run.currentTaskId || "(unknown)"}`,
          "",
          "Goal:",
          "- Inspect job state (job.json), logs, heartbeat/progress.",
          "- Decide whether the job is healthy and whether any action is needed.",
          "- Produce an hourly report visible in the Antidex UI.",
          "",
          "Write files:",
          `1) ${repJsonRel} (JSON)`,
          `2) ${repMdRel} (Markdown)`,
          `3) Update ${paths.latestMonitorJsonRel} and ${paths.latestMonitorMdRel} (copy same content).`,
          "",
          "JSON schema (latest.json and REP-*.json):",
          "{",
          '  "schema":"antidex.long_job.monitor_report.v1",',
          '  "at":"<ISO>",',
          '  "job_id":"...", "run_id":"...", "task_id":"...",',
          '  "status":"running|stalled|crashed|done|unknown",',
          '  "summary":"short",',
          '  "decision":"continue|stop|restart|wake_developer|escalate_manager",',
          '  "decision_reason":"short",',
          '  "suggested_next_steps":["..."]',
          "}",
          "",
          "Heuristics:",
          "- If pid is dead and no result.json: status=crashed, decision=restart (or wake_developer).",
          "- If logs/heartbeat haven't changed in a long time: status=stalled, decision=restart or wake_developer.",
          "- If result.json exists and indicates done: status=done, decision=wake_developer.",
          "- If the pid is alive and the job is still within the warmup / expected window, prefer decision=continue unless there is explicit evidence of failure.",
          "- Do NOT infer a stall from ambiguous timestamps or timezone confusion; use the authoritative facts below.",
          "",
          "Authoritative runtime facts:",
          `- pid_alive: ${pidAlive ? "yes" : "no"}`,
          `- started_at: ${job.started_at || "(missing)"}`,
          `- now_iso: ${new Date(nowMs).toISOString()}`,
          `- elapsed_minutes: ${elapsedMinutes == null ? "(unknown)" : elapsedMinutes}`,
          `- expected_minutes: ${job.expected_minutes ?? "(unknown)"}`,
          `- silent_warmup_minutes: ${Math.round(LONG_JOB_SILENT_WARMUP_MS / 60000)}`,
          `- stdout_log_bytes: ${stdoutSt?.size ?? 0}`,
          `- stderr_log_bytes: ${stderrSt?.size ?? 0}`,
          `- heartbeat_seen: ${hbSt ? "yes" : "no"}`,
          `- heartbeat_mtime: ${hbSt ? new Date(hbSt.mtimeMs).toISOString() : "(missing)"}`,
          `- progress_seen: ${progSt ? "yes" : "no"}`,
          `- progress_mtime: ${progSt ? new Date(progSt.mtimeMs).toISOString() : "(missing)"}`,
          `- result_exists: ${resultSt ? "yes" : "no"}`,
          `- result_status: ${result && typeof result.status === "string" ? result.status : "(missing)"}`,
          `- last_monitor_decision: ${lastMonitor && typeof lastMonitor.decision === "string" ? lastMonitor.decision : "(none)"}`,
          "",
          `Context: ${reason ? String(reason) : force ? "forced by UI" : "scheduled"}`,
          retry,
          "",
        ].join("\n");
      },
      verifyPostconditions: async () => {
        if (!fileExists(repJsonAbs) || !fileExists(repMdAbs)) return { ok: false, reason: `Missing monitor report files (${repJsonRel} / ${repMdRel})` };
        if (!fileExists(paths.latestMonitorJsonAbs) || !fileExists(paths.latestMonitorMdAbs)) {
          return { ok: false, reason: `Missing latest monitor files (${paths.latestMonitorJsonRel} / ${paths.latestMonitorMdRel})` };
        }
        const report = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);
        if (!report || report.schema !== "antidex.long_job.monitor_report.v1") return { ok: false, reason: "Invalid latest monitor JSON schema" };
        const decision = typeof report.decision === "string" ? report.decision.trim() : "";
        if (!decision) return { ok: false, reason: "Missing decision in latest monitor JSON" };
        return { ok: true };
      },
      maxAttempts: 3,
    });

    if (!attempt.ok) return { ok: false, reason: attempt.errorMessage || "monitor postconditions failed" };
    const report = this._readLongJobJsonBestEffort(paths.latestMonitorJsonAbs);
    return { ok: true, report };
  }

  _applyLongJobMonitorDecision(runId, report) {
    if (!report || typeof report !== "object") return { ok: false, reason: "missing_report" };
    const decision = String(report.decision || "").trim().toLowerCase();
    const status = String(report.status || "").trim().toLowerCase();
    const reason = typeof report.decision_reason === "string" ? report.decision_reason : null;
    const deferred = this._shouldDeferLongJobDecision(runId, report);
    if (deferred?.ok) {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: deferred.reason },
      });
      return { ok: true, action: "deferred" };
    }
    if (decision === "continue") return { ok: true, action: "none" };
    if (decision === "stop") return { ok: true, action: "stop", result: this._stopActiveLongJob(runId, { reason }) };
    if (decision === "restart") return { ok: true, action: "restart", result: this._restartActiveLongJob(runId, { reason }) };
    if (decision === "wake_developer") {
      try {
        this._stopActiveLongJob(runId, { reason: reason || "wake_developer", wakeDeveloper: true });
      } catch {
        // ignore
      }
      this._wakeDeveloperAfterLongJob(runId, { reason: reason || `monitor status=${status}` });
      return { ok: true, action: "wake_developer" };
    }
    if (decision === "escalate_manager") {
      try {
        this._stopActiveLongJob(runId, { reason: reason || "escalate_manager", wakeDeveloper: false });
      } catch {
        // ignore
      }
      const updated = this._getRunRequired(runId);
      updated.status = "implementing";
      updated.developerStatus = "blocked";
      updated.lastError = { message: `Long job monitor escalated to Manager (${reason || "see latest monitor report"})`, at: nowIso(), where: "job/escalate_manager" };
      this._setRun(runId, updated);
      try {
        const { taskDir, taskId, taskDirRel } = taskContext(updated);
        const qAbs = writeTaskQuestion({
          taskDir,
          prefix: "Q-job-monitor",
          title: `Long job monitor escalation for ${taskId}`,
          body: [
            "The long-job monitor requested a Manager decision.",
            "",
            `Latest monitor report: ${updated.activeJob?.latestMonitorMdRel || "(missing)"}`,
            "",
            `Reason: ${reason || "(none)"}`,
            "",
            "Manager: decide whether to adjust the long job command, restart it, or change the task scope.",
            "",
            `Task folder: ${taskDirRel}`,
          ].join("\n"),
        });
        this._setProjectDeveloperStatusBestEffort(updated, "blocked", `Job monitor escalated (see ${relPathForPrompt(updated.cwd, qAbs)}).`);
      } catch {
        // ignore
      }
      return { ok: true, action: "escalate_manager" };
    }
    return { ok: false, reason: `unknown_decision:${decision}` };
  }

  async _tickLongJobs() {
    // Never let background supervisor crash the server.
    if (this._active) return;
    const runs = this._state.listRuns();
    for (const snapshot of runs) {
      const runId = snapshot?.runId ? String(snapshot.runId) : "";
      if (!runId) continue;
      let run;
      try {
        run = this._getRunRequired(runId);
      } catch {
        continue;
      }
      if (!run.cwd) continue;
      if (this._isTerminalStatus(run.status)) continue;

      // Ensure layout exists (write-if-missing).
      try {
        longJob.ensureJobsLayout(run.cwd);
      } catch {
        // ignore
      }

      // Recover active jobs after restart.
      if (!run.activeJobId && (run.status === "waiting_job" || run.developerStatus === "waiting_job")) {
        this._adoptActiveLongJobFromDisk(runId);
        run = this._getRunRequired(runId);
      }

      if (!run.activeJobId && (run.status === "waiting_job" || run.developerStatus === "waiting_job")) {
        const recovered = this._recoverStaleWaitingJob(runId, { reason: "tick_no_live_job" });
        if (recovered) continue;
        run = this._getRunRequired(runId);
      }

      // Start a job if a matching request exists and no active job is running.
      if (!run.activeJobId) {
        const nextReq = this._pickNextLongJobRequest(run);
        const shouldStart =
          !!nextReq &&
          run.assignedDeveloper === "developer_codex" &&
          (run.developerStatus === "waiting_job" ||
            run.status === "waiting_job" ||
            (nextReq.request.task_id && run.currentTaskId && nextReq.request.task_id === run.currentTaskId));
        if (shouldStart) {
          try {
            const current = this._getRunRequired(runId);
            if (this._isTerminalStatus(current.status) || current.status === "paused") continue;
            this._startLongJobFromRequest(runId, nextReq.path, nextReq.request);
          } catch (e) {
            const cur = this._getRunRequired(runId);
            cur.status = "implementing";
            cur.developerStatus = "blocked";
            cur.lastError = { message: `Failed to start long job: ${safeErrorMessage(e)}`, at: nowIso(), where: "job/start" };
            this._setRun(runId, cur);
            try {
              await this._handleIncident(runId, "long job start failed");
            } catch {
              // ignore
            }
          }
        }
      }

      run = this._getRunRequired(runId);
      if (!run.activeJobId) continue;

      // Keep UI state fresh.
      try {
        this._refreshActiveLongJobSummary(runId);
      } catch {
        // ignore
      }

      // If the run is paused/stopped/canceled, do not run monitors nor trigger incidents.
      if (run.status === "paused" || run.status === "stopped" || run.status === "canceled") continue;

      const jobId = String(run.activeJobId);
      const paths = this._jobPaths(run, jobId);
      const job = this._readLongJobJsonBestEffort(paths.jobJsonAbs);
      if (!job) continue;

      const pid = job.pid != null ? Number(job.pid) : null;
      const alive = pid != null ? longJob.isPidAlive(pid) : false;
      const result = this._readLongJobJsonBestEffort(paths.resultAbs);
      const resultState = this._getLongJobResultState(result);

      // Completion / crash detection.
      if (resultState.isDone) {
        if (String(job.status || "").toLowerCase() !== "done") {
          const nextJob = { ...job, status: "done", finished_at: nowIso(), updated_at: nowIso() };
          this._writeLongJobJson(paths.jobJsonAbs, nextJob);
        }
        this._wakeDeveloperAfterLongJob(runId, { reason: "result.json indicates done" });
        continue;
      }
      if (resultState.isFailure) {
        if (String(job.status || "").toLowerCase() !== "error") {
          const nextJob = {
            ...job,
            status: "error",
            finished_at: nowIso(),
            error: result && typeof result.error === "string" ? result.error : `result_status_${resultState.status || "error"}`,
            updated_at: nowIso(),
          };
          this._writeLongJobJson(paths.jobJsonAbs, nextJob);
        }
        const cur = this._getRunRequired(runId);
        const taskId = job.task_id || cur.currentTaskId;
        this._writeSyntheticLongJobMonitorReport(cur, jobId, {
          taskId,
          status: "failed",
          decision: "wake_developer_now",
          summary: `Job ended with result.json status=${resultState.status || "error"} for ${jobId}.`,
          decisionReason: result && typeof result.error === "string" ? result.error : "The job wrote an explicit terminal failure result.",
          suggestedNextSteps: [
            "Inspect result.json, stdout.log and stderr.log for the declared failure.",
            "Fix the job definition or benchmark wrapper, then relaunch the task.",
            "Only escalate to the manager if the relaunch plan is unclear.",
          ],
        });
        this._wakeDeveloperAfterLongJob(runId, { reason: `result.json indicates ${resultState.status || "error"}` });
        continue;
      }
      if (!alive && String(job.status || "").toLowerCase() === "running") {
        const nextJob = { ...job, status: "error", finished_at: nowIso(), error: "pid_not_alive_and_no_done_result", updated_at: nowIso() };
        this._writeLongJobJson(paths.jobJsonAbs, nextJob);
        const cur = this._getRunRequired(runId);
        const pendingReq = this._pickNextLongJobRequest(cur);
        if (pendingReq) {
          this._clearActiveLongJobReference(cur, { preserveLastJobId: true });
          cur.status = "waiting_job";
          cur.developerStatus = "waiting_job";
          this._setRun(runId, cur);
          appendRecoveryLog(cur, {
            role: "system",
            step: "job",
            status: "pending_request_supersedes_restart",
            job_id: jobId,
            task_id: job.task_id || cur.currentTaskId || null,
          });
          continue;
        }
        const restartCount = Number(job?.restart_count || 0);
        if (restartCount < 1) {
          const restarted = this._restartActiveLongJob(runId, { reason: "auto_restart_after_crash" });
          if (restarted?.ok) {
            appendRecoveryLog(this._getRunRequired(runId), {
              role: "system",
              step: "job",
              status: "auto_restarted",
              job_id: jobId,
              task_id: job.task_id || run.currentTaskId || null,
            });
            continue;
          }
        }

        const curAfterRestart = this._getRunRequired(runId);
        const taskId = job.task_id || curAfterRestart.currentTaskId;
        this._writeSyntheticLongJobMonitorReport(curAfterRestart, jobId, {
          taskId,
          status: "crashed",
          decision: "escalate_manager",
          summary: `Process exited without result.json for ${jobId}.`,
          decisionReason: "PID not alive and no done result.json.",
          suggestedNextSteps: [
            "Inspect stdout.log and stderr.log for the failing launch.",
            "Fix the long-job command or script, then relaunch the task.",
            "Keep the run blocked until the relaunch plan is explicit.",
          ],
        });
        const { taskDir, taskDirRel } = taskContext(curAfterRestart, taskId);
        const questionAbs = writeTaskQuestion({
          taskDir,
          prefix: "Q-job-crash",
          title: `Long job crashed for ${taskId || "(unknown task)"}`,
          body: [
            `The long job process exited without a valid result.json.`,
            "",
            `Job: ${jobId}`,
            `Job dir: ${paths.jobDirRel}`,
            "",
            "Manager action required:",
            `- Inspect job logs + state: ${paths.jobJsonRel}, ${paths.stdoutRel}, ${paths.stderrRel}`,
            "- Decide how to proceed:",
            "  - Restart the long job (preferred if checkpoints/logs look healthy), or",
            "  - Ask the developer to adjust the command / scope and re-run, or",
            "  - Switch this task to a non-long-job approach if needed.",
            "",
            `Then update ${taskDirRel}/manager_instruction.md (if needed) and set data/pipeline_state.json:`,
            "- developer_status=ongoing to re-dispatch/restart, OR",
            "- developer_status=blocked if you need further clarification.",
            "",
            `Write a short answer in ${taskDirRel}/answers/A-*.md summarizing your decision.`,
          ].join("\n"),
        });
        const relQ = relPathForPrompt(curAfterRestart.cwd, questionAbs);

        try {
          const stateRead = readJsonBestEffort(curAfterRestart.projectPipelineStatePath);
          const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
          state.developer_status = "blocked";
          state.manager_decision = null;
          state.summary = `Long job crashed for ${taskId} (see ${relQ}).`;
          state.updated_at = nowIso();
          writeJsonAtomic(curAfterRestart.projectPipelineStatePath, state);
        } catch {
          // ignore
        }

        this._clearActiveLongJobReference(curAfterRestart, { preserveLastJobId: true });
        curAfterRestart.status = "implementing";
        curAfterRestart.developerStatus = "blocked";
        curAfterRestart.lastError = { message: `Long job crashed: ${jobId} (pid died; no done result.json)`, at: nowIso(), where: "job/crash" };
        this._setRun(runId, curAfterRestart);
        try {
          await this._handleIncident(runId, "long job crash");
        } catch {
          // ignore
        }
        continue;
      }

      // Stall detection (best-effort): rely on filesystem activity (logs/heartbeat/progress).
      if (alive && !job.stalled_incident_at) {
        const stdoutSt = longJob.safeStat(paths.stdoutAbs);
        const stderrSt = longJob.safeStat(paths.stderrAbs);
        const hbSt = longJob.safeStat(paths.heartbeatAbs);
        const progSt = longJob.safeStat(paths.progressAbs);
        const lastActivityMs = Math.max(
          0,
          stdoutSt?.mtimeMs || 0,
          stderrSt?.mtimeMs || 0,
          hbSt?.mtimeMs || 0,
          progSt?.mtimeMs || 0,
        );
        const nowMs = Date.now();
        if (lastActivityMs > 0 && nowMs - lastActivityMs > LONG_JOB_STALL_MS) {
          const nextJob = { ...job, stalled_incident_at: nowIso(), updated_at: nowIso() };
          this._writeLongJobJson(paths.jobJsonAbs, nextJob);
          const cur = this._getRunRequired(runId);
          cur.status = "implementing";
          cur.developerStatus = "blocked";
          cur.lastError = {
            message: `Long job appears stalled (> ${Math.round(LONG_JOB_STALL_MS / 60000)}m without activity): ${jobId}`,
            at: nowIso(),
            where: "job/stalled",
          };
          this._setRun(runId, cur);
          try {
            await this._handleIncident(runId, "long job stalled");
          } catch {
            // ignore
          }
          continue;
        }
      }

      // Monitor cadence (hourly by default).
      const everyMin =
        Number.isFinite(Number(job.monitor_every_minutes)) && Number(job.monitor_every_minutes) > 0
          ? Number(job.monitor_every_minutes)
          : LONG_JOB_MONITOR_EVERY_MINUTES;
      const graceMin =
        Number.isFinite(Number(job.monitor_grace_minutes)) && Number(job.monitor_grace_minutes) >= 0
          ? Number(job.monitor_grace_minutes)
          : LONG_JOB_MONITOR_GRACE_MINUTES;
      const lastReportSt = longJob.safeStat(paths.latestMonitorJsonAbs);
      const lastReportAtMs = lastReportSt ? lastReportSt.mtimeMs : null;
      const startedAtMs = tryParseIsoToMs(job.started_at) ?? Date.now();
      const nowMs = Date.now();
      const dueMs = (lastReportAtMs ?? (startedAtMs - everyMin * 60_000)) + everyMin * 60_000;
      const overdueMs = dueMs + graceMin * 60_000;

      const monitorState = this._longJobMonitors.get(runId) || { running: false, lastStartedAtMs: 0 };
      const shouldRunMonitor = !monitorState.running && nowMs >= dueMs && alive;
      const noReportYet = !lastReportAtMs && nowMs - startedAtMs > LONG_JOB_INITIAL_MONITOR_DELAY_MS;
      const shouldRunInitial = noReportYet && !monitorState.running && alive;

      if (shouldRunInitial || shouldRunMonitor) {
        monitorState.running = true;
        monitorState.lastStartedAtMs = nowMs;
        this._longJobMonitors.set(runId, monitorState);
        try {
          const current = this._getRunRequired(runId);
          if (this._stopRequested.has(runId) || current.status === "stopped" || current.status === "paused" || current.status === "canceled") {
            continue;
          }
          const mon = await this._runLongJobMonitorTurn(runId, { force: shouldRunInitial, reason: shouldRunInitial ? "initial report" : "scheduled report" });
          if (mon.ok && mon.report) {
            try {
              this._applyLongJobMonitorDecision(runId, mon.report);
            } catch {
              // ignore
            }
          }
        } catch (e) {
          const current = this._getRunRequired(runId);
          if (this._stopRequested.has(runId) || current.status === "stopped" || current.status === "paused" || current.status === "canceled") {
            continue;
          }
          const cur = this._getRunRequired(runId);
          cur.status = "implementing";
          cur.developerStatus = "blocked";
          cur.lastError = { message: `Long job monitor failed: ${safeErrorMessage(e)}`, at: nowIso(), where: "job/monitor_missed" };
          this._setRun(runId, cur);
          try {
            await this._handleIncident(runId, "long job monitor failure");
          } catch {
            // ignore
          }
        } finally {
          const s = this._longJobMonitors.get(runId) || monitorState;
          s.running = false;
          this._longJobMonitors.set(runId, s);
        }
      } else if (!monitorState.running && lastReportAtMs != null && nowMs >= overdueMs && alive) {
        const current = this._getRunRequired(runId);
        if (this._stopRequested.has(runId) || current.status === "stopped" || current.status === "paused" || current.status === "canceled") {
          continue;
        }
        const cur = this._getRunRequired(runId);
        cur.status = "implementing";
        cur.developerStatus = "blocked";
        cur.lastError = {
          message: `Long job monitor overdue (> ${everyMin}m + ${graceMin}m grace) for ${jobId}`,
          at: nowIso(),
          where: "job/monitor_missed",
        };
        this._setRun(runId, cur);
        try {
          await this._handleIncident(runId, "long job monitor overdue");
        } catch {
          // ignore
        }
      }
    }
  }

  _stepSignatureForLoopGuard(run) {
    if (!run) return "";
    return [
      run.projectPhase || "",
      run.currentTaskId || "",
      run.assignedDeveloper || "",
      run.developerStatus || "",
      run.managerDecision || "",
    ]
      .map((v) => String(v))
      .join("|");
  }

  _taskSpecPaths(run, taskIdOverride) {
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);
    return {
      taskId,
      taskDir,
      taskDirRel,
      taskMdAbs: path.join(taskDir, "task.md"),
      managerInstrAbs: path.join(taskDir, "manager_instruction.md"),
    };
  }

  async _autoRebaseIfInvalidCurrentTask(runId, { reason } = {}) {
    const run = this._getRunRequired(runId);
    const taskId = run.currentTaskId ? String(run.currentTaskId) : "";
    if (!taskId) return false;

    const placeholder = /^T-xxx_slug$/i.test(taskId);
    const spec = this._taskSpecPaths(run, taskId);
    const missingSpec = !fileExists(spec.taskMdAbs) || !fileExists(spec.managerInstrAbs);
    if (!placeholder && !missingSpec) return false;

    const why = placeholder ? "placeholder_task_id" : "missing_task_spec";
    const effectiveReason = reason || `auto_rebase_${why}`;

    await this._forceRebaseToTodo(runId, { reason: effectiveReason });
    const after = this._getRunRequired(runId);
    const nextTaskId = after.currentTaskId ? String(after.currentTaskId) : "";

    if (nextTaskId && nextTaskId !== taskId) {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: `Auto-rebased from invalid current task ${taskId} -> ${nextTaskId} (${why}).` },
      });
      try {
        this._appendRunTimeline(runId, { type: "auto_rebase_invalid_current_task", from: taskId, to: nextTaskId, why });
      } catch {
        // ignore
      }
      return true;
    }

    return false;
  }

  _blockManagerForMissingTaskSpec(runId, { taskIdOverride, missing, context }) {
    const run = this._getRunRequired(runId);
    const { taskId, taskDir, taskDirRel } = this._taskSpecPaths(run, taskIdOverride);

    // Ensure a task folder exists so the Manager has a place to write answers + spec.
    try {
      ensureDir(taskDir);
    } catch {
      // ignore
    }

    const title = `Missing task specification for ${taskId}`;
    const body = [
      "The orchestrator cannot proceed because this task is missing its specification files.",
      "",
      `Context: ${context || "unknown"}`,
      "",
      "Missing file(s):",
      ...(missing || []).map((p) => `- ${p}`),
      "",
      "Manager action required:",
      `1) Create/restore BOTH files for this task:`,
      `   - ${taskDirRel}/task.md`,
      `   - ${taskDirRel}/manager_instruction.md`,
      "   (Include Definition of Done + any constraints; keep it aligned with doc/TODO.md.)",
      `2) Answer here: ${taskDirRel}/answers/A-*.md with a short summary of what you changed/decided.`,
      `3) Update data/pipeline_state.json to resume safely:`,
      `   - If the task already has valid developer outputs: set developer_status=ready_for_review.`,
      `   - Else: set developer_status=ongoing (so the developer will be dispatched).`,
      "",
      "Note: This question was created by the orchestrator guardrail to avoid infinite loops.",
    ].join("\n");

    const qAbs = writeTaskQuestion({ taskDir, prefix: "Q-missing-spec", title, body });
    const relQ = relPathForPrompt(run.cwd, qAbs);

    // Update project pipeline_state.json to reflect a controlled block.
    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.run_id = state.run_id || run.runId;
      state.current_task_id = state.current_task_id || taskId;
      state.assigned_developer = state.assigned_developer || run.assignedDeveloper || null;
      state.developer_status = "blocked";
      state.manager_decision = null;
      state.summary = `Orchestrator guardrail: missing task spec for ${taskId} (see ${relQ}).`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "blocked";
    run.managerDecision = null;
    run.lastError = { message: `Missing task spec for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/missing_task_spec" };
    this._setRun(runId, run);

    this.emit("event", {
      runId,
      event: "diag",
      data: { role: "system", type: "warning", message: run.lastError.message },
    });
    appendRecoveryLog(run, { role: "system", step: "guardrail", status: "blocked", task_id: taskId, question: relQ });

    return false;
  }

  _blockManagerForAssignedDeveloperManager(runId, { taskIdOverride, context } = {}) {
    const run = this._getRunRequired(runId);
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);

    // Ensure a task folder exists so the Manager has a place to write answers + updated spec.
    try {
      ensureDir(taskDir);
    } catch {
      // ignore
    }

    const title = `Invalid assigned_developer=manager for dispatchable task ${taskId}`;
    const body = [
      "The orchestrator cannot dispatch this task because `assigned_developer` is set to `manager`.",
      "",
      `Context: ${context || "unknown"}`,
      "",
      "Antidex currently supports dispatching only:",
      "- developer_codex",
      "- developer_antigravity",
      "",
      "Manager action required (choose ONE):",
      "",
      "A) Externalize the task to a developer:",
      `- Update ${taskDirRel}/task.md to assign either developer_codex or developer_antigravity.`,
      "- Update data/pipeline_state.json:",
      `  - keep current_task_id=${taskId}`,
      "  - set assigned_developer accordingly",
      "  - set developer_status=ongoing",
      "",
      "B) If this is meant to be a final Manager-only validation (recommended):",
      "- Do NOT model it as a dispatchable task.",
      "- Instead: perform the validation now by updating docs (especially doc/TESTING_PLAN.md), write your final notes,",
      "  then set manager_decision=completed in data/pipeline_state.json.",
      "  (If you want traceability, write a short summary into the current task's answers/A-*.md.)",
      "",
      `- Answer here: ${taskDirRel}/answers/A-*.md explaining what you decided and why.`,
      "",
      "Then click Continue pipeline.",
    ].join("\n");

    const qAbs = writeTaskQuestion({ taskDir, prefix: "Q-invalid-assigned-developer", title, body });
    const relQ = relPathForPrompt(run.cwd, qAbs);

    // Update project pipeline_state.json to reflect a controlled block.
    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.run_id = state.run_id || run.runId;
      state.current_task_id = state.current_task_id || taskId;
      state.assigned_developer = state.assigned_developer || "manager";
      state.developer_status = "blocked";
      state.manager_decision = null;
      state.summary = `Orchestrator guardrail: assigned_developer=manager is not dispatchable (see ${relQ}).`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "blocked";
    run.managerDecision = null;
    run.lastError = { message: `assigned_developer=manager is not dispatchable for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/assigned_developer_manager" };
    this._setRun(runId, run);
    appendRecoveryLog(run, { role: "system", step: "guardrail", status: "blocked", task_id: taskId, question: relQ });
    return false;
  }

  _ensureTaskSpecOrBlock(runId, { taskIdOverride, context } = {}) {
    const run = this._getRunRequired(runId);
    if (!run.currentTaskId && !taskIdOverride) return true;
    const { taskId, taskDirRel, taskMdAbs, managerInstrAbs } = this._taskSpecPaths(run, taskIdOverride);
    void taskId;
    const missing = [];
    if (!fileExists(taskMdAbs)) missing.push(`${taskDirRel}/task.md`);
    if (!fileExists(managerInstrAbs)) missing.push(`${taskDirRel}/manager_instruction.md`);
    if (!missing.length) return true;

    // Idempotence: if we're already blocked for this task and the spec is still missing,
    // don't keep spamming new Q-missing-spec files.
    if (run.developerStatus === "blocked" && run.currentTaskId === taskId && !taskIdOverride) {
      try {
        const { taskDir } = taskContext(run, taskId);
        const qDir = path.join(taskDir, "questions");
        const ents = fs.existsSync(qDir) ? fs.readdirSync(qDir) : [];
        const hasMissingSpecQ = ents.some((n) => /^Q-missing-sp-.*\.md$/i.test(n) || /^Q-missing-spec-.*\.md$/i.test(n));
        if (hasMissingSpecQ) return false;
      } catch {
        // ignore
      }
    }
    return this._blockManagerForMissingTaskSpec(runId, { taskIdOverride, missing, context });
  }

  _bumpDispatchCountOrBlock(runId, { taskIdOverride, developer, limit = 3, context } = {}) {
    const run = this._getRunRequired(runId);
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);

    if (developer === "developer_antigravity" && this._blockAgAfterStalls(runId, { taskIdOverride })) {
      return false;
    }

    if (!run.taskDispatchCounts || typeof run.taskDispatchCounts !== "object") run.taskDispatchCounts = {};
    const prev = Number(run.taskDispatchCounts[taskId] || 0);
    const next = prev + 1;
    run.taskDispatchCounts[taskId] = next;
    this._setRun(runId, run);

    if (next <= limit) return true;

    const qAbs = writeTaskQuestion({
      taskDir,
      prefix: "Q-dispatch-loop",
      title: `Too many dispatch attempts for ${taskId}`,
      body: [
        "The orchestrator detected repeated dispatch attempts for the same task without reaching an accepted outcome.",
        "",
        `Context: ${context || "unknown"}`,
        `Developer: ${developer || run.assignedDeveloper || "unknown"}`,
        `Dispatch attempts observed: ${next} (limit=${limit})`,
        "",
        "Manager action required:",
        `- Re-check ${taskDirRel}/task.md + ${taskDirRel}/manager_instruction.md (is DoD clear and realistic?)`,
        "- Decide how to proceed: split the task, simplify requirements, switch developer, or ask a clarification question.",
        `- Write an answer in ${taskDirRel}/answers/A-*.md and update data/pipeline_state.json accordingly.`,
        "",
        "Note: This guardrail prevents infinite loops and token burn.",
      ].join("\n"),
    });
    const relQ = relPathForPrompt(run.cwd, qAbs);

    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.developer_status = "blocked";
      state.manager_decision = null;
      state.summary = `Orchestrator guardrail: too many dispatch attempts for ${taskId} (see ${relQ}).`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "blocked";
    run.managerDecision = null;
    run.lastError = { message: `Dispatch loop guard for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/dispatch_loop" };
    this._setRun(runId, run);
    appendRecoveryLog(run, { role: "system", step: "guardrail", status: "blocked", task_id: taskId, question: relQ });
    return false;
  }

  _blockAgAfterStalls(runId, { taskIdOverride, priorStalls } = {}) {
    const run = this._getRunRequired(runId);
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);

    if (!run.agRetryCounts || typeof run.agRetryCounts !== "object") run.agRetryCounts = {};
    if (!run.agForceNewThreadNextByTask || typeof run.agForceNewThreadNextByTask !== "object") run.agForceNewThreadNextByTask = {};
    if (!run.agReloadCounts || typeof run.agReloadCounts !== "object") run.agReloadCounts = {};

    const stalls = Number.isFinite(priorStalls) ? priorStalls : Number(run.agRetryCounts[taskId] || 0);
    if (stalls < 3) return false;

    const questionAbs = writeTaskQuestion({
      taskDir,
      prefix: "Q-watchdog",
      title: `AG disabled for ${taskId} after 3 stalls`,
      body: [
        `Antidex watchdog has already detected ${stalls} consecutive AG stalls for this task.`,
        "",
        "Action required (Manager):",
        `- Re-read the task: ${taskDirRel}/task.md and ${taskDirRel}/manager_instruction.md`,
        `- Inspect any partial AG outputs (if any): data/AG_internal_reports/ and data/antigravity_runs/*`,
        "- Decide next step:",
        "  - Prefer switching this task to developer_codex (set assigned_developer=developer_codex) and continue.",
        "  - Or explicitly override and retry AG (increase thread_policy.developer_antigravity=new_per_task), but expect degraded reliability.",
        "",
        "When done, update data/pipeline_state.json: set developer_status=\"ongoing\" and a clear summary pointing to your decision + this question file.",
      ].join("\n"),
    });
    const relQ = relPathForPrompt(run.cwd, questionAbs);

    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.developer_status = "blocked";
      state.summary = `Watchdog: AG disabled after ${stalls} stalls for ${taskId}. Manager action required (see ${relQ}).`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "blocked";
    run.lastError = { message: `AG disabled for ${taskId} after ${stalls} stalls (see ${relQ})`, at: nowIso(), where: "ag/watchdog" };
    this._setRun(runId, run);
    this._emitAg(runId, "diag", { step: "dispatching", type: "warning", message: run.lastError.message });
    appendRecoveryLog(run, { role: "developer_antigravity", step: "dispatching", status: "disabled", task_id: taskId, question: relQ });
    return true;
  }

  _bumpReviewCountOrBlock(runId, { taskIdOverride, limit = 6 } = {}) {
    const run = this._getRunRequired(runId);
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);

    if (!run.taskReviewCounts || typeof run.taskReviewCounts !== "object") run.taskReviewCounts = {};
    const prev = Number(run.taskReviewCounts[taskId] || 0);
    const next = prev + 1;
    run.taskReviewCounts[taskId] = next;
    this._setRun(runId, run);

    if (next <= limit) return true;

    const qAbs = writeTaskQuestion({
      taskDir,
      prefix: "Q-review-loop",
      title: `Too many Manager review attempts for ${taskId}`,
      body: [
        "The orchestrator detected repeated Manager reviews for the same task without advancing the pipeline.",
        "",
        `Review attempts observed: ${next} (limit=${limit})`,
        "",
        "Manager action required:",
        `- Re-check ${taskDirRel}/task.md + ${taskDirRel}/manager_instruction.md`,
        `- Re-check ${taskDirRel}/dev_result.* (and AG artifacts if applicable)`,
        "- If the task is ACCEPTED, advance current_task_id to the next task in TODO order and set developer_status=ongoing.",
        "- If REWORK is needed, keep current_task_id but set developer_status=ongoing so the developer can re-run.",
        "- If the task spec is unclear, write questions/Q-*.md and set developer_status=blocked.",
        "",
        `Then write an answer in ${taskDirRel}/answers/A-*.md and update data/pipeline_state.json accordingly, then click Continue pipeline.`,
        "",
        "Note: This guardrail prevents infinite loops and token burn.",
      ].join("\n"),
    });
    const relQ = relPathForPrompt(run.cwd, qAbs);

    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.developer_status = "blocked";
      state.manager_decision = null;
      state.summary = `Orchestrator guardrail: too many manager review attempts for ${taskId} (see ${relQ}).`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "blocked";
    run.managerDecision = null;
    run.lastError = { message: `Review loop guard for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/review_loop" };
    this._setRun(runId, run);
    appendRecoveryLog(run, { role: "system", step: "guardrail", status: "blocked", task_id: taskId, question: relQ });
    return false;
  }

  _acquireRunningLock(runId) {
    const id = String(runId || "");
    if (!id) return;
    const now = Date.now();
    this._runningRunId = id;
    this._runningLockMeta = { runId: id, acquiredAtMs: now, lastTouchedAtMs: now };
  }

  _touchRunningLock(runId) {
    const id = String(runId || "");
    if (!id) return;
    if (this._runningLockMeta && this._runningLockMeta.runId === id) {
      this._runningLockMeta.lastTouchedAtMs = Date.now();
    }
  }

  _releaseRunningLock(runId) {
    const id = String(runId || "");
    if (this._runningRunId === id) this._runningRunId = null;
    if (this._runningLockMeta && this._runningLockMeta.runId === id) this._runningLockMeta = null;
  }

  _isTerminalStatus(status) {
    // "paused" is treated as terminal for lock/status normalization purposes,
    // but it remains resumable via continuePipeline.
    return status === "completed" || status === "failed" || status === "stopped" || status === "paused" || status === "canceled";
  }

  _isResumableStatus(status) {
    return status === "stopped" || status === "paused" || status === "failed" || status === "completed";
  }

  _isRunActivelyProcessing(run) {
    if (!run) return false;
    if (this._active && this._active.runId === run.runId) return true; // Codex turn in progress
    if (run.activeTurn && typeof run.activeTurn === "object") return true; // includes AG step (we set this explicitly)
    return false;
  }

  _maybeAutoClearStaleLock() {
    if (!this._runningRunId) return { cleared: false, reason: null };
    const runId = this._runningRunId;
    const run = this._state.getRun(runId);

    if (!run) {
      this._releaseRunningLock(runId);
      return { cleared: true, reason: "run_missing" };
    }
    if (this._isTerminalStatus(run.status)) {
      this._releaseRunningLock(runId);
      return { cleared: true, reason: "terminal" };
    }
    if (this._isRunActivelyProcessing(run)) return { cleared: false, reason: "active" };

    const STALE_LOCK_MS = Number(process.env.ANTIDEX_STALE_LOCK_MS || 3 * 60 * 1000);
    const lastTouchedAtMs =
      (this._runningLockMeta && this._runningLockMeta.runId === runId && this._runningLockMeta.lastTouchedAtMs) || 0;

    let updatedAtMs = 0;
    try {
      const t = Date.parse(String(run.updatedAt || ""));
      updatedAtMs = Number.isFinite(t) ? t : 0;
    } catch {
      updatedAtMs = 0;
    }

    const last = Math.max(lastTouchedAtMs, updatedAtMs);
    if (!last) return { cleared: false, reason: "no_timestamp" };
    if (Date.now() - last <= STALE_LOCK_MS) return { cleared: false, reason: "fresh" };

    // Auto-heal: stop the stale run and release the lock (prevents permanent "Another pipeline..." situations).
    try {
      run.status = "stopped";
      run.lastError = run.lastError || { message: `Auto-unlocked stale lock after ${STALE_LOCK_MS}ms`, at: nowIso(), where: "lock" };
      this._state.setRun(runId, run);
    } catch {
      // ignore
    }

    this._releaseRunningLock(runId);
    return { cleared: true, reason: "stale" };
  }

  async checkConnectorStatus(baseUrl) {
    const client = new AntigravityConnectorClient({ baseUrl: String(baseUrl || "").trim() || "http://127.0.0.1:17375" });
    const health = await client.health().catch((e) => ({ ok: false, status: 0, json: null, text: String(e?.message || e) }));
    const diagnostics = await client.diagnostics().catch((e) => ({ ok: false, status: 0, json: null, text: String(e?.message || e) }));
    const agCmdCount = Array.isArray(diagnostics?.json?.methods) ? diagnostics.json.methods.filter((m) => String(m).toLowerCase().startsWith("antigravity.")).length : null;
    return { baseUrl: client.baseUrl, health, diagnostics, agCmdCount };
  }

  async _ensureCodex(opts = {}) {
    if (this._initialized && this._codex.isRunning()) return;

    // Isolate Codex state for Antidex runs so it doesn't pollute the user's global ~/.codex and
    // so we can control what's injected (e.g. skills / AGENTS defaults).
    ensureDir(this._codexHomeDir);

    // Best-effort: reuse the user's existing authentication to avoid re-login prompts.
    // NOTE: refresh tokens can rotate; copying only once can lead to "refresh_token_reused" errors
    // if another Codex instance refreshed the token. We keep our local auth.json in sync.
    const globalAuth = path.join(os.homedir(), ".codex", "auth.json");
    const localAuth = path.join(this._codexHomeDir, "auth.json");
    copyFileIfChanged({ src: globalAuth, dest: localAuth });

    await withTimeout(this._codex.start({ cwd: this._dataDir, env: { CODEX_HOME: this._codexHomeDir }, codexExe: opts.codexExe }), 30_000, "codex start timed out");
    await withTimeout(this._codex.initialize({}), 30_000, "codex initialize timed out");
    this._initialized = true;
  }

  _ensureConnector({ baseUrl, timeoutMs } = {}) {
    const clean = String(baseUrl || "").trim().replace(/\/+$/, "") || "http://127.0.0.1:17375";
    const t = Number(timeoutMs || 10_000);
    if (this._connector && this._connectorBaseUrl === clean) return this._connector;
    this._connectorBaseUrl = clean;
    this._connector = new AntigravityConnectorClient({ baseUrl: clean, timeoutMs: t });
    return this._connector;
  }

  async _reloadAgWindow({ runId, connector, taskId, reason } = {}) {
    const rid = String(runId || "");
    const why = reason ? String(reason) : "reload requested";
    this._emitAg(rid, "diag", { step: "recovery", type: "warning", message: `Reload Window requested for AG (${why})` });
    try {
      const res = await connector.command({ command: "workbench.action.reloadWindow" });
      appendRecoveryLog(this._getRunRequired(rid), {
        role: "developer_antigravity",
        step: "recovery",
        status: "reload_window_sent",
        task_id: taskId || null,
        reason: why,
        connector: { baseUrl: connector.baseUrl, ok: res?.ok === true, status: res?.status || 0 },
      });
    } catch (e) {
      const msg = safeErrorMessage(e);
      appendRecoveryLog(this._getRunRequired(rid), {
        role: "developer_antigravity",
        step: "recovery",
        status: "reload_window_error",
        task_id: taskId || null,
        reason: why,
        error: msg,
      });
      throw new Error(`Reload Window failed: ${msg}`);
    }

    // Best-effort: wait for connector to come back.
    const start = Date.now();
    while (Date.now() - start < 60_000) {
      try {
        const h = await connector.health();
        if (h?.ok) return;
      } catch {
        // ignore
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(1000);
    }
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

  async _runTurnWithHandshake({ runId, role, step, threadId, model, buildPrompt, verifyPostconditions, maxAttempts = 3 }) {
    let lastReason = null;
    const baseRun = this._getRunRequired(runId);

    // Important: keep the same nonce/marker across retries for this "logical turn".
    // Otherwise we end up asking the model to write marker A, then on retry marker B,
    // and it may "fix" A while the orchestrator waits for B (or vice versa).
    const turnNonce = this._newTurnNonce();
    const marker = turnMarkerPaths(baseRun, turnNonce);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const run = this._getRunRequired(runId);

      // If we already created the marker but postconditions failed, remove it so the next retry
      // is forced to create a fresh completion marker at the end of the retry turn.
      if (attempt > 1) {
        try {
          if (marker?.tmpAbs) fs.rmSync(marker.tmpAbs, { force: true });
          if (marker?.doneAbs) fs.rmSync(marker.doneAbs, { force: true });
        } catch {
          // ignore
        }
      }

      const prompt = buildPrompt({ run, turnNonce, marker, retryReason: attempt > 1 ? lastReason : null, attempt });
      const turnStep = attempt === 1 ? step : `${step}_retry${attempt - 1}`;

      // Some models can write the required files + marker and still keep "thinking" for a long time.
      // To keep the pipeline responsive, we treat the marker+postconditions as the success trigger and
      // interrupt the turn once it's satisfied.
      // Important: `_runTurn()` can reject (timeouts, pause/stop, transport errors). To prevent unhandled
      // rejections when we stop awaiting the completion after marker success, wrap it into a safe promise.
      const rawTurnPromise = this._runTurn({ runId, role, step: turnStep, threadId, model, prompt });
      const turnPromise = rawTurnPromise.catch((e) => ({ turnStatus: "failed", errorMessage: safeErrorMessage(e) || "turn failed" }));

      let stopMarkerPolling = false;
      const markerPromise = (async () => {
        const start = Date.now();
        while (Date.now() - start < TURN_MARKER_TIMEOUT_MS) {
          if (stopMarkerPolling) return { ok: false, reason: "marker polling aborted" };
          if (this._stopRequested.has(runId)) return { ok: false, reason: "Run stopped" };
          if (fileExists(marker.doneAbs)) {
            await this._syncFromProjectState(runId);
            const after = this._getRunRequired(runId);
            const markerCheck = this._verifyTurnMarker({ run: after, marker });
            if (!markerCheck.ok) return { ok: false, reason: markerCheck.reason };
            const post = await verifyPostconditions({ run: after, marker });
            if (post?.ok) return { ok: true };
          }
          await sleep(600);
        }
        return { ok: false, reason: "marker/postconditions not reached before timeout" };
      })();

      const first = await Promise.race([
        turnPromise.then((r) => ({ kind: "turn", r })),
        markerPromise.then((r) => ({ kind: "marker", r })),
      ]);
      stopMarkerPolling = true;

      // If the marker+postconditions are satisfied, we treat that as the success condition for this logical turn.
      // The Codex completion event can be delayed or never arrive after an interrupt; waiting for it can leave
      // `_active` stuck and block Corrector/Continue with "Another turn is already running".
      //
      // We still give the turn a short grace period to complete naturally. If it doesn't, we force-unblock the
      // local promise and proceed (marker+postconditions already proved the required side effects).
      if (first.kind === "marker" && first.r?.ok) {
        // Interrupt the running turn to force a quick completion signal from codex.
        try {
          const active = this._active;
          if (active && active.runId === runId && active.threadId && active.turnId) {
            await this._codex.turnInterrupt({ threadId: active.threadId, turnId: active.turnId });
          }
        } catch {
          // best-effort
        }

        // Best-effort: wait briefly for the completion signal; do not fail the pipeline if it doesn't arrive.
        try {
          const grace = await withTimeout(turnPromise, 5_000, "post-marker completion grace expired");
          if (grace && grace.turnStatus === "failed") return { ok: false, failed: true, errorMessage: grace.errorMessage || "turn failed" };
        } catch {
          // Ignore and force-unblock below.
        }

        // If the turn is still active, force-unblock the in-flight promise to avoid wedging the whole pipeline.
        try {
          const active = this._active;
          if (active && active.runId === runId) {
            // This triggers `_runTurn` cleanup (clears `_active`, activeTurn, intervals).
            active.lastErrorMessage = active.lastErrorMessage || "Turn completion detached after marker";
            active._reject?.(new Error(active.lastErrorMessage));
            this.emit("event", {
              runId,
              event: "diag",
              data: { role: "system", type: "warning", message: "Turn completion did not arrive after marker; detaching and proceeding (marker+postconditions satisfied)." },
            });
            try {
              this._appendRunTimeline(runId, { type: "turn_detached_after_marker", role, step: turnStep });
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      } else {
        // Normal path: wait for the turn completion (no marker success observed).
        const result = await turnPromise;
        if (result.turnStatus === "failed") return { ok: false, failed: true, errorMessage: result.errorMessage || "turn failed" };
      }

      await this._syncFromProjectState(runId);
      const after = this._getRunRequired(runId);

      const markerCheck = this._verifyTurnMarker({ run: after, marker });
      if (!markerCheck.ok) {
        // If the required postconditions are satisfied, a missing marker is usually an agent oversight.
        // For robustness (and to avoid burning tokens on retries), we can auto-heal by writing the marker.
        try {
          const postMaybe = await verifyPostconditions({ run: after, marker });
          if (postMaybe?.ok) {
            try {
              ensureDir(path.dirname(marker.doneAbs));
              fs.writeFileSync(marker.doneAbs, "ok\n", "utf8");
              appendRecoveryLog(after, { role: "system", step: "handshake", status: "auto_marker_written", marker: marker.doneRel });
              return { ok: true, turnNonce };
            } catch {
              // fall through to retry
            }
          }
        } catch {
          // ignore
        }
        lastReason = markerCheck.reason;
        continue;
      }

      const post = await verifyPostconditions({ run: after, marker });
      if (post?.ok) return { ok: true, turnNonce };
      lastReason = post?.reason || "Postconditions not met";
    }

    return { ok: false, failed: false, errorMessage: lastReason || "Postconditions not met" };
  }

  _shouldPreserveTerminalRunState(runId) {
    try {
      const run = this._getRunRequired(runId);
      const status = typeof run.status === "string" ? String(run.status).trim().toLowerCase() : "";
      return this._stopRequested.has(runId) || status === "stopped" || status === "paused" || status === "canceled";
    } catch {
      return this._stopRequested.has(runId);
    }
  }

  _emitRun(run) {
    this.emit("event", {
      runId: run.runId,
      event: "run",
      data: {
        // Riche snapshot pour éviter que l'UI affiche "undefined" sur les events SSE `run`.
        runId: run.runId,
        status: run.status,
        iteration: run.iteration,
        projectPhase: run.projectPhase || null,
        currentTaskId: run.currentTaskId || null,
        assignedDeveloper: run.assignedDeveloper || null,
        developerStatus: run.developerStatus,
        managerDecision: run.managerDecision,
        cwd: run.cwd,
        workspaceCwd: run.workspaceCwd || null,
        managerModel: run.managerModel,
        developerModel: run.developerModel,
        managerThreadId: run.managerThreadId || null,
        developerThreadId: run.developerThreadId || null,
        activeTurn: run.activeTurn || null,
        lastSummary: run.lastSummary || null,
        lastJobId: run.lastJobId || null,
        activeJob:
          run.activeJob && typeof run.activeJob === "object"
            ? {
                jobId: run.activeJob.jobId || null,
                taskId: run.activeJob.taskId || null,
                status: run.activeJob.status || null,
                pid: run.activeJob.pid ?? null,
                pidAlive:
                  Object.prototype.hasOwnProperty.call(run.activeJob, "pidAlive") ? run.activeJob.pidAlive : null,
                startedAt: run.activeJob.startedAt || null,
                stoppedAt: run.activeJob.stoppedAt || null,
                updatedAt: run.activeJob.updatedAt || null,
                lastMonitorAtIso: run.activeJob.lastMonitorAtIso || null,
                lastMonitorDecision: run.activeJob.lastMonitorDecision || null,
                lastMonitorStatus: run.activeJob.lastMonitorStatus || null,
                lastMonitorSummary: run.activeJob.lastMonitorSummary || null,
                latestMonitorMdRel: run.activeJob.latestMonitorMdRel || null,
                stdoutRel: run.activeJob.stdoutRel || null,
                stderrRel: run.activeJob.stderrRel || null,
                heartbeatRel: run.activeJob.heartbeatRel || null,
                progressRel: run.activeJob.progressRel || null,
                resultRel: run.activeJob.resultRel || null,
              }
            : null,
        projectPipelineState: {
          fileMtimeIso: run.projectPipelineStateFileMtimeIso || null,
          fileMtimeMs: typeof run.projectPipelineStateFileMtimeMs === "number" ? run.projectPipelineStateFileMtimeMs : null,
          fileSize: typeof run.projectPipelineStateFileSize === "number" ? run.projectPipelineStateFileSize : null,
          agentUpdatedAt: run.projectPipelineStateAgentUpdatedAt || null,
          agentUpdatedAtMs:
            typeof run.projectPipelineStateAgentUpdatedAtMs === "number" ? run.projectPipelineStateAgentUpdatedAtMs : null,
          agentUpdatedAtSkewMs:
            typeof run.projectPipelineStateAgentUpdatedAtSkewMs === "number" ? run.projectPipelineStateAgentUpdatedAtSkewMs : null,
        },
        updatedAt: run.updatedAt,
        lastError: run.lastError || null,
      },
    });
  }

  _setRun(runId, run) {
    run.updatedAt = nowIso();
    this._state.setRun(runId, run);
    this._touchRunningLock(runId);
    // Safety net: if the locked run becomes terminal, release the lock.
    if (this._runningRunId === runId && this._isTerminalStatus(run.status) && !this._isRunActivelyProcessing(run)) {
      this._releaseRunningLock(runId);
    }
    this._emitRun(run);
    this._traceRunState(runId, run);
    this._maybeWriteRunSummary(runId, run);
  }

  _runTraceDir(runId) {
    const safe = String(runId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this._dataDir, "runs", safe);
  }

  _runTimelinePath(runId) {
    return path.join(this._runTraceDir(runId), "timeline.jsonl");
  }

  _runSummaryPath(runId) {
    return path.join(this._runTraceDir(runId), "summary.md");
  }

  _runRestartsPath(runId) {
    return path.join(this._runTraceDir(runId), "restarts.jsonl");
  }

  _appendRunTimeline(runId, entry) {
    const payload = { ts: nowIso(), runId, ...(entry || {}) };
    appendJsonlLine(this._runTimelinePath(runId), payload);
  }

  _traceRunState(runId, run) {
    try {
      if (!runId || !run) return;

      const prev = this._runTraceSnapshots.get(runId) || null;
      const cur = {
        status: run.status || null,
        iteration: typeof run.iteration === "number" ? run.iteration : null,
        projectPhase: run.projectPhase || null,
        currentTaskId: run.currentTaskId || null,
        assignedDeveloper: run.assignedDeveloper || null,
        developerStatus: run.developerStatus || null,
        managerDecision: run.managerDecision || null,
        activeTurn: run.activeTurn
          ? {
              role: run.activeTurn.role || null,
              step: run.activeTurn.step || null,
              threadId: run.activeTurn.threadId || null,
              turnId: run.activeTurn.turnId || null,
            }
          : null,
        lastError: run.lastError?.message ? String(run.lastError.message) : null,
        lastErrorWhere: run.lastError?.where ? String(run.lastError.where) : null,
      };

      if (!prev) {
        this._runTraceSnapshots.set(runId, cur);
        this._appendRunTimeline(runId, { type: "run_start", state: cur, cwd: run.cwd || null });
        return;
      }

      const changes = {};
      for (const k of Object.keys(cur)) {
        const a = JSON.stringify(prev[k]);
        const b = JSON.stringify(cur[k]);
        if (a !== b) changes[k] = { from: prev[k], to: cur[k] };
      }
      if (!Object.keys(changes).length) return;

      this._runTraceSnapshots.set(runId, cur);
      this._appendRunTimeline(runId, { type: "state_change", changes });
    } catch {
      // ignore
    }
  }

  _maybeWriteRunSummary(runId, run) {
    try {
      if (!runId || !run) return;

      const now = Date.now();
      const last = this._runSummaryThrottle.get(runId) || 0;
      if (now - last < 2_000) return;
      this._runSummaryThrottle.set(runId, now);

      const incidentsDir = path.join(this._dataDir, "incidents");
      const incidentFiles = fs.existsSync(incidentsDir)
        ? fs
            .readdirSync(incidentsDir)
            .filter((f) => f.includes(`-${runId}-`) && f.startsWith("INC-") && f.endsWith(".json") && !f.includes("_result"))
            .sort()
        : [];

      const incRows = [];
      for (const f of incidentFiles.slice(-20)) {
        const p = path.join(incidentsDir, f);
        const rp = p.replace(/(\.json)$/i, "_result.json");
        let status = null;
        if (fs.existsSync(rp)) {
          try {
            const j = JSON.parse(fs.readFileSync(rp, "utf8"));
            status = j?.fix_status || null;
          } catch {
            status = "unknown";
          }
        }
        incRows.push({ file: f, fix_status: status || "pending" });
      }

      const sig = JSON.stringify({
        status: run.status,
        iteration: run.iteration,
        projectPhase: run.projectPhase || null,
        currentTaskId: run.currentTaskId || null,
        assignedDeveloper: run.assignedDeveloper || null,
        developerStatus: run.developerStatus || null,
        managerDecision: run.managerDecision || null,
        lastError: run.lastError?.message || null,
        correctorTotalCount: run.correctorTotalCount || 0,
        incidentCount: incidentFiles.length,
        lastIncident: incRows.length ? incRows[incRows.length - 1] : null,
      });
      if (this._runSummarySig.get(runId) === sig) return;
      this._runSummarySig.set(runId, sig);

      const rel = (p) => {
        try {
          return path.relative(this._dataDir, p).replace(/\\/g, "/");
        } catch {
          return String(p);
        }
      };

      const timelinePath = this._runTimelinePath(runId);
      const restartsPath = this._runRestartsPath(runId);
      const summaryPath = this._runSummaryPath(runId);
      const timelineMtime = safeStatMtimeMs(timelinePath);
      const restartsMtime = safeStatMtimeMs(restartsPath);

      const lines = [];
      lines.push(`# Run summary — ${runId}`);
      lines.push("");
      lines.push(`- project_cwd: ${run.cwd || "(unknown)"}`);
      if (run.workspaceCwd) lines.push(`- workspace_cwd: ${run.workspaceCwd}`);
      lines.push(`- status: ${run.status || "(unknown)"}`);
      lines.push(`- iteration: ${typeof run.iteration === "number" ? run.iteration : "(unknown)"}`);
      if (run.projectPhase) lines.push(`- phase: ${run.projectPhase}`);
      if (run.currentTaskId) lines.push(`- current_task_id: ${run.currentTaskId}`);
      if (run.assignedDeveloper) lines.push(`- assigned_developer: ${run.assignedDeveloper}`);
      if (run.developerStatus) lines.push(`- developer_status: ${run.developerStatus}`);
      if (run.managerDecision) lines.push(`- manager_decision: ${run.managerDecision}`);
      if (run.lastError?.message) lines.push(`- last_error: ${run.lastError.message}`);
      lines.push("");

      lines.push("## Corrector");
      lines.push(`- enabled: ${run.enableCorrector === false ? "NO" : "YES"}`);
      lines.push(`- total_fixes: ${run.correctorTotalCount || 0}`);
      lines.push(`- per_signature: ${run.correctorIncidentCounts ? Object.keys(run.correctorIncidentCounts).length : 0}`);
      if (run.correctorThreadId) lines.push(`- corrector_thread_id: ${run.correctorThreadId}`);
      lines.push("");

      lines.push("## Artifacts");
      lines.push(`- timeline: ${rel(timelinePath)}${timelineMtime ? ` (mtimeMs=${Math.floor(timelineMtime)})` : ""}`);
      lines.push(`- restarts: ${rel(restartsPath)}${restartsMtime ? ` (mtimeMs=${Math.floor(restartsMtime)})` : ""}`);
      lines.push(`- incidents_dir: ${rel(incidentsDir)} (matching: *-${runId}-*)`);
      lines.push("");

      if (incRows.length) {
        lines.push("## Recent incidents");
        for (const r of incRows) lines.push(`- ${r.file} — fix_status=${r.fix_status}`);
        lines.push("");
      }

      lines.push("## Logs (per turn)");
      if (Array.isArray(run.logFiles) && run.logFiles.length) {
        for (const lf of run.logFiles.slice(-20)) {
          const step = lf?.step ? String(lf.step) : "?";
          const role = lf?.role ? String(lf.role) : "?";
          const a = lf?.assistantLogPath ? rel(String(lf.assistantLogPath)) : null;
          const r = lf?.rpcLogPath ? rel(String(lf.rpcLogPath)) : null;
          lines.push(`- ${role}/${step}${a ? ` — assistant: ${a}` : ""}${r ? ` — rpc: ${r}` : ""}`);
        }
      } else {
        lines.push("- (no logFiles recorded)");
      }
      lines.push("");

      ensureDir(path.dirname(summaryPath));
      fs.writeFileSync(summaryPath, `${lines.join("\n")}\n`, { encoding: "utf8" });
    } catch {
      // ignore
    }
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

  getLockInfo() {
    const runId = this._runningRunId || null;
    const run = runId ? this._state.getRun(runId) : null;
    return {
      runningRunId: runId,
      runningRun: run
        ? {
          runId: run.runId,
          status: run.status,
          projectPhase: run.projectPhase || null,
          currentTaskId: run.currentTaskId || null,
          assignedDeveloper: run.assignedDeveloper || null,
          updatedAt: run.updatedAt || null,
          lastError: run.lastError || null,
          activeTurn: run.activeTurn || null,
        }
        : null,
      lockMeta:
        this._runningLockMeta && this._runningLockMeta.runId === runId
          ? {
            acquiredAtMs: this._runningLockMeta.acquiredAtMs,
            lastTouchedAtMs: this._runningLockMeta.lastTouchedAtMs,
            ageMs: Date.now() - this._runningLockMeta.acquiredAtMs,
            idleMs: Date.now() - this._runningLockMeta.lastTouchedAtMs,
          }
          : null,
      active: this._active
        ? {
          runId: this._active.runId,
          role: this._active.role,
          step: this._active.step,
          threadId: this._active.threadId,
          turnId: this._active.turnId,
          startedAtMs: this._active.startedAtMs,
          assistantLogPath: this._active.assistantLogPath,
          rpcLogPath: this._active.rpcLogPath,
        }
        : null,
    };
  }

  // Test-only helper to deterministically trigger the Corrector path.
  // Exposed via a guarded HTTP endpoint in server/index.js when ANTIDEX_TEST_MODE=1.
  forceTestIncident({ runId, where, message } = {}) {
    if (process.env.ANTIDEX_TEST_MODE !== "1") {
      throw new Error("forceTestIncident is only available when ANTIDEX_TEST_MODE=1");
    }
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    const run = this._getRunRequired(id);

    run.status = "failed";
    run.developerStatus = "blocked";
    run.managerDecision = null;
    run.lastError = {
      message: String(message || "synthetic incident (test)") || "synthetic incident (test)",
      at: nowIso(),
      where: String(where || "guardrail/review_loop") || "guardrail/review_loop",
    };
    run.activeTurn = null;
    this._setRun(id, run);
    return run;
  }

  forceUnlock() {
    const runId = this._runningRunId;
    if (!runId) return { unlocked: false, reason: "not_locked" };
    if (this._active && this._active.runId === runId) {
      throw new Error("Cannot unlock while a turn is active");
    }

    try {
      const run = this._state.getRun(runId);
      if (run && run.status !== "completed" && run.status !== "failed" && run.status !== "stopped") {
        run.status = "stopped";
        run.lastError = run.lastError || { message: "Force-unlocked by user", at: nowIso(), where: "force_unlock" };
        this._setRun(runId, run);
      }
    } catch {
      // best-effort
    }

    this._stopRequested.add(runId);
    this._releaseRunningLock(runId);
    return { unlocked: true, runId };
  }

  async startPipeline(opts) {
    const codexExe = opts?.codexExe ? String(opts.codexExe).trim() : null;
    await this._ensureCodex({ codexExe });

    const workspaceCwd = String(opts?.cwd || "").trim();
    const userPrompt = String(opts?.userPrompt || "");
    const managerModel = String(opts?.managerModel || "").trim();
    const developerModel = String(opts?.developerModel || "").trim();
    const managerPreprompt = String(opts?.managerPreprompt || "");
    const developerPreprompt = opts?.developerPreprompt ? String(opts.developerPreprompt) : null;
    const connectorBaseUrl = opts?.connectorBaseUrl ? String(opts.connectorBaseUrl) : null;
    const connectorNotify = opts?.connectorNotify === true ? true : false;
    const connectorDebug = opts?.connectorDebug === true ? true : false;
    const enableCorrector = opts?.enableCorrector !== false;
    const autoRun = opts?.autoRun !== false;
    const threadPolicy = normalizeThreadPolicy(opts?.threadPolicy);
    const useChatGPT = opts?.useChatGPT === true ? true : false;
    const useGitHub = opts?.useGitHub === true ? true : false;
    const useLovable = opts?.useLovable === true ? true : false;
    const agCodexRatioDefault = opts?.agCodexRatioDefault !== false;
    const agCodexRatio = normalizeAgCodexRatio(opts?.agCodexRatio ? String(opts.agCodexRatio) : "");
    // Backward-compatible default: false (treat cwd as the project root).
    const createProjectDir = opts?.createProjectDir === true ? true : false;
    const projectDirNameOpt = opts?.projectDirName ? String(opts.projectDirName) : null;

    if (!workspaceCwd) throw new Error("cwd is required");
    if (!userPrompt.trim()) throw new Error("userPrompt is required");
    if (!managerModel) throw new Error("managerModel is required");
    if (!developerModel) throw new Error("developerModel is required");
    if (!managerPreprompt.trim()) throw new Error("managerPreprompt is required");

    const estimatedLength = userPrompt.length + managerPreprompt.length;
    const MAX_PROMPT_LENGTH = 500_000; // ~500k chars safety limit
    if (estimatedLength > MAX_PROMPT_LENGTH) {
      throw new Error(`Combined prompt length (${estimatedLength}) exceeds safety limit (${MAX_PROMPT_LENGTH})`);
    }

    if (this._runningRunId) {
      this._maybeAutoClearStaleLock();
    }
    if (this._runningRunId) {
      const lockRun = this._state.getRun(this._runningRunId);
      const status = lockRun?.status ? ` status=${lockRun.status}` : "";
      const phase = lockRun?.projectPhase ? ` phase=${lockRun.projectPhase}` : "";
      const task = lockRun?.currentTaskId ? ` task=${lockRun.currentTaskId}` : "";
      throw new Error(`Another pipeline is already running (runId=${this._runningRunId}${status}${phase}${task}). Use Stop or Force unlock.`);
    }

    const runId = this._newRunId();

    // Create a minimal run early so we can log/select a project directory if needed.
    const earlyRun = {
      runId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "planning",
      iteration: 0,
      cwd: workspaceCwd,
      workspaceCwd: createProjectDir ? workspaceCwd : null,
      managerModel,
      developerModel,
      managerPreprompt,
      developerPreprompt,
      userPrompt,
      threadPolicy,
      connectorBaseUrl: connectorBaseUrl ? String(connectorBaseUrl).trim() : null,
      connectorNotify,
      connectorDebug,
      enableCorrector,
      useChatGPT,
      useGitHub,
      useLovable,
      agCodexRatioDefault,
      agCodexRatio,
      agConversationStarted: false,
      managerThreadId: null,
      developerThreadId: null,
      developerThreadTaskId: null,
      managerRolloutPath: null,
      developerRolloutPath: null,
      logFiles: [],
      developerStatus: "idle",
      managerDecision: null,
      agConversationStarted: false,
      // project paths filled after bootstrap
      projectDocRulesPath: null,
      projectDocIndexPath: null,
      projectAgentsDir: null,
      projectManagerInstructionPath: null,
      projectDeveloperInstructionPath: null,
      projectDeveloperAgInstructionPath: null,
      projectAgCursorRulesPath: null,
      projectSpecPath: null,
      projectTodoPath: null,
      projectTestingPlanPath: null,
      projectDecisionsPath: null,
      projectGitWorkflowPath: null,
      projectTasksDir: null,
      projectTurnMarkersDir: null,
      projectMailboxDir: null,
      projectPipelineStatePath: null,
      projectRecoveryLogPath: null,
      currentTaskId: null,
      assignedDeveloper: null,
      lastError: null,
      activeTurn: null,
    };
    earlyRun.agQuotaFilePath = path.join(this._dataDir, "AG_current_quota", "current_quota.json");

    this._state.setRun(runId, earlyRun);
    this._emitRun(earlyRun);

    let cwd = workspaceCwd;
    let selectedProjectDir = null;
    if (createProjectDir) {
      const selectionPath = path.join(this._dataDir, "project_selections", `${runId}.json`);
      ensureDir(path.dirname(selectionPath));
      try {
        if (fs.existsSync(selectionPath)) fs.unlinkSync(selectionPath);
      } catch {
        // ignore
      }

      const chosenRaw = projectDirNameOpt && projectDirNameOpt.trim() ? projectDirNameOpt.trim() : null;
      if (chosenRaw) {
        selectedProjectDir = slugifyDirName(chosenRaw);
      } else {
        // Ask the manager to pick a project folder name (written to a file in the orchestrator data dir).
        const threadResp = await this._codex.threadStart({
          cwd: workspaceCwd,
          sandbox: DEFAULT_SANDBOX,
          approvalPolicy: DEFAULT_APPROVAL_POLICY,
          model: managerModel,
        });
        const threadId = String(threadResp?.thread?.id ?? threadResp?.threadId ?? "");
        if (!threadId) throw new Error("thread/start did not return thread.id");

        const prompt = [
          "READ FIRST (role: manager)",
          "Goal: choose a NEW project folder name under the selected workspace.",
          `Workspace (absolute): ${workspaceCwd}`,
          "",
          "Rules:",
          "- Do NOT create/modify any files under the workspace in this step.",
          "- Write exactly ONE JSON file at the ABSOLUTE path below.",
          "- The folder name must be short, meaningful, and safe for Windows paths.",
          "- Prefer lowercase + hyphens, no spaces.",
          "",
          `Write JSON (ABSOLUTE): ${selectionPath}`,
          'Schema: { "project_dir": "<name>", "rationale": "<short>" }',
          "",
          "User request:",
          userPrompt,
          "",
          "IMPORTANT: After the JSON file is written, stop. No narration.",
        ].join("\n");

        const turnPromise = this._runTurn({ runId, role: "manager", step: "select_project_dir", threadId, model: managerModel, prompt });
        const filePromise = (async () => {
          const start = Date.now();
          while (Date.now() - start < 90_000) {
            try {
              if (fs.existsSync(selectionPath)) {
                const raw = fs.readFileSync(selectionPath, "utf8");
                const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
                const json = JSON.parse(cleaned);
                const dir = typeof json?.project_dir === "string" ? json.project_dir.trim() : "";
                if (dir) return dir;
              }
            } catch {
              // ignore
            }
            await sleep(400);
          }
          return null;
        })();

        const first = await Promise.race([turnPromise.then((r) => ({ kind: "turn", r })), filePromise.then((d) => ({ kind: "file", d }))]);
        if (first.kind === "file" && first.d) {
          try {
            const active = this._active;
            if (active && active.runId === runId && active.threadId && active.turnId) {
              await this._codex.turnInterrupt({ threadId: active.threadId, turnId: active.turnId });
            }
          } catch {
            // best-effort
          }
          await withTimeout(turnPromise, 30_000, "select_project_dir completion timed out after file");
          selectedProjectDir = slugifyDirName(first.d);
        } else {
          const completed = first.r;
          if (completed?.turnStatus === "failed") {
            selectedProjectDir = pickDefaultProjectNameFromPrompt(userPrompt);
           } else {
             // Turn completed but file missing or invalid -> fallback.
             selectedProjectDir = pickDefaultProjectNameFromPrompt(userPrompt);
           }
        }
      }

      // Create the project folder under the workspace.
      let candidate = path.join(workspaceCwd, selectedProjectDir || "project");
      if (fs.existsSync(candidate) && !isDirEmpty(candidate)) {
        candidate = path.join(workspaceCwd, `${selectedProjectDir || "project"}-${nowIsoForFile().slice(0, 19)}`);
      }
      ensureDir(candidate);
      cwd = candidate;
    }

    const bootstrap = ensureProjectDocs({ cwd, runId, threadPolicy });
    const {
      docDir: projectDocDir,
      dataDir: projectDataDir,
      agentsDir,
      tasksDir,
      turnMarkersDir,
      projectRulesPath,
      projectIndexPath,
      gitWorkflowPath,
      pipelineStatePath,
      recoveryLogPath,
      manifestPath,
    } = bootstrap;
    const run = {
      ...earlyRun,
      status: "planning", // planning | implementing | reviewing | completed | failed | stopped
      iteration: 0,
      cwd,
      workspaceCwd: createProjectDir ? workspaceCwd : null,
      projectManifestPath: manifestPath || path.join(cwd, "data", "antidex", "manifest.json"),
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
      projectJobsDir: path.join(projectDataDir, "jobs"),
      projectUserCommandsDir: bootstrap.userCommandsDir || path.join(projectDataDir, "user_commands"),
      projectPipelineStatePath: pipelineStatePath,
      projectRecoveryLogPath: recoveryLogPath,
      currentTaskId: null,
      assignedDeveloper: null,
      activeJobId: null,
      activeJob: null,
      pendingUserCommand: null,
      queuedUserCommand: null,
      userCommandHistory: [],
      todoProcessedMtimeMs: null,
      projectTodoFileMtimeMs: null,
      lastReconciledTodoFingerprint: null,
      // Watchdog / recovery state (persisted in orchestrator state store)
      agRetryCounts: {},
      agForceNewThreadNextByTask: {},
      agReloadCounts: {},
      taskDispatchCounts: {},
      taskReviewCounts: {},
      lastError: null,
      monitorThreadId: null,
      monitorRolloutPath: null,
    };

    // Project-level AG thread rule:
    // - 1st dispatch to AG for a project MUST open a new conversation.
    // - For the same project, reuse that conversation by default; only reset if the Manager requests it (new_per_task) or AG behaves oddly.
    // We persist the "already started" flag in the project's Antidex manifest so restarts don't re-open a new conversation every time.
    run.agConversationStarted = readManifestAgConversationStarted(run.projectManifestPath);

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

    this._stopRequested.delete(runId);

    if (autoRun) {
      this._acquireRunningLock(runId);
      void this.runAuto(runId).catch((e) => {
        const latest = this._state.getRun(runId);
        if (!latest) return;
        latest.status = "failed";
        latest.lastError = { message: safeErrorMessage(e), at: nowIso(), where: "auto" };
        this._setRun(runId, latest);
        this._releaseRunningLock(runId);
      });
    }

    return run;
  }

  async stopPipeline(runId) {
    const run = this._getRunRequired(runId);
    run.status = "stopped";
    run.lastError = run.lastError || { message: "Stopped by user", at: nowIso(), where: "stop" };
    this._setRun(runId, run);
    try {
      await this._syncFromProjectState(runId);
    } catch {
      // best-effort
    }
    // Crash recovery / continue advanced: keep a fresh resume packet on disk for later Continue (optionally new session).
    this._writeResumePacket(this._getRunRequired(runId), { reason: "stop" });

    this._stopRequested.add(runId);
    if (this._active && this._active.runId === runId) {
      try {
        if (this._active.threadId && this._active.turnId) {
          await this._codex.turnInterrupt({ threadId: this._active.threadId, turnId: this._active.turnId });
        }
      } catch {
        // best-effort
      }

      // Robustness: sometimes an interrupt never yields a `turn/completed` notification.
      // In that case the pipeline can get stuck in "active turn" forever and burn tokens / block new runs.
      // After a short grace period, force-unblock the in-flight turn promise.
      try {
        const active = this._active;
        if (active && active.runId === runId) {
          setTimeout(() => {
            const still = this._active;
            if (!still || still !== active) return;
            try {
              clearTimeout(still._timeout);
            } catch {
              // ignore
            }
            try {
              still.lastErrorMessage = still.lastErrorMessage || "Run stopped";
              still._reject?.(new Error("Run stopped"));
            } catch {
              // ignore
            }
            this._active = null;
            this._codex.setLogPath(null);
            try {
              const r = this._state.getRun(runId);
              if (r && r.activeTurn) {
                r.activeTurn = null;
                this._setRun(runId, r);
              }
            } catch {
              // ignore
            }
          }, 5000).unref?.();
        }
      } catch {
        // ignore
      }
    }

    this._releaseRunningLock(runId);
  }

  async pausePipeline(runId) {
    const run = this._getRunRequired(runId);
    if (run.status === "canceled") throw new Error("Run is canceled; cannot pause");
    if (run.status === "completed") throw new Error("Run is completed; cannot pause");
    run.status = "paused";
    run.lastError = run.lastError || { message: "Paused by user", at: nowIso(), where: "pause" };
    // Crash recovery: even a paused run may be resumed in a new session if needed.
    this._writeResumePacket(run, { reason: "pause" });
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

      if (this._active && this._active.runId === runId) {
        setTimeout(() => {
          try {
            const still = this._active;
            if (!still || still.runId !== runId) return;
            still.lastErrorMessage = still.lastErrorMessage || "Run paused";
            still._reject?.(new Error("Run paused"));
            this._active = null;
            this._codex.setLogPath(null);
            try {
              const r = this._state.getRun(runId);
              if (r && r.activeTurn) {
                r.activeTurn = null;
                this._setRun(runId, r);
              }
            } catch {
              // ignore
            }
          } catch {
            // ignore
          }
        }, 5000).unref?.();
      }
    }

    this._releaseRunningLock(runId);
  }

  async resumePipeline(optsOrRunId) {
    const opts =
      optsOrRunId && typeof optsOrRunId === "object"
        ? optsOrRunId
        : {
          runId: optsOrRunId,
        };
    const runId = opts?.runId ? String(opts.runId) : null;
    if (!runId) throw new Error("Missing runId");

    const codexExe = opts?.codexExe ? String(opts.codexExe).trim() : null;
    const autoRun = opts?.autoRun === false ? false : true;

    await this._ensureCodex({ codexExe });
    if (this._runningRunId) this._maybeAutoClearStaleLock();
    if (this._runningRunId && this._runningRunId !== runId) throw new Error("Another pipeline is already running");

    const run = this._getRunRequired(runId);
    if (run.status !== "paused") throw new Error(`Run is not paused; cannot resume (status=${run.status})`);
    if (run.status === "canceled") throw new Error("Run is canceled; cannot resume");

    // Best-effort: if an earlier bug left the project pinned to a placeholder/missing task spec,
    // rebase to the first real undone TODO item before resuming.
    try {
      await this._syncFromProjectState(runId);
      await this._autoRebaseIfInvalidCurrentTask(runId, { reason: "resume" });
    } catch {
      // ignore
    }

    const after = this._getRunRequired(runId);
    after.status = after.developerStatus === "ready_for_review" ? "reviewing" : "implementing";
    after.lastError = null;
    this._setRun(runId, after);

    this._acquireRunningLock(runId);
    this._stopRequested.delete(runId);
    try {
      if (autoRun) {
        const snap = this._getRunRequired(runId);
        const started = this._startAutoRun(runId);
        if (started.started) {
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "info", message: "Auto-run started (resume)." },
          });
        }
        return snap;
      }

      await this._advanceOneStep(runId);
      return this._getRunRequired(runId);
    } finally {
      if (!autoRun) this._releaseRunningLock(runId);
    }
  }

  async cancelPipeline(runId) {
    const run = this._getRunRequired(runId);
    if (run.status === "canceled") return;
    run.status = "canceled";
    run.lastError = run.lastError || { message: "Canceled by user", at: nowIso(), where: "cancel" };
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
    this._releaseRunningLock(runId);
  }

  _writeResumePacket(run, { reason = "new_session" } = {}) {
    try {
      const baseDir = path.join(run.cwd, "data", "resume_packets", String(run.runId || "run"));
      ensureDir(baseDir);
      const relTodo = relPathForPrompt(run.cwd, run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
      const relSpec = relPathForPrompt(run.cwd, run.projectSpecPath || path.join(run.cwd, "doc", "SPEC.md"));
      const relTesting = relPathForPrompt(run.cwd, run.projectTestingPlanPath || path.join(run.cwd, "doc", "TESTING_PLAN.md"));
      const relDecisions = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
      const relState = relPathForPrompt(run.cwd, run.projectPipelineStatePath || path.join(run.cwd, "data", "pipeline_state.json"));

      const ts = nowIsoForFile();

      const latestIndexAbs = path.join(baseDir, "latest.md");
      const snapIndexAbs = path.join(baseDir, `resume_${ts}.md`);

      const latestManagerAbs = path.join(baseDir, "latest_manager.md");
      const snapManagerAbs = path.join(baseDir, `resume_${ts}_manager.md`);
      const latestDevAbs = path.join(baseDir, "latest_developer_codex.md");
      const snapDevAbs = path.join(baseDir, `resume_${ts}_developer_codex.md`);
      const latestAgAbs = path.join(baseDir, "latest_developer_antigravity.md");
      const snapAgAbs = path.join(baseDir, `resume_${ts}_developer_antigravity.md`);

      const { taskId, taskDir, taskDirRel } = taskContext(run);
      const taskPaths = (() => {
        if (!run.currentTaskId) return [];
        const candidates = [
          "task.md",
          "manager_instruction.md",
          "dev_ack.json",
          "dev_result.md",
          "dev_result.json",
          "manager_review.md",
          "long_job_history.md",
          "long_job_history.json",
          "latest_long_job_outcome.md",
          "latest_long_job_outcome.json",
          "questions",
          "answers",
        ];
        const out = [];
        for (const c of candidates) {
          const abs = path.join(taskDir, c);
          if (!fs.existsSync(abs)) continue;
          out.push(relPathForPrompt(run.cwd, abs));
        }
        return out;
      })();

      const projectStateSnippet = (() => {
        const r = readJsonBestEffort(run.projectPipelineStatePath || path.join(run.cwd, "data", "pipeline_state.json"));
        if (!r.ok) return `ERROR reading pipeline_state.json: ${r.error}`;
        if (!r.value) return "(missing)";
        try {
          return JSON.stringify(r.value, null, 2).slice(0, 6000);
        } catch {
          return String(r.value).slice(0, 6000);
        }
      })();

      const commonHeaderLines = [
        `- run_id: ${run.runId}`,
        `- reason: ${reason}`,
        `- generated_at: ${nowIso()}`,
        `- cwd: ${run.cwd}`,
        `- status: ${run.status || ""}`,
        `- phase: ${run.phase || ""}`,
        `- iteration: ${run.iteration ?? ""}`,
        ...(run.currentTaskId ? [`- current_task_id: ${run.currentTaskId}`] : []),
        ...(run.assignedDeveloper ? [`- assigned_developer: ${run.assignedDeveloper}`] : []),
        ...(run.developerStatus ? [`- developer_status: ${run.developerStatus}`] : []),
        ...(run.managerDecision ? [`- manager_decision: ${run.managerDecision}`] : []),
      ];

      const commonReadFirst = [
        "Read these files first:",
        `- ${relSpec}`,
        `- ${relTodo}`,
        `- ${relTesting}`,
        `- ${relDecisions}`,
        `- ${relState}`,
      ];
      const taskOutcomeRel = run.currentTaskId ? relPathForPrompt(run.cwd, path.join(taskDir, "latest_long_job_outcome.md")) : null;
      const taskHistoryRel = run.currentTaskId ? relPathForPrompt(run.cwd, path.join(taskDir, "long_job_history.md")) : null;
      const taskManagerInstructionRel = run.currentTaskId ? relPathForPrompt(run.cwd, path.join(taskDir, "manager_instruction.md")) : null;
      const taskManagerReviewRel = run.currentTaskId ? relPathForPrompt(run.cwd, path.join(taskDir, "manager_review.md")) : null;
      const reviewedEvidenceReuse = run.currentTaskId ? this._taskReviewedEvidenceReuseDirective(run, { taskDir }) : null;

      const commonContext = [];
      if (run.currentTaskId) {
        commonContext.push("Current task context:");
        commonContext.push(`- task_id: ${taskId}`);
        commonContext.push(`- task_dir: ${taskDirRel}`);
        if (taskPaths.length) {
          commonContext.push("Task files present:");
          for (const p of taskPaths) commonContext.push(`- ${p}`);
        }
        commonContext.push("");
      }

      const commonTail = [];
      if (run.lastSummary) {
        commonTail.push("Last summary:");
        commonTail.push("```");
        commonTail.push(String(run.lastSummary).slice(0, 8000));
        commonTail.push("```");
        commonTail.push("");
      }
      if (run.lastError?.message) {
        commonTail.push("Last error:");
        commonTail.push("```");
        commonTail.push(String(run.lastError.message).slice(0, 4000));
        commonTail.push("```");
        commonTail.push("");
      }
      commonTail.push("Project pipeline_state.json snapshot:");
      commonTail.push("```json");
      commonTail.push(projectStateSnippet);
      commonTail.push("```");
      commonTail.push("");
      commonTail.push("Goal: continue the pipeline safely from the current project state (do not re-do completed work).");
      commonTail.push("");

      const makeRolePacket = (role, roleNotes, extraReadFirst = []) =>
        [
          `# Antidex resume packet — ${role}`,
          "",
          ...commonHeaderLines,
          "",
          ...commonReadFirst,
          ...(extraReadFirst.length ? ["", "Then read these task files in order:", ...extraReadFirst.map((item) => `- ${item}`)] : []),
          "",
          "Role-specific notes:",
          ...roleNotes,
          "",
          ...commonContext,
          ...commonTail,
        ].join("\n");

      const managerNotes = [
        "- You are the Manager. Re-read TODO and ensure tasks + ordering + DoD are consistent.",
        "- If developer_status=ready_for_review: review the task and write manager_review.md, then dispatch next task.",
        "- If developer_status=blocked: answer Q/A and update pipeline_state.json accordingly.",
      ];
      const devNotes = [
        "- You are Developer Codex. Implement ONLY the assigned task (see data/tasks/<task>/task.md).",
        "- Write dev_ack.json, dev_result.*, update pipeline_state.json, then write turn marker.",
        "- If data/tasks/<task>/latest_long_job_outcome.md exists, it takes priority over older manager docs immediately after wake_developer.",
        "- Consume that terminal result in dev_result.md / pipeline_state.json before any new rerun.",
        "- Do not infer a new rerun from older answers/questions or old 2p diagnostics when the latest outcome says manager docs are stale; ask the manager instead.",
        ...(reviewedEvidenceReuse?.value === "yes"
          ? [
            `- Manager opt-in from ${reviewedEvidenceReuse.rel}: the artifact already reviewed may be reused as planning input for this step, even if it is older than manager_review.md.`,
            "- Freshness is still required before you return ready_for_review: make the requested change first, then regenerate the proof artifacts.",
          ]
          : []),
        ...(reviewedEvidenceReuse?.value === "no"
          ? [
            `- Manager opt-in from ${reviewedEvidenceReuse.rel}: reviewed evidence must NOT be reused for planning this step without asking again.`,
          ]
          : []),
      ];
      const agNotes = [
        "- You are Developer Antigravity. Follow the file protocol (ack/result/pointer/heartbeat/turn marker).",
        "- If you are in a browser-only period, keep heartbeat.json updated (stage + expected_silence_ms).",
      ];

      const payloadManager = makeRolePacket("manager", managerNotes);
      const payloadDev = makeRolePacket(
        "developer_codex",
        devNotes,
        [taskOutcomeRel, taskHistoryRel, taskManagerInstructionRel, taskManagerReviewRel].filter(Boolean)
      );
      const payloadAg = makeRolePacket("developer_antigravity", agNotes);

      writeTextAtomic(snapManagerAbs, payloadManager);
      writeTextAtomic(latestManagerAbs, payloadManager);
      writeTextAtomic(snapDevAbs, payloadDev);
      writeTextAtomic(latestDevAbs, payloadDev);
      writeTextAtomic(snapAgAbs, payloadAg);
      writeTextAtomic(latestAgAbs, payloadAg);

      const indexLines = [];
      indexLines.push("# Antidex resume packet — index");
      indexLines.push("");
      indexLines.push(...commonHeaderLines);
      indexLines.push("");
      indexLines.push("Role packets (read the one matching your role):");
      indexLines.push(`- manager: ${relPathForPrompt(run.cwd, latestManagerAbs)}`);
      indexLines.push(`- developer_codex: ${relPathForPrompt(run.cwd, latestDevAbs)}`);
      indexLines.push(`- developer_antigravity: ${relPathForPrompt(run.cwd, latestAgAbs)}`);
      indexLines.push("");
      indexLines.push(...commonReadFirst);
      indexLines.push("");
      indexLines.push("This index exists so the orchestrator can inject a stable path, but role packets contain the actionable notes.");
      indexLines.push("");
      const payloadIndex = indexLines.join("\n");
      writeTextAtomic(snapIndexAbs, payloadIndex);
      writeTextAtomic(latestIndexAbs, payloadIndex);

      run.projectResumePackets = {
        index: latestIndexAbs,
        manager: latestManagerAbs,
        developer_codex: latestDevAbs,
        developer_antigravity: latestAgAbs,
      };
      run.projectResumePacketPath = latestIndexAbs;
      run.projectResumePacketRel = relPathForPrompt(run.cwd, latestIndexAbs);
    } catch {
      // best-effort
    }
  }

  async continuePipeline(optsOrRunId) {
    const opts =
      optsOrRunId && typeof optsOrRunId === "object"
        ? optsOrRunId
        : {
          runId: optsOrRunId,
        };
    const runId = opts?.runId ? String(opts.runId) : null;
    if (!runId) throw new Error("Missing runId");

    // Extract optional codexExe, which is now provided by index.js start/continue API
    const codexExe = opts?.codexExe ? String(opts.codexExe).trim() : null;
    const autoRun = opts?.autoRun === false ? false : true;
    const maxSteps = (() => {
      const n = Number(opts?.maxSteps ?? 1);
      if (!Number.isFinite(n) || n <= 0) return 1;
      return Math.max(1, Math.min(10, Math.floor(n)));
    })();

    await this._ensureCodex({ codexExe });
    if (this._runningRunId) this._maybeAutoClearStaleLock();

    if (this._runningRunId && this._runningRunId !== runId) throw new Error("Another pipeline is already running");

    // If the orchestrator run state is missing (e.g. state file corrupted/reset), attempt recovery from the project cwd.
    if (!this._state.getRun(runId)) {
      const cwd = opts?.cwd ? String(opts.cwd).trim() : "";
      if (!cwd) throw new Error("run not found (provide cwd to recover)");
      await this._recoverRunFromProject({ runId, cwd, codexExe, ...opts });
    }

    // Allow manual recovery: users often want to Continue after fixing an orchestrator bug or a missing file,
    // or when they add new tasks to the TODO of a completed run.
    const before = this._getRunRequired(runId);
    if (before.status === "canceled") {
      throw new Error("Run is canceled; cannot continue.");
    }
    const wasStoppedOrFailed = before.status === "stopped" || before.status === "failed";

    if (this._isResumableStatus(before.status)) {
      await this._syncFromProjectState(runId);
      try {
        await this._autoRebaseIfInvalidCurrentTask(runId, { reason: "continue" });
      } catch {
        // ignore
      }
      const afterSync = this._getRunRequired(runId);
      if (afterSync.developerStatus === "waiting_job" || afterSync.status === "waiting_job") {
        this._recoverStaleWaitingJob(runId, { reason: "continue_no_live_job" });
      }
      const afterRecovery = this._getRunRequired(runId);
      if (afterRecovery.developerStatus === "failed") {
        throw new Error("Project pipeline_state.json indicates developer_status=failed; cannot continue without manual intervention.");
      }
      afterRecovery.lastError = null;

      // Operator intent: Stop/Continue usually means "I fixed the external issue" (e.g. AG connector / Antigravity).
      // Reset transient dispatch counters for the CURRENT task so the pipeline can re-dispatch without immediately
      // re-hitting guardrails like `dispatch_loop` or AG stall caps.
      //
      // Note: we reset only the current task, not the whole run history.
      if (wasStoppedOrFailed && opts?.resetCountersOnContinue !== false) {
        const taskId = afterRecovery.currentTaskId;
        if (taskId) {
          afterRecovery.agRetryCounts =
            afterRecovery.agRetryCounts && typeof afterRecovery.agRetryCounts === "object" ? afterRecovery.agRetryCounts : {};
          afterRecovery.agAckResendCounts =
            afterRecovery.agAckResendCounts && typeof afterRecovery.agAckResendCounts === "object" ? afterRecovery.agAckResendCounts : {};
          afterRecovery.agReloadCounts =
            afterRecovery.agReloadCounts && typeof afterRecovery.agReloadCounts === "object" ? afterRecovery.agReloadCounts : {};
          afterRecovery.taskDispatchCounts =
            afterRecovery.taskDispatchCounts && typeof afterRecovery.taskDispatchCounts === "object" ? afterRecovery.taskDispatchCounts : {};
          afterRecovery.agForceNewThreadNextByTask =
            afterRecovery.agForceNewThreadNextByTask && typeof afterRecovery.agForceNewThreadNextByTask === "object"
              ? afterRecovery.agForceNewThreadNextByTask
              : {};

          afterRecovery.agRetryCounts[taskId] = 0;
          afterRecovery.agAckResendCounts[taskId] = 0;
          afterRecovery.agReloadCounts[taskId] = 0;
          afterRecovery.taskDispatchCounts[taskId] = 0;

          if (afterRecovery.assignedDeveloper === "developer_antigravity") {
            // Make the retry more likely to succeed by forcing a fresh conversation once.
            afterRecovery.agForceNewThreadNextByTask[taskId] = true;
          }

          this.emit("event", {
            runId,
            event: "diag",
            data: {
              role: "system",
              type: "info",
              message: `Continue recovery: reset transient dispatch counters for ${taskId} (was ${before.status}).`,
            },
          });
          try {
            this._appendRunTimeline(runId, { type: "counters_reset_on_continue", taskId, prevStatus: before.status });
          } catch {
            // ignore
          }
        }
      }

      // Reset phase to planning if completed, so the Manager re-reads the new TODO.
      if (afterRecovery.status === "completed") {
        afterRecovery.phase = "planning";
        afterRecovery.iteration = (afterRecovery.iteration || 0) + 1;
        afterRecovery.developerStatus = "idle";
        afterRecovery.managerDecision = null;
      }
      if (afterRecovery.status === "paused") {
        afterRecovery.status = "implementing";
      }
      if (afterRecovery.developerStatus === "waiting_job") afterRecovery.status = "waiting_job";
      else afterRecovery.status = afterRecovery.developerStatus === "ready_for_review" ? "reviewing" : "implementing";
      // Only force a planning step when the PROJECT state is planning, or when we explicitly reset phase due to a completed run.
      if (afterRecovery.projectPhase === "planning") afterRecovery.status = "planning";
      if (before.status === "completed" && afterRecovery.phase === "planning") afterRecovery.status = "planning";
      this._setRun(runId, afterRecovery);
    }

    const curBefore = this._getRunRequired(runId);
    // Best-effort: ensure the project has the latest minimal Antidex layout helpers (idempotent, write-if-missing only).
    // This is especially important for legacy projects created before certain helpers existed (e.g. tools/antidex.* for long jobs).
    try {
      ensureProjectDocs({ cwd: curBefore.cwd, runId, threadPolicy: curBefore.threadPolicy });
    } catch {
      // ignore
    }
    // If doc/TODO.md changed on disk since the last orchestrator processing, treat it like "Continue with update".
    // This supports the user-editable TODO workflow even when the file is edited outside the UI.
    try {
      if (opts?.todoUpdated !== true) {
        const todoSnapshot = this._readTodoSnapshot(curBefore);
        if (typeof todoSnapshot.mtimeMs === "number") {
          curBefore.projectTodoFileMtimeMs = todoSnapshot.mtimeMs;
          if (curBefore.todoProcessedMtimeMs == null) curBefore.todoProcessedMtimeMs = todoSnapshot.mtimeMs;
          if (
            curBefore.todoProcessedMtimeMs != null &&
            todoSnapshot.mtimeMs > curBefore.todoProcessedMtimeMs &&
            todoSnapshot.fingerprint &&
            !sameTodoFingerprint(curBefore.lastReconciledTodoFingerprint, todoSnapshot.fingerprint)
          ) {
            opts.todoUpdated = true;
          } else if (
            curBefore.todoProcessedMtimeMs != null &&
            todoSnapshot.mtimeMs > curBefore.todoProcessedMtimeMs &&
            sameTodoFingerprint(curBefore.lastReconciledTodoFingerprint, todoSnapshot.fingerprint)
          ) {
            this._acknowledgeTodoSnapshot(curBefore, todoSnapshot, { reason: "mtime_changed_same_content" });
          }
          this._setRun(runId, curBefore);
        }
      }
    } catch {
      // ignore
    }
    if (opts?.newSession === true) {
      // Create a stable resume packet on disk so new threads can recontextualize via files.
      this._writeResumePacket(curBefore, { reason: "continue_new_session" });
      // Force new Codex threads for manager + developer (AG conversation is managed separately).
      curBefore.managerThreadId = null;
      curBefore.developerThreadId = null;
      curBefore.developerThreadTaskId = null;
      curBefore.managerRolloutPath = null;
      curBefore.developerRolloutPath = null;
      this._setRun(runId, curBefore);
    }
    if (opts?.threadPolicy && typeof opts.threadPolicy === "object") {
      curBefore.threadPolicy = normalizeThreadPolicy(opts.threadPolicy);
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.enableCorrector === "boolean") {
      curBefore.enableCorrector = opts.enableCorrector;
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.useChatGPT === "boolean") {
      curBefore.useChatGPT = opts.useChatGPT === true;
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.useGitHub === "boolean") {
      curBefore.useGitHub = opts.useGitHub === true;
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.useLovable === "boolean") {
      curBefore.useLovable = opts.useLovable === true;
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.agCodexRatioDefault === "boolean") {
      curBefore.agCodexRatioDefault = opts.agCodexRatioDefault !== false;
      this._setRun(runId, curBefore);
    }
    if (typeof opts?.agCodexRatio === "string") {
      curBefore.agCodexRatio = normalizeAgCodexRatio(opts.agCodexRatio);
      this._setRun(runId, curBefore);
    }

    // Robustness: if the server restarted mid-step, we may have a stale `activeTurn` persisted in the orchestrator state.
    // That would block `Continue` forever because we treat `activeTurn` as "run is actively processing".
    // If we are NOT currently locked on this run and there is no in-process activity, clear it.
    if (
      curBefore.activeTurn &&
      this._runningRunId !== runId &&
      !this._active &&
      !this._autoRunLoops.has(runId)
    ) {
      try {
        const snap = this._getRunRequired(runId);
        snap.activeTurn = null;
        this._setRun(runId, snap);
      } catch {
        // ignore
      }
    }

    const isActivelyProcessing = this._isRunActivelyProcessing(curBefore) || this._autoRunLoops.has(runId);
    if (autoRun && isActivelyProcessing) {
      // If a run is already processing (Codex turn or AG step), don't error.
      // Still allow queuing priority overrides (user command / TODO updated) so they are picked up by the next step.
      try {
        if (typeof opts?.userCommandMessage === "string" && String(opts.userCommandMessage).trim()) {
          const src = typeof opts?.userCommandSource === "string" ? String(opts.userCommandSource) : "ui_send";
          const cmd = this._queueUserCommand(runId, { source: src, message: String(opts.userCommandMessage) });
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "info", message: `User command queued (${cmd.id}) while run is active. It will be processed before further dispatch.` },
          });
        }
        if (opts?.todoUpdated === true) {
          const result = this._queueTodoUpdatedUserCommand(runId);
          if (result.queued) {
            this.emit("event", {
              runId,
              event: "diag",
              data: { role: "system", type: "info", message: `TODO updated while run is active -> queued user command ${result.cmd.id} for Manager reconcile.` },
            });
          } else if (result.skipped) {
            this.emit("event", {
              runId,
              event: "diag",
              data: { role: "system", type: "info", message: "TODO save+continue detected no new TODO content; skipped duplicate Manager reconcile." },
            });
          }
        }
      } catch {
        // best-effort: do not fail the request if override queuing fails
      }
      return this._getRunRequired(runId);
    }

    this._acquireRunningLock(runId);
    this._stopRequested.delete(runId);
    try {
      // User override: allow sending a priority message to the Manager during an existing run.
      if (typeof opts?.userCommandMessage === "string" && String(opts.userCommandMessage).trim()) {
        await this._syncFromProjectState(runId);
        const src = typeof opts?.userCommandSource === "string" ? String(opts.userCommandSource) : "ui_send";
        const cmd = this._queueUserCommand(runId, { source: src, message: String(opts.userCommandMessage) });
        this.emit("event", {
          runId,
          event: "diag",
          data: { role: "system", type: "info", message: `User command queued (${cmd.id}). Manager reconcile will run before continuing.` },
        });
      }
      // If the user edited doc/TODO.md via the UI ("Continue with update"), force a Manager resync step.
      // This prevents drift between doc/TODO.md (human) and data/pipeline_state.json + data/tasks/* (machine truth).
      if (opts?.todoUpdated === true) {
        await this._syncFromProjectState(runId);
        const result = this._queueTodoUpdatedUserCommand(runId);
        if (result.queued) {
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "info", message: `TODO updated -> queued user command ${result.cmd.id} for Manager reconcile.` },
          });
        } else if (result.skipped) {
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "info", message: "TODO save+continue detected no new TODO content; skipped duplicate Manager reconcile." },
          });
        }
      }

      // Default behavior: run to completion (or blocked) in the background.
      // One-step / maxSteps is still available for tests/debug via autoRun=false.
      if (autoRun) {
        const snap = this._getRunRequired(runId);
        const started = this._startAutoRun(runId);
        if (started.started) {
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "info", message: "Auto-run started (will continue until blocked|failed|completed|stopped)." },
          });
        }
        return snap;
      }

      for (let i = 0; i < maxSteps; i += 1) {
        try {
          const changed = await this._advanceOneStep(runId);
          const cur = this._getRunRequired(runId);

          if (cur.status === "failed" || (cur.status === "implementing" && cur.developerStatus === "blocked")) {
            const handled = await this._handleIncident(runId, "step stall/block");
            if (handled) break;
          }

          if (!changed) break;
          if (cur.status === "failed" || cur.status === "completed" || cur.status === "stopped") break;
          if (this._stopRequested.has(runId)) break;
        } catch (e) {
          const msg = safeErrorMessage(e);
          try {
            const r = this._getRunRequired(runId);
            r.status = "failed";
            const existingWhere = String(r.lastError?.where || "").trim();
            const where = existingWhere && existingWhere.startsWith("turn/") ? existingWhere : "auto";
            r.lastError = { message: msg, at: nowIso(), where };
            r.activeTurn = null;
            this._setRun(runId, r);
          } catch {
            // ignore
          }
          await this._handleIncident(runId, "manual-step exception");
          break;
        }
      }
      return this._getRunRequired(runId);
    } finally {
      // If we started an auto-run loop, it owns the running lock lifecycle.
      if (!autoRun) this._releaseRunningLock(runId);
    }
  }

  async _recoverRunFromProject({
    runId,
    cwd,
    managerModel,
    developerModel,
    managerPreprompt,
    developerPreprompt,
    connectorBaseUrl,
    connectorNotify,
    connectorDebug,
  }) {
    const absCwd = path.resolve(String(cwd || "").trim());
    if (!absCwd) throw new Error("cwd is required to recover run");
    if (!fs.existsSync(absCwd) || !fs.statSync(absCwd).isDirectory()) throw new Error(`cwd is not a directory: ${absCwd}`);

    // Validate run_id match (if present) and infer thread_policy.
    const projectPipelineStatePath = path.join(absCwd, "data", "pipeline_state.json");
    const ps = readJsonBestEffort(projectPipelineStatePath);
    let inferredPolicy = normalizeThreadPolicy(null);
    if (ps.ok && ps.value && typeof ps.value === "object") {
      const rid = typeof ps.value.run_id === "string" ? String(ps.value.run_id) : null;
      if (rid && rid !== runId) throw new Error(`runId mismatch: requested ${runId} but project pipeline_state.json has run_id=${rid}`);
      if (ps.value.thread_policy && typeof ps.value.thread_policy === "object") {
        inferredPolicy = normalizeThreadPolicy(ps.value.thread_policy);
      }
    }

    const bootstrap = ensureProjectDocs({ cwd: absCwd, runId, threadPolicy: inferredPolicy });
    const {
      docDir: projectDocDir,
      dataDir: projectDataDir,
      agentsDir,
      tasksDir,
      turnMarkersDir,
      projectRulesPath,
      projectIndexPath,
      gitWorkflowPath,
      pipelineStatePath,
      recoveryLogPath,
      manifestPath,
    } = bootstrap;

    const iso = nowIso();
    const run = {
      runId,
      createdAt: iso,
      updatedAt: iso,
      status: "implementing",
      iteration: 0,
      cwd: absCwd,
      workspaceCwd: null,
      managerModel: managerModel ? String(managerModel).trim() : "gpt-5.4",
      developerModel: developerModel ? String(developerModel).trim() : "gpt-5.4",
      managerPreprompt: managerPreprompt ? String(managerPreprompt) : "Tu es Manager. Suis agents/manager.md.",
      developerPreprompt: developerPreprompt ? String(developerPreprompt) : null,
      userPrompt: "(recovered run)",
      threadPolicy: inferredPolicy,
      connectorBaseUrl: connectorBaseUrl ? String(connectorBaseUrl).trim() : null,
      connectorNotify: connectorNotify === true,
      connectorDebug: connectorDebug === true,
      agConversationStarted: false,
      agRetryCounts: {},
      agForceNewThreadNextByTask: {},
      agReloadCounts: {},
      taskDispatchCounts: {},
      taskReviewCounts: {},
      managerThreadId: null,
      developerThreadId: null,
      developerThreadTaskId: null,
      managerRolloutPath: null,
      developerRolloutPath: null,
      logFiles: [],
      developerStatus: "idle",
      managerDecision: null,
      projectManifestPath: manifestPath || path.join(absCwd, "data", "antidex", "manifest.json"),
      projectDocRulesPath: projectRulesPath || path.join(projectDocDir, "DOCS_RULES.md"),
      projectDocIndexPath: projectIndexPath || path.join(projectDocDir, "INDEX.md"),
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
      projectJobsDir: path.join(projectDataDir, "jobs"),
      projectUserCommandsDir: bootstrap.userCommandsDir || path.join(projectDataDir, "user_commands"),
      projectPipelineStatePath: pipelineStatePath,
      projectRecoveryLogPath: recoveryLogPath,
      currentTaskId: null,
      assignedDeveloper: null,
      activeJobId: null,
      activeJob: null, // { jobId, status, jobDirRel, startedAt, pid, nextMonitorDueAt, lastMonitorAt, lastMonitorReportRel }
      pendingUserCommand: null,
      queuedUserCommand: null,
      userCommandHistory: [],
      todoProcessedMtimeMs: null,
      projectTodoFileMtimeMs: null,
      lastReconciledTodoFingerprint: null,
      lastError: null,
      activeTurn: null,
      monitorThreadId: null,
      monitorRolloutPath: null,
    };

    run.agConversationStarted = readManifestAgConversationStarted(run.projectManifestPath);
    this._state.setRun(runId, run);
    this._emitRun(run);
    await this._syncFromProjectState(runId);
  }

  async runAuto(runId) {
    await this._ensureCodex();
    if (!this._runningRunId) this._acquireRunningLock(runId);
    else this._touchRunningLock(runId);
    let safety = 0;
    while (safety++ < MAX_AUTO_STEPS) {
      const run = this._getRunRequired(runId);
      if (this._stopRequested.has(runId) || run.status === "stopped" || run.status === "paused" || run.status === "canceled") break;

      // If we start an auto-run loop with an already-failed/blocked run, we must still run incident handling.
      // Otherwise "Continue" would do nothing and the Corrector could never trigger.
      if (run.status === "failed" || (run.status === "implementing" && run.developerStatus === "blocked")) {
        const handled = await this._handleIncident(runId, "auto-run initial failed/blocked");
        if (handled) continue;
        if (run.status === "failed") break;
      }

      if (run.status === "completed") break;

      // Anti-loop guard: if the exact same state repeats many times, force a Manager intervention
      // instead of burning tokens in a tight loop.
      try {
        const sig = this._stepSignatureForLoopGuard(run);
        const g = this._autoRunLoopGuard.get(runId) || { sig: "", repeats: 0, incidents: 0 };
        if (sig && sig === g.sig) g.repeats += 1;
        else {
          g.sig = sig;
          g.repeats = 0;
        }
        // Trigger earlier to avoid long token-burning loops. (Spec: 4 repeats)
        if (g.repeats >= 4 && run.currentTaskId) {
          g.incidents += 1;
          g.repeats = 0;
          this._autoRunLoopGuard.set(runId, g);

          const { taskId, taskDir, taskDirRel } = taskContext(run);
          const qAbs = writeTaskQuestion({
            taskDir,
            prefix: "Q-loop",
            title: `Auto-run appears stuck on ${taskId}`,
            body: [
              "The orchestrator detected a likely infinite loop (same pipeline state repeating).",
              "",
              "Manager action required:",
              `- Inspect task: ${taskDirRel}/task.md + ${taskDirRel}/manager_instruction.md`,
              `- Inspect latest outputs: ${taskDirRel}/dev_result.* and/or data/antigravity_runs/*`,
              "- Decide how to proceed (fix instructions, split the task, switch developer, or ask a clarification).",
              "- You must change state: set developer_status=ongoing/ready_for_review OR set manager_decision=blocked/completed.",
              "",
              "Then write an answer in answers/A-*.md and update data/pipeline_state.json accordingly.",
              "",
              `Incident count: ${g.incidents}`,
            ].join("\n"),
          });
          const relQ = relPathForPrompt(run.cwd, qAbs);

          try {
            const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
            const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
            state.developer_status = "blocked";
            state.manager_decision = null;
            state.summary = `Orchestrator loop guard: stuck on ${taskId} (see ${relQ}).`;
            state.updated_at = nowIso();
            writeJsonAtomic(run.projectPipelineStatePath, state);
          } catch {
            // ignore
          }

          run.status = "implementing";
          run.developerStatus = "blocked";
          run.managerDecision = null;
          run.lastError = { message: `Loop guard triggered for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/loop" };
          this._setRun(runId, run);
        } else {
          this._autoRunLoopGuard.set(runId, g);
        }
      } catch {
        // ignore
      }

      if (run.iteration > MAX_AUTO_ITERATIONS) {
        run.status = "failed";
        run.lastError = { message: `Max iterations reached (${MAX_AUTO_ITERATIONS})`, at: nowIso(), where: "auto" };
        this._setRun(runId, run);
        break;
      }

      let changed = false;
      try {
        changed = await this._advanceOneStep(runId);
      } catch (e) {
        const msg = safeErrorMessage(e);
        try {
          const r = this._getRunRequired(runId);
          r.status = "failed";
          // Preserve a more specific error classification if the turn already recorded it
          // (e.g. turn/inactivity, turn/hard_timeout). Otherwise mark as a generic auto failure.
          const existingWhere = String(r.lastError?.where || "").trim();
          const where = existingWhere && existingWhere.startsWith("turn/") ? existingWhere : "auto";
          r.lastError = { message: msg, at: nowIso(), where };
          r.activeTurn = null;
          this._setRun(runId, r);
        } catch {
          // ignore
        }
        const handled = await this._handleIncident(runId, "auto-run exception");
        if (handled) continue;
        break;
      }

      const after = this._getRunRequired(runId);
      if (after.status === "failed" || (after.status === "implementing" && after.developerStatus === "blocked")) {
        const handled = await this._handleIncident(runId, "auto-run stall/block");
        if (handled) continue;
      }

      if (!changed) break; // paused (missing marker, blocked, etc.)
    }

    this._releaseRunningLock(runId);
  }

  async _advanceOneStep(runId) {
    const run = this._getRunRequired(runId);

    if (
      run.status === "completed" ||
      run.status === "failed" ||
      run.status === "stopped" ||
      run.status === "paused" ||
      run.status === "canceled" ||
      run.status === "waiting_job"
    )
      return false;

    if (run.status === "planning") {
      await this._stepManagerPlanning(runId);
      return true;
    }

    await this._syncFromProjectState(runId);
    const afterSync = this._getRunRequired(runId);
    if (afterSync.status === "failed" || afterSync.status === "stopped") return false;
    if (afterSync.status === "waiting_job" || afterSync.developerStatus === "waiting_job") return false;

    if (
      (!afterSync.pendingUserCommand || afterSync.pendingUserCommand.status !== "pending") &&
      afterSync.queuedUserCommand &&
      afterSync.queuedUserCommand.status === "pending"
    ) {
      this._promoteQueuedUserCommand(runId);
      await this._stepManagerProcessUserCommand(runId);
      return true;
    }

    // Priority override: if a user command is pending, process it before any further dispatch/review,
    // even if the project pipeline_state.json hasn't (yet) reflected the blocked status (race with in-flight steps).
    if (afterSync.pendingUserCommand && afterSync.pendingUserCommand.status === "pending") {
      // Keep the run status consistent for the UI; user_command is treated as a manager intervention step.
      if (afterSync.status !== "implementing" || afterSync.developerStatus !== "blocked") {
        afterSync.status = "implementing";
        afterSync.developerStatus = "blocked";
        this._setRun(runId, afterSync);
      }
      await this._stepManagerProcessUserCommand(runId);
      return true;
    }

    if (afterSync.status === "implementing") {
      if (!afterSync.currentTaskId) {
        afterSync.status = "implementing";
        afterSync.developerStatus = "blocked";
        afterSync.lastError = {
          message: `Missing current_task_id in ${afterSync.projectPipelineStatePath}`,
          at: nowIso(),
          where: "guardrail/missing_current_task_id",
        };
        this._setRun(runId, afterSync);
        this.emit("event", {
          runId,
          event: "diag",
          data: { role: "system", type: "error", message: afterSync.lastError.message },
        });
        try {
          const stRead = readJsonBestEffort(afterSync.projectPipelineStatePath);
          const st = stRead.ok && stRead.value && typeof stRead.value === "object" ? stRead.value : {};
          st.developer_status = "blocked";
          st.manager_decision = null;
          st.summary = `Guardrail: missing current_task_id (see ${afterSync.projectPipelineStatePath}).`;
          st.updated_at = nowIso();
          writeJsonAtomic(afterSync.projectPipelineStatePath, st);
        } catch {
          // ignore
        }
        return false;
      }
      if (afterSync.developerStatus === "blocked") {
        if (afterSync.pendingUserCommand && afterSync.pendingUserCommand.status === "pending") {
          await this._stepManagerProcessUserCommand(runId);
          return true;
        }
        // Robustness: if we previously blocked due to a review-loop guardrail but the developer has
        // produced NEW evidence since the last Manager REWORK review, auto-promote back to
        // ready_for_review so the Manager can re-review instead of looping on guardrail Q/A.
        const resumed = await this._maybeResumeReviewAfterReworkEvidence(runId);
        if (resumed) {
          await this._syncFromProjectState(runId);
          const cur = this._getRunRequired(runId);
          if (cur.developerStatus === "ready_for_review") {
            cur.status = "reviewing";
            this._setRun(runId, cur);
            await this._stepManagerReview(runId);
            return true;
          }
        }
        await this._stepManagerAnswerQuestion(runId);
        return true;
      }
      // Guardrail: never dispatch/review without a concrete task spec.
      // Important: do NOT run this guardrail while we're already blocked, otherwise we can
      // starve the Manager answering step and create a tight loop (token burn + UI hangs).
      if (!this._ensureTaskSpecOrBlock(runId, { context: "advance/implementing" })) {
        return true; // state changed to blocked; next loop will route to Manager answering
      }
      if (afterSync.developerStatus === "ready_for_review") {
        afterSync.status = "reviewing";
        this._setRun(runId, afterSync);
        await this._stepManagerReview(runId);
        return true;
      }
      // Robustness: if the current task already has developer outputs on disk (dev_result.*),
      // prefer promoting to "ready_for_review" rather than blindly re-dispatching.
      // This avoids loops after a TODO resync or other state drift.
      const promoted = await this._maybePromoteCurrentTaskToReadyForReview(runId, { reason: "evidence_detected" });
      if (promoted) {
        await this._syncFromProjectState(runId);
        const cur = this._getRunRequired(runId);
        if (cur.developerStatus === "ready_for_review") {
          cur.status = "reviewing";
          this._setRun(runId, cur);
          await this._stepManagerReview(runId);
          return true;
        }
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

  _taskResultEvidenceMtimeMs(run, { taskDir }) {
    let evidenceMtimeMs = 0;
    const bump = (p) => {
      const st = p ? safeStat(p) : null;
      if (st && typeof st.mtimeMs === "number" && st.mtimeMs > evidenceMtimeMs) evidenceMtimeMs = st.mtimeMs;
    };
    const bumpFreshness = (ms) => {
      if (typeof ms === "number" && ms > evidenceMtimeMs) evidenceMtimeMs = ms;
    };

    // For AG tasks, only consider the referenced result.json (ignore ack/pointers).
    if (run.assignedDeveloper === "developer_antigravity") {
      try {
        const ptrAbs = path.join(taskDir, "dev_result.json");
        const ptr = fileExists(ptrAbs) ? readJsonBestEffort(ptrAbs) : { ok: false };
        if (ptr.ok && ptr.value && typeof ptr.value === "object") {
          const resPath = typeof ptr.value.result_path === "string" ? String(ptr.value.result_path) : "";
          const resAbs = resPath ? (path.isAbsolute(resPath) ? resPath : path.join(run.cwd, resPath)) : null;
          bump(resAbs);
        }
      } catch {
        // ignore
      }
      return evidenceMtimeMs;
    }

    // If dev_result.* cites explicit proof reports, use those semantic timestamps as the
    // authoritative evidence freshness. This prevents a rewritten summary file from
    // looking "fresh" when the referenced benchmark/report is still stale.
    for (const abs of this._devResultReferencedArtifactAbsPaths(run, { taskDir })) {
      if (!this._isLikelyOutcomeProofArtifact(abs)) continue;
      bumpFreshness(this._artifactSemanticFreshnessMs(abs));
    }
    if (evidenceMtimeMs) return evidenceMtimeMs;

    // Fallback for tasks without explicit referenced report artifacts.
    bump(path.join(taskDir, "dev_result.md"));
    bump(path.join(taskDir, "dev_result.json"));
    bump(path.join(taskDir, "dev_result.markdown"));

    return evidenceMtimeMs;
  }

  _taskEvidenceMtimeMsForAutoResume(run, { taskDir }) {
    return this._taskResultEvidenceMtimeMs(run, { taskDir });
  }

  async _maybeResumeReviewAfterReworkEvidence(runId) {
    const run = this._getRunRequired(runId);
    if (!run.currentTaskId || !run.cwd) return false;
    if (run.developerStatus !== "blocked") return false;
    if (!run.lastError || run.lastError.where !== "guardrail/review_loop") return false;

    const { taskDir, taskId } = taskContext(run);
    const reviewAbs = path.join(taskDir, "manager_review.md");
    if (!fileExists(reviewAbs)) return false;

    const head = readTextHead(reviewAbs, 4000) || "";
    if (!/\bREWORK\b/i.test(head)) return false;

    const reviewMtimeMs = safeStat(reviewAbs)?.mtimeMs ?? 0;
    const evidenceMtimeMs = this._taskEvidenceMtimeMsForAutoResume(run, { taskDir });
    if (!evidenceMtimeMs || evidenceMtimeMs <= reviewMtimeMs) return false;

    // Evidence is newer than the last REWORK review -> resume with a fresh Manager review.
    try {
      const psRead = readJsonBestEffort(run.projectPipelineStatePath);
      if (!psRead.ok || !psRead.value || typeof psRead.value !== "object") return false;
      const st = psRead.value;
      st.developer_status = "ready_for_review";
      st.manager_decision = null;
      const atIso = nowIso();
      const msg = `Auto-resume: detected new developer evidence after REWORK for ${taskId} -> developer_status=ready_for_review.`;
      const existingSummary = typeof st.summary === "string" ? String(st.summary) : "";
      st.summary = existingSummary ? `${existingSummary}\n${msg}` : msg;
      st.updated_at = atIso;
      writeJsonAtomic(run.projectPipelineStatePath, st);
    } catch {
      return false;
    }

    // Reset review-loop counter for this task (the situation changed).
    try {
      if (!run.taskReviewCounts || typeof run.taskReviewCounts !== "object") run.taskReviewCounts = {};
      run.taskReviewCounts[taskId] = 0;
    } catch {
      // ignore
    }
    run.developerStatus = "ready_for_review";
    run.lastError = null;
    this._setRun(runId, run);
    this.emit("event", { runId, event: "diag", data: { role: "system", type: "info", message: `Auto-resume to review for ${taskId} (new evidence after REWORK).` } });
    return true;
  }

  _readTodoSnapshot(run) {
    const todoAbs = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
    const st = safeStat(todoAbs);
    const text = readTextBestEffort(todoAbs);
    if (text == null) {
      return {
        todoAbs,
        mtimeMs: st && typeof st.mtimeMs === "number" ? st.mtimeMs : null,
        fingerprint: null,
      };
    }
    return {
      todoAbs,
      mtimeMs: st && typeof st.mtimeMs === "number" ? st.mtimeMs : null,
      fingerprint: computeTodoFingerprint(text),
    };
  }

  _acknowledgeTodoSnapshot(run, snapshot, { reason = null } = {}) {
    if (!run || !snapshot) return;
    if (typeof snapshot.mtimeMs === "number") {
      run.todoProcessedMtimeMs = snapshot.mtimeMs;
      run.projectTodoFileMtimeMs = snapshot.mtimeMs;
    }
    if (snapshot.fingerprint) {
      run.lastReconciledTodoFingerprint = {
        ...snapshot.fingerprint,
        reconciledAt: nowIso(),
        reason: reason || null,
      };
    }
  }

  _buildTodoUpdatedUserCommandMessage(run, snapshot) {
    const todoRel = relPathForPrompt(run.cwd, run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
    const nextTaskBits = [];
    if (snapshot?.fingerprint?.firstUncheckedTaskId) nextTaskBits.push(`first unchecked task: ${snapshot.fingerprint.firstUncheckedTaskId}`);
    if (snapshot?.fingerprint?.firstUncheckedOwner) nextTaskBits.push(`owner: ${snapshot.fingerprint.firstUncheckedOwner}`);
    return [
      `The user edited ${todoRel}.`,
      "",
      "This is a HIGH-PRIORITY override: reconcile doc/TODO.md with task folders + pipeline_state.json before any further dispatch.",
      "",
      "Requirements:",
      "- Do not skip newly inserted gate tasks.",
      "- Ensure missing task specs are created (data/tasks/<task_id>/task.md + manager_instruction.md).",
      "- Ensure data/pipeline_state.json aligns with the first unchecked task in TODO.",
      ...(nextTaskBits.length ? ["", `Observed TODO snapshot: ${nextTaskBits.join("; ")}`] : []),
    ].join("\n");
  }

  _queueTodoUpdatedUserCommand(runId) {
    const run = this._getRunRequired(runId);
    const snapshot = this._readTodoSnapshot(run);
    if (!snapshot.fingerprint) return { queued: false, skipped: false, snapshot };

    if (sameTodoFingerprint(run.lastReconciledTodoFingerprint, snapshot.fingerprint)) {
      this._acknowledgeTodoSnapshot(run, snapshot, { reason: "already_reconciled" });
      this._setRun(runId, run);
      return { queued: false, skipped: true, snapshot };
    }

    const cmd = this._queueUserCommand(runId, {
      source: "todo_updated",
      message: this._buildTodoUpdatedUserCommandMessage(run, snapshot),
    });
    return { queued: true, skipped: false, snapshot, cmd };
  }

  async _syncFromProjectState(runId) {
    const run = this._getRunRequired(runId);
    const p = run.projectPipelineStatePath;
    const st = safeStat(p);
    if (st) {
      run.projectPipelineStateFileMtimeMs = st.mtimeMs;
      run.projectPipelineStateFileMtimeIso = new Date(st.mtimeMs).toISOString();
      run.projectPipelineStateFileSize = st.size;
    } else {
      run.projectPipelineStateFileMtimeMs = null;
      run.projectPipelineStateFileMtimeIso = null;
      run.projectPipelineStateFileSize = null;
    }

    // Track doc/TODO.md mtime for user-editable TODO workflows (manual edits outside the UI).
    try {
      const todoSnapshot = this._readTodoSnapshot(run);
      run.projectTodoFileMtimeMs = typeof todoSnapshot.mtimeMs === "number" ? todoSnapshot.mtimeMs : null;
      if (run.todoProcessedMtimeMs == null && typeof todoSnapshot.mtimeMs === "number") {
        run.todoProcessedMtimeMs = todoSnapshot.mtimeMs;
      }
      if (!run.lastReconciledTodoFingerprint && todoSnapshot.fingerprint) {
        run.lastReconciledTodoFingerprint = {
          ...todoSnapshot.fingerprint,
          reconciledAt: nowIso(),
          reason: "initial_baseline",
        };
      }
    } catch {
      // ignore
    }

    try {
      this._reconcileTerminalLatestLongJobState(runId, { reason: "sync_from_project_state" });
    } catch {
      // ignore
    }

    const r = readJsonBestEffort(p);
    if (!r.ok) {
      run.lastError = { message: `Invalid project pipeline_state.json: ${r.error}`, at: nowIso(), where: "sync" };
      this._setRun(runId, run);
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "error", message: run.lastError.message } });
      return;
    }
    if (!r.value || typeof r.value !== "object") return;

    if (typeof r.value.updated_at === "string") {
      run.projectPipelineStateAgentUpdatedAt = String(r.value.updated_at);
      const agentMs = tryParseIsoToMs(run.projectPipelineStateAgentUpdatedAt);
      run.projectPipelineStateAgentUpdatedAtMs = agentMs;
      run.projectPipelineStateAgentUpdatedAtSkewMs = agentMs !== null ? agentMs - Date.now() : null;
    } else {
      run.projectPipelineStateAgentUpdatedAt = null;
      run.projectPipelineStateAgentUpdatedAtMs = null;
      run.projectPipelineStateAgentUpdatedAtSkewMs = null;
    }

    const dev = normalizeDeveloperStatus(r.value.developer_status);
    const decision = normalizeManagerDecision(r.value.manager_decision);
    const phase = typeof r.value.phase === "string" ? String(r.value.phase) : null;
    const currentTaskId = typeof r.value.current_task_id === "string" ? String(r.value.current_task_id) : null;
    const assignedDeveloper = typeof r.value.assigned_developer === "string" ? String(r.value.assigned_developer) : null;
    const threadPolicy = r.value.thread_policy && typeof r.value.thread_policy === "object" ? normalizeThreadPolicy(r.value.thread_policy) : null;

    const hasDevKey = Object.prototype.hasOwnProperty.call(r.value, "developer_status");
    const hasDecisionKey = Object.prototype.hasOwnProperty.call(r.value, "manager_decision");
    const preserveOrchestratorDevStatus = this._isTerminalStatus(run.status);

    if (hasDevKey) {
      if (preserveOrchestratorDevStatus) {
        // Keep terminal orchestrator states stable even if the project file still says waiting_job/ready_for_review.
      } else if (dev) run.developerStatus = dev;
      else run.lastError = run.lastError || { message: `Invalid developer_status in pipeline_state.json`, at: nowIso(), where: "sync" };
    }
    // manager_decision is a one-shot marker; allow clearing it back to null without leaving a stale value in memory.
    if (hasDecisionKey) run.managerDecision = decision;
    if (phase) run.projectPhase = phase;
    if (currentTaskId) run.currentTaskId = currentTaskId;
    if (assignedDeveloper) run.assignedDeveloper = assignedDeveloper;
    if (threadPolicy) run.threadPolicy = threadPolicy;
    if (typeof r.value.summary === "string") run.lastSummary = clampString(r.value.summary, 20_000);
    if (dev === "failed" && run.status !== "failed") {
      run.status = "failed";
      run.lastError = run.lastError || { message: "developer_status=failed in pipeline_state.json", at: nowIso(), where: "sync" };
    }

    // Late-artifact reconciliation:
    // If a watchdog previously marked the run as stalled but the project state now progressed
    // (e.g. developer_status=ready_for_review), clear the stale error so the UI doesn't look stuck.
    if (run.lastError && run.lastError.where === "ag/watchdog" && dev && dev !== "blocked") {
      run.lastError = null;
    }

    // Non-supervised Corrector restart: freeze the run in a clean stopped state until the user/server restarts it.
    // Without this, project-state sync can reintroduce developer_status=waiting_job and stale activeJob UI.
    if (run.status === "stopped" && run.lastError?.where === "corrector/restart_required") {
      this._clearActiveLongJobReference(run, { preserveLastJobId: true });
      run.developerStatus = "idle";
      try {
        const currentDev = normalizeDeveloperStatus(r.value.developer_status);
        const currentSummary = typeof r.value.summary === "string" ? String(r.value.summary) : "";
        const desiredSummary = run.lastError?.message || currentSummary || "Corrector applied fix; restart Antidex to continue.";
        if (currentDev !== "idle" || r.value.manager_decision != null || currentSummary !== desiredSummary) {
          const next = { ...r.value };
          next.developer_status = "idle";
          next.manager_decision = null;
          next.summary = desiredSummary;
          next.updated_at = nowIso();
          writeJsonAtomic(p, next);
          r.value = next;
        }
      } catch {
        // ignore
      }
    }

    // Make run.status reflect the project state for better UX.
    // Never override orchestrator-owned statuses here (completed/failed/stopped/paused/canceled).
    // In particular, "paused" must remain stable so the UI can show Resume and so auto-run stops cleanly.
    if (
      run.status !== "failed" &&
      run.status !== "completed" &&
      run.status !== "stopped" &&
      run.status !== "paused" &&
      run.status !== "canceled" &&
      run.status !== "waiting_job"
    ) {
      if (run.activeTurn?.role === "manager") {
        run.status = run.activeTurn.step === "planning" ? "planning" : "reviewing";
      } else if (run.activeTurn?.role === "monitor") {
        run.status = "waiting_job";
      } else if (dev === "waiting_job") run.status = "waiting_job";
      else if (phase === "planning") run.status = "planning";
      else if (dev === "ready_for_review") run.status = "reviewing";
      else run.status = "implementing";
    }
    // Recovery: if the orchestrator thinks we're `waiting_job` but the project state no longer is
    // (e.g. server restart after a job finished and activeJobId was not persisted), allow the project state to win.
    if (
      run.status === "waiting_job" &&
      dev !== "waiting_job" &&
      !run.activeJobId &&
      run.status !== "failed" &&
      run.status !== "completed" &&
      run.status !== "stopped" &&
      run.status !== "paused" &&
      run.status !== "canceled"
    ) {
      if (phase === "planning") run.status = "planning";
      else if (dev === "ready_for_review") run.status = "reviewing";
      else run.status = "implementing";
    }

    // Robustness: after a server restart, we can end up with a stale run.activeTurn persisted in the orchestrator state.
    // That makes the UI look like something is still running and can prevent auto-run from starting.
    // If we have no in-process turn and no running lock, clear it.
    try {
      if (
        run.activeTurn &&
        typeof run.activeTurn === "object" &&
        !this._active &&
        !this._runningRunId &&
        !this._autoRunLoops.has(runId)
      ) {
        run.activeTurn = null;
      }
    } catch {
      // ignore
    }

    // If the run is already completed at the orchestrator level, normalize the project pipeline_state.json
    // so resumes are unambiguous (avoid leaving developer_status=ready_for_review forever).
    try {
      if (run.status === "completed" && r.value && typeof r.value === "object") {
        const desiredPhase = "completed";
        const desiredDev = "idle";
        const curPhase = typeof r.value.phase === "string" ? String(r.value.phase) : null;
        const curDev = typeof r.value.developer_status === "string" ? String(r.value.developer_status) : null;
        if (curPhase !== desiredPhase || curDev !== desiredDev || r.value.manager_decision != null) {
          const next = { ...r.value };
          next.phase = desiredPhase;
          next.developer_status = desiredDev;
          next.manager_decision = null;
          next.updated_at = nowIso();
          writeJsonAtomic(p, next);
        }
      }
    } catch {
      // best-effort
    }

    this._setRun(runId, run);
  }

  // Public wrapper used by the API to refresh UI state without running a step.
  async syncFromProjectState(runId) {
    await this._syncFromProjectState(runId);
    try {
      const run = this._getRunRequired(runId);
      if (run.activeJobId) this._reconcileTerminalLongJobArtifacts(runId, run.activeJobId, { refreshHistory: false });
      if (run.lastJobId) this._reconcileTerminalLongJobArtifacts(runId, run.lastJobId, { refreshHistory: false });
      this._refreshTaskLongJobHistory(runId);
      this._refreshActiveLongJobSummary(runId);
      this._reconcileActiveLongJobReference(runId);
    } catch {
      // ignore
    }
    return this._getRunRequired(runId);
  }

  getLongJobState(runId) {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    const run = this._getRunRequired(id);
    try {
      this._reconcileTerminalLatestLongJobState(id, { reason: "jobs_state" });
      if (run.activeJobId) this._reconcileTerminalLongJobArtifacts(id, run.activeJobId, { refreshHistory: false });
      if (run.lastJobId) this._reconcileTerminalLongJobArtifacts(id, run.lastJobId, { refreshHistory: false });
      this._refreshTaskLongJobHistory(id);
      this._refreshActiveLongJobSummary(id);
      this._reconcileActiveLongJobReference(id);
    } catch {
      // ignore
    }
    const updated = this._getRunRequired(id);
    const historyPaths = updated.currentTaskId ? this._taskLongJobHistoryPaths(updated, updated.currentTaskId) : null;
    const taskHistory =
      historyPaths && (fileExists(historyPaths.mdAbs) || fileExists(historyPaths.jsonAbs))
        ? {
            taskId: updated.currentTaskId || null,
            markdown: fileExists(historyPaths.mdAbs) ? historyPaths.mdRel : null,
            json: fileExists(historyPaths.jsonAbs) ? historyPaths.jsonRel : null,
          }
        : null;
    const activeJobId = updated.activeJobId ? String(updated.activeJobId) : "";
    if (activeJobId) {
      const display = this._getLongJobDisplayState(updated, activeJobId, { activeJob: updated.activeJob || null });
      if (!display) return { ok: true, active: null, latest: null, taskHistory };
      return {
        ok: true,
        pipeline: {
          status: updated.status || null,
          developerStatus: updated.developerStatus || null,
          activeTurnRole: updated.activeTurn?.role || null,
        },
        taskHistory,
        active: updated.activeJob,
        ...display,
      };
    }
    const lastJobId = updated.lastJobId ? String(updated.lastJobId) : "";
    if (!lastJobId)
      return {
        ok: true,
        pipeline: {
          status: updated.status || null,
          developerStatus: updated.developerStatus || null,
          activeTurnRole: updated.activeTurn?.role || null,
        },
        taskHistory,
        active: null,
        latest: null,
      };
    const display = this._getLongJobDisplayState(updated, lastJobId);
    if (!display)
      return {
        ok: true,
        pipeline: {
          status: updated.status || null,
          developerStatus: updated.developerStatus || null,
          activeTurnRole: updated.activeTurn?.role || null,
        },
        taskHistory,
        active: null,
        latest: null,
      };
    return {
      ok: true,
      pipeline: {
        status: updated.status || null,
        developerStatus: updated.developerStatus || null,
        activeTurnRole: updated.activeTurn?.role || null,
      },
      taskHistory,
      active: null,
      ...display,
    };
  }

  tailLongJobLog(runId, { stream, maxBytes } = {}) {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    const run = this._getRunRequired(id);
    const jobId = run.activeJobId ? String(run.activeJobId) : run.lastJobId ? String(run.lastJobId) : "";
    if (!jobId) return { ok: true, text: "" };
    const paths = this._jobPaths(run, jobId);
    const which = String(stream || "stdout").toLowerCase() === "stderr" ? "stderr" : "stdout";
    const p = which === "stderr" ? paths.stderrAbs : paths.stdoutAbs;
    const bytes = Number.isFinite(Number(maxBytes)) ? Number(maxBytes) : 200_000;
    const text = longJob.tailTextFile(p, Math.max(1000, Math.min(2_000_000, bytes)));
    return { ok: true, text, path: relPathForPrompt(run.cwd, p) };
  }

  stopLongJob(runId, { reason } = {}) {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    const run = this._getRunRequired(id);
    const preserveRunStatus =
      run.status === "stopped" ||
      run.status === "paused" ||
      run.status === "canceled";
    return this._stopActiveLongJob(id, {
      reason: reason || "user_stop",
      wakeDeveloper: !preserveRunStatus,
      preserveRunStatus,
    });
  }

  restartLongJob(runId, { reason } = {}) {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    return this._restartActiveLongJob(id, { reason: reason || "user_restart" });
  }

  async forceLongJobMonitor(runId, { reason } = {}) {
    const id = String(runId || "").trim();
    if (!id) throw new Error("runId is required");
    const state = this._longJobMonitors.get(id) || { running: false, lastStartedAtMs: 0 };
    if (state.running) return { ok: false, error: "monitor_already_running" };
    state.running = true;
    state.lastStartedAtMs = Date.now();
    this._longJobMonitors.set(id, state);
    try {
      const mon = await this._runLongJobMonitorTurn(id, { force: true, reason: reason || "forced by UI" });
      if (mon.ok && mon.report) {
        try {
          this._applyLongJobMonitorDecision(id, mon.report);
        } catch {
          // ignore
        }
      }
      return { ok: !!mon.ok, report: mon.report || null };
    } finally {
      const s = this._longJobMonitors.get(id) || state;
      s.running = false;
      this._longJobMonitors.set(id, s);
    }
  }

  async _ensureThread({ runId, role }) {
    const run = this._getRunRequired(runId);
    const cwd = run.cwd;
    const model = role === "manager" ? run.managerModel : run.developerModel;
    const threadKey = role === "manager" ? "managerThreadId" : role === "monitor" ? "monitorThreadId" : "developerThreadId";
    const rolloutKey = role === "manager" ? "managerRolloutPath" : role === "monitor" ? "monitorRolloutPath" : "developerRolloutPath";
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
    if (existing && shouldReuse) {
      try {
        resp = await this._codex.threadResume({ threadId: existing, cwd, sandbox, approvalPolicy, model });
      } catch (e) {
        const msg = safeErrorMessage(e);
        const invalidThread =
          /\binvalid thread id\b/i.test(msg) ||
          /\burn:uuid\b/i.test(msg) ||
          /\b-32600\b/.test(msg);
        if (!invalidThread) throw e;

        // Auto-heal: some runs (e.g. fake/smoke runs) may store thread ids like "thread-...".
        // The real codex app-server expects UUID thread ids. Fall back to a new thread.
        this.emit("event", {
          runId,
          event: "diag",
          data: {
            role: "system",
            type: "warn",
            message: `Thread resume failed for ${role} (threadId=${existing}). Starting a new thread. (${msg})`,
          },
        });
        // Recontextualisation guarantee: if we fall back to a new thread unexpectedly,
        // make sure we have a fresh resume packet on disk that can be injected into prompts.
        this._writeResumePacket(run, { reason: `thread_resume_failed_${role}` });
        resp = await this._codex.threadStart({ cwd, sandbox, approvalPolicy, model });
      }
    } else {
      // Recontextualisation guarantee: when starting a new thread (first run or policy new_per_task),
      // keep a stable resume packet on disk so the new thread can re-read the project truth via files.
      this._writeResumePacket(run, { reason: `thread_start_${role}` });
      resp = await this._codex.threadStart({ cwd, sandbox, approvalPolicy, model });
    }

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
    const resumePacketPath = resumePacketRelForRole(run, "manager");

    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        ...(resumePacketPath ? [resumePacketPath] : []),
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
        "For long AG browser-only tasks, set ag_expected_silence_ms (or ag_expected_silence_minutes) in task.md or manager_instruction.md to extend the watchdog stall window.",
        "For long compute tasks (>10–15 minutes: tournaments/benchmarks/tuning), instruct Dev Codex to use the Long Job protocol (tools/antidex.cmd job start ...), and to set developer_status=waiting_job while the background job runs.",
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

    return [
      header,
      "",
      String(run.managerPreprompt || ""),
      "",
      buildDynamicOptionsBlockForManager(run),
      "",
      "User request:",
      run.userPrompt,
      protocol,
      retryBlock,
    ].join("\n");
  }

  _buildDeveloperPrompt(run, { turnNonce, retryReason, taskIdOverride } = {}) {
    // Note: developer prompt always includes a per-turn marker when orchestrator provides it.
    const pre =
      run.developerPreprompt ||
      [
        "You are Developer Codex.",
        "Follow the manager plan and implement ONLY the assigned task.",
        "Prefer minimal changes. Add tests when required by the task/TESTING_PLAN.",
        "Do NOT edit doc/TODO.md unless the Manager explicitly asks you to.",
        "Do NOT do any git commit unless explicitly asked by the Manager after ACCEPTED.",
      ].join(" ");

    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const instructionsPath = relPathForPrompt(run.cwd, run.projectDeveloperInstructionPath || path.join(run.cwd, "agents", "developer_codex.md"));
    const { taskId, taskDir, taskDirRel } = taskContext(run, taskIdOverride);
    const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
    const taskMdHead = taskMeta.taskText;
    const taskKind = taskMeta.taskKind;
    const isStrengthGate = taskKind === "ai_strength_gate" || /\bstrength\s+gate\b/i.test(taskMdHead || "");
    const isOutcomeDriven = taskMeta.outcomeDriven;
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;
    const resumePacketPath = resumePacketRelForRole(run, "developer_codex");
    const reviewAbs = path.join(taskDir, "manager_review.md");
    const reviewRel = fileExists(reviewAbs) ? relPathForPrompt(run.cwd, reviewAbs) : null;
    const longJobHistoryPaths = this._taskLongJobHistoryPaths(run, taskId);
    const longJobHistoryRel = fileExists(longJobHistoryPaths.mdAbs) ? longJobHistoryPaths.mdRel : null;
    const longJobOutcomePaths = this._taskLongJobOutcomePaths(run, taskId);
    const longJobOutcomeRel = fileExists(longJobOutcomePaths.mdAbs) ? longJobOutcomePaths.mdRel : null;
    const reviewedEvidenceReuse = this._taskReviewedEvidenceReuseDirective(run, { taskDir });

    const header = buildReadFirstHeader({
      role: "developer_codex",
      turnNonce,
      readPaths: [
        ...(resumePacketPath ? [resumePacketPath] : []),
        ...(longJobOutcomeRel ? [longJobOutcomeRel] : []),
        instructionsPath,
        docsRules,
        docsIndex,
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        `${taskDirRel}/task.md`,
        `${taskDirRel}/manager_instruction.md`,
        ...(longJobHistoryRel ? [longJobHistoryRel] : []),
        ...(reviewRel ? [reviewRel] : []),
      ],
      writePaths: [
        `${taskDirRel}/dev_ack.json`,
        `${taskDirRel}/dev_result.md`,
        "data/jobs/requests/REQ-*.json (if long job)",
        `${taskDirRel}/questions/Q-*.md (if blocked)`,
        pipelineStatePath,
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "If current_task_id is missing, ask a question and set developer_status=blocked.",
        "Include 'Ecarts & rationale' in dev_result.md for any initiative/deviation.",
        ...(longJobOutcomeRel
          ? [
            `If ${longJobOutcomeRel} exists, treat it as the canonical post-long-job handoff before reading stale manager docs.`,
            "Immediately after wake_developer, consume the latest terminal result in dev_result.md before considering any new rerun.",
          ]
          : []),
        "If manager_review.md exists, read it and address any REWORK feedback.",
        ...(isOutcomeDriven
          ? [
            "Outcome-driven task: when you deliver a final result for review, include a 'What this suggests next:' block with Observed signal / Likely cause / Can current task still succeed as-is? / Recommended next step / Smallest confirming experiment.",
            "Outcome-driven REWORK rule: do NOT set developer_status=ready_for_review until the requested proof artifacts have actually been regenerated. Rewriting dev_result.md alone is not enough.",
            ...(reviewedEvidenceReuse?.value === "yes"
              ? [
                `Manager opt-in from ${reviewedEvidenceReuse.rel}: the artifact already reviewed may be reused as decision input for planning this step, even if it is older than manager_review.md.`,
                "Use that reviewed artifact to choose the next code/config change, then regenerate fresh proof before ready_for_review.",
              ]
              : []),
            ...(reviewedEvidenceReuse?.value === "no"
              ? [
                `Manager opt-in from ${reviewedEvidenceReuse.rel}: do NOT reuse the already-reviewed artifact for planning this step without asking the manager again.`,
              ]
              : []),
          ]
          : []),
        ...(longJobHistoryRel
          ? [
            `Read ${longJobHistoryRel} before deciding to rerun or reuse previous long-job evidence.`,
            "Any rerun must explain what changed versus the last terminal attempt; avoid repeating an unchanged 200-game rerun.",
          ]
          : []),
        ...(isStrengthGate
          ? [
            "This task is a Strength Gate / benchmarking task: treat any >10–15 minute compute as a LONG JOB (background). Do NOT run hour-long simulations inside this LLM turn.",
          ]
          : []),
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
      `\n4) Otherwise implement the task, write ${taskDirRel}/dev_result.md (include tests + 'Ecarts & rationale'${isOutcomeDriven ? " + 'What this suggests next:'" : ""}).` +
      `\n5) Update ${pipelineStatePath} with developer_status=ready_for_review (normal) OR developer_status=waiting_job (if you started a background long job).` +
      (isOutcomeDriven
        ? `\n   - For REWORK on an outcome-driven task: 'ready_for_review' is allowed only after fresh proof artifacts were regenerated for this attempt (for example the rerun report/result files mentioned in task.md or manager_instruction.md).`
          + (reviewedEvidenceReuse?.value === "yes"
            ? `\n   - Manager explicitly allows reusing the already-reviewed artifact for planning this step (${reviewedEvidenceReuse.rel}). Make the requested change first; freshness is required for the next review proof, not before choosing the change.`
            : "")
        : "") +
      (marker ? `\n6) Finally, write the turn marker ${marker.doneRel} (atomic via ${marker.tmpRel}) with content 'ok'.` : "") +
      `\nExample: { \"run_id\": \"${run.runId}\", \"iteration\": ${run.iteration}, \"current_task_id\":\"${taskId}\", \"developer_status\": \"ready_for_review\", \"summary\": \"...\", \"tests\": { \"ran\": true, \"passed\": false, \"notes\": \"...\" }, \"updated_at\": \"${nowIso()}\" }`;

    const longJobs =
      "\n\nLong jobs (background compute):" +
      "\n- If a command is expected to take >10–15 minutes (benchmarks, tournaments, tuning), you MUST use the long-job protocol." +
      "\n- Start a job by writing a request JSON under data/jobs/requests/ (or use the helper CLI):" +
      `\n  - Windows (preferred): tools\\\\antidex.cmd job start --run-id ${run.runId} --task-id ${taskId} --expected-minutes 120 --script .\\\\scripts\\\\bench.cmd` +
      `\n  - Windows (argv form): tools\\\\antidex.cmd job start --run-id ${run.runId} --task-id ${taskId} --expected-minutes 120 -- node .\\\\scripts\\\\bench.js --seed 1` +
      "\n  - Legacy fallback: --command \"...\" remains supported for simple cases only; avoid it for nested quoting on Windows." +
      "\n  - This writes a request file; the orchestrator spawns the process and monitors it." +
      `\n- After writing the request, set developer_status=waiting_job in ${pipelineStatePath} and write dev_result.md explaining:` +
      "\n  - the command you requested," +
      "\n  - where to watch progress: data/jobs/<job_id>/stdout.log, stderr.log, monitor_reports/latest.md," +
      "\n  - what result.json will contain when complete." +
      "\n- Do NOT keep this LLM turn open waiting for the compute to finish.";

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
        longJobs,
        retryBlock,
      ].join("\n")
    );
  }

  _buildManagerReviewTemplates(run, { taskIdOverride, turnNonce } = {}) {
    const { taskId, taskDirRel } = taskContext(run, taskIdOverride);
    const { taskDir } = taskContext(run, taskIdOverride);
    const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
    const isOutcomeDriven = taskMeta.outcomeDriven;

    const acceptedTemplate = [
      `# Manager Review - ${taskId}`,
      "",
      "Decision: **ACCEPTED**",
      "Reviewed_at: <ISO timestamp>",
      `Turn nonce: ${turnNonce || "<turn_nonce>"}`,
      "",
      "Reasons (short):",
      "- <proof that the DoD is satisfied>",
      "",
      "What is good:",
      "- <main successful artifact or test>",
      "",
      "Next actions:",
      "- <next task id or 'none'>",
      "",
      "Commit:",
      "- <git hash or note why commit was skipped>",
    ].join("\n");

    const reworkLines = [
      `# Manager Review - ${taskId}`,
      "",
      "Decision: **REWORK**",
      "Reviewed_at: <ISO timestamp>",
      `Turn nonce: ${turnNonce || "<turn_nonce>"}`,
      "",
      "Reasons (short):",
      "- <what is missing or invalid>",
    ];
    if (isOutcomeDriven) {
      reworkLines.push(
        "",
        "Goal check:",
        "- Final goal: <product-level goal>",
        "- Evidence that invalidates: <what the artifacts disproved or failed to prove>",
        "- Failure type: <local_task_issue | measurement_or_protocol_issue | upstream_plan_issue>",
        "- Decision: <rerun locally / change protocol / replan upstream>",
        "- Why this is the right level: <why this is the correct scope of change>",
        "",
        "Rerun justification:",
        "- <required unless Failure type = upstream_plan_issue; explain the new information/change>",
        "",
        "Reviewed evidence may be reused for planning this step:",
        "- <yes|no; optional but recommended when the just-reviewed artifact may still be used to choose the next change before rerun>",
      );
    }
    reworkLines.push(
      "",
      "Rework request:",
      "1) <specific next action>",
      "",
      "Next actions:",
      `- Update ${taskDirRel}/manager_instruction.md OR doc/TODO.md in this same turn.`,
      "- <concrete next step for the next attempt>",
    );

    return [
      "Write `manager_review.md` by copying one of these templates and replacing every `<...>` placeholder.",
      "",
      "ACCEPTED template:",
      "```md",
      acceptedTemplate,
      "```",
      "",
      "REWORK template:",
      "```md",
      reworkLines.join("\n"),
      "```",
    ].join("\n");
  }

  _buildManagerReviewPrompt(run, { turnNonce, retryReason, taskIdOverride } = {}) {
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const gitWorkflowPath = relPathForPrompt(run.cwd, run.projectGitWorkflowPath || path.join(run.cwd, "doc", "GIT_WORKFLOW.md"));
    const instructionsPath = relPathForPrompt(run.cwd, run.projectManagerInstructionPath || path.join(run.cwd, "agents", "manager.md"));
    const { taskId, taskDirRel } = taskContext(run, taskIdOverride);
    const { taskDir } = taskContext(run, taskIdOverride);
    const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
    const isOutcomeDriven = taskMeta.outcomeDriven;
    const taskManagerInstrRel = `${taskDirRel}/manager_instruction.md`;
    const longJobHistoryPaths = this._taskLongJobHistoryPaths(run, taskId);
    const longJobHistoryRel = fileExists(longJobHistoryPaths.mdAbs) ? longJobHistoryPaths.mdRel : null;
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;
    const isAg = run.assignedDeveloper === "developer_antigravity";
    const resumePacketPath = resumePacketRelForRole(run, "manager");

    let devResultRel = `${taskDirRel}/dev_result.md`;
    let agAckRel = null;
    let agResultRel = null;
    let agArtifactsRel = null;
    if (isAg) {
      devResultRel = `${taskDirRel}/dev_result.json`;
      try {
        const ptrAbs = path.join(run.projectTasksDir || path.join(run.cwd, "data", "tasks"), taskId, "dev_result.json");
        const ptr = readJsonBestEffort(ptrAbs);
        if (ptr.ok && ptr.value && typeof ptr.value === "object") {
          const ackPath = typeof ptr.value.ack_path === "string" ? ptr.value.ack_path : null;
          const resPath = typeof ptr.value.result_path === "string" ? ptr.value.result_path : null;
          const artDir = typeof ptr.value.artifacts_dir === "string" ? ptr.value.artifacts_dir : null;
          if (ackPath) agAckRel = path.isAbsolute(ackPath) ? relPathForPrompt(run.cwd, ackPath) : ackPath;
          if (resPath) agResultRel = path.isAbsolute(resPath) ? relPathForPrompt(run.cwd, resPath) : resPath;
          if (artDir) agArtifactsRel = path.isAbsolute(artDir) ? relPathForPrompt(run.cwd, artDir) : artDir;
        }
      } catch {
        // ignore
      }
    }

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        ...(resumePacketPath ? [resumePacketPath] : []),
        instructionsPath,
        docsRules,
        todoPath,
        testingPath,
        gitWorkflowPath,
        pipelineStatePath,
        `${taskDirRel}/task.md`,
        taskManagerInstrRel,
        ...(longJobHistoryRel ? [longJobHistoryRel] : []),
        ...(isAg ? [] : [`${taskDirRel}/dev_ack.json`]),
        devResultRel,
        ...(isAg ? [agAckRel || "(AG) ack_path from dev_result.json", agResultRel || "(AG) result_path from dev_result.json"] : []),
      ],
      writePaths: [
        `${taskDirRel}/manager_review.md`,
        taskManagerInstrRel,
        pipelineStatePath,
        todoPath,
        docsIndex,
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      notes: [
        "Re-read doc/TODO.md for user changes before deciding.",
        "Commit only after ACCEPTED (see doc/GIT_WORKFLOW.md). Keep it non-interactive (use -m, avoid opening an editor).",
        ...(isOutcomeDriven
          ? [
            "Outcome-driven task: do NOT keep this review shallow. Read the result artifacts to decide whether the failure is local, protocol/measurement, or upstream-plan.",
          ]
          : ["Keep this review short: verify DoD + required files, then write manager_review.md + update pipeline_state.json."]),
        ...(longJobHistoryRel
          ? [
            `Read ${longJobHistoryRel} before requesting another rerun; use it as the canonical memory of prior long-job attempts and conclusions.`,
          ]
          : []),
        ...(isAg
          ? [
            "AG task: verify data/antigravity_runs/<runId>/result.json + dev_result.json pointer (and artifacts if any).",
            ...(agArtifactsRel ? [`AG artifacts dir: ${agArtifactsRel}`] : []),
          ]
          : []),
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
      `\n   - Copy the exact READ FIRST nonce into the review header as: Turn nonce: ${turnNonce || "<turn_nonce>"}.` +
      "\n   - If REWORK: you MUST include sections: Reasons (short):, Rework request:, Next actions:." +
      `\n   - If REWORK: in THIS SAME TURN, you MUST update either ${taskManagerInstrRel} (preferred) OR ${todoPath} so the next attempt is meaningfully different.` +
      "\n   - If you do neither, the orchestrator will block the pipeline on a guardrail." +
      (isOutcomeDriven
        ? "\n   - Because this is an outcome-driven task, a REWORK MUST also include a 'Goal check:' block with Final goal / Evidence that invalidates / Failure type / Decision / Why this is the right level." +
          "\n   - Failure type must be one of: local_task_issue | measurement_or_protocol_issue | upstream_plan_issue." +
          "\n   - If Failure type != upstream_plan_issue: add 'Rerun justification:' and explain what NEW information or change makes the rerun meaningful." +
          "\n   - If the just-reviewed artifact is still valid to choose the next change before rerun, explicitly add 'Reviewed evidence may be reused for planning this step: yes' in manager_instruction.md or manager_review.md." +
          "\n   - Use 'yes' only if the same task/protocol is still in force and no relevant code/config change has invalidated that reviewed artifact as planning input." +
          `\n   - If Failure type = upstream_plan_issue: update ${todoPath} so an upstream task becomes the first unchecked TODO item; do not just rerun the same task.`
        : "") +
      `\n3) Update ${pipelineStatePath} (project cwd) with:` +
      "\n   - manager_decision: one of completed|continue|blocked" +
      "\n   - summary: short + pointer to manager_review.md" +
      "\n   - updated_at: ISO" +
      "\n\nGATING (manual E2E tests): If task.md declares `task_kind: manual_test`, do NOT ACCEPT if the happy-path could not be verified (e.g. missing tikal/Java/keys). In that case: create a P0 env/setup task (or set manager_decision=blocked) and re-run the manual_test after prerequisites are available." +
      `\n4) If ACCEPTED and there is a next task in TODO order:` +
      "\n   - set current_task_id to the next task id (e.g. T-002_world)" +
      "\n   - create/verify the next task spec: data/tasks/<next>/task.md + manager_instruction.md" +
      "\n   - set phase=\"dispatching\" and developer_status=\"ongoing\"" +
      "\n   - set manager_decision=\"continue\"" +
      `\n5) If this was the last task and everything is done: set manager_decision=\"completed\".` +
      `\n6) If REWORK is needed: set manager_decision=\"continue\".` +
      "\n   - If the same task should be retried: keep current_task_id unchanged." +
      "\n   - If the evidence shows an upstream plan problem: update TODO so an upstream task becomes first unchecked, and set current_task_id accordingly (the orchestrator will also rebase to TODO)." +
      `\n7) If ACCEPTED, do a non-interactive git commit (and record the hash in ${taskDirRel}/manager_review.md):` +
      "\n   - If not a git repo yet: git init" +
      "\n   - Ensure local git identity is set (NO prompts): git config user.name \"Antidex\"; git config user.email \"antidex@local\"" +
      "\n   - git add -A" +
      `\n   - git commit --no-gpg-sign -m \"[${taskId}] <short summary>\" (do NOT open an editor)` +
      "\n   - If commit fails: record the error in manager_review.md and continue (do not spend >30s debugging here)." +
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
        "",
        buildDynamicOptionsBlockForManager(run),
        `\nReview iteration: ${run.iteration}`,
        "\nThe developer claims the work is ready for review (developer_status=ready_for_review).",
        protocol,
        "",
        this._buildManagerReviewTemplates(run, { taskIdOverride, turnNonce }),
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
    const longJobHistoryPaths = this._taskLongJobHistoryPaths(run, taskId);
    const longJobHistoryRel = fileExists(longJobHistoryPaths.mdAbs) ? longJobHistoryPaths.mdRel : null;
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;
    const resumePacketPath = resumePacketRelForRole(run, "manager");

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        ...(resumePacketPath ? [resumePacketPath] : []),
        instructionsPath,
        docsRules,
        docsIndex,
        todoPath,
        decisionsPath,
        pipelineStatePath,
        `${taskDirRel}/task.md`,
        ...(longJobHistoryRel ? [longJobHistoryRel] : []),
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
        "Answer questions briefly and explicitly. Then update pipeline_state.json appropriately:",
        "- If the task already has developer outputs (dev_result.* exists): set developer_status=ready_for_review only when those outputs are still fresh for the current question/review.",
        "- For outcome-driven REWORK tasks, stale dev_result.* is not enough: if the required proof artifacts were not regenerated after manager_review.md, set developer_status=ongoing instead of ready_for_review.",
        "- Else if work should continue: set developer_status=ongoing.",
        "- Else if clarification is required: keep developer_status=blocked and ask a clear question.",
        ...(longJobHistoryRel ? [`Use ${longJobHistoryRel} if the blocker concerns crashes, reruns, or prior long-job evidence.`] : []),
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
      "\n   - If the latest question is Q-post-incident-*.md: write answers/A-post-incident-<id>.md and include at least 'Decision:' and 'Plan change:' lines." +
      `\n2) Update ${pipelineStatePath} with a correct developer_status (ready_for_review|ongoing|blocked) and a summary pointing to the answer file.` +
      "\n3) If the answer changes scope/requirements, update TODO/SPEC/DECISIONS accordingly." +
      (marker ? `\n4) Finally, write the turn marker ${marker.doneRel} (atomic via ${marker.tmpRel}) with content 'ok'.` : "");

    const retryBlock = retryReason
      ? `\n\nRETRY REQUIRED: ${retryReason}\nWrite the missing files now. Do not respond with a plan or narration.`
      : "";

    const intro =
      `\nAction required for task ${taskId}.\n` +
      "A question/blocker exists under the task folder. It may come from a developer OR from the orchestrator watchdog (e.g., AG stalled).\n" +
      "You must read the latest question file(s) and decide how to proceed (retry, change instructions, or switch developer).";

    return [header, "", String(run.managerPreprompt || ""), "", buildDynamicOptionsBlockForManager(run), intro, protocol, retryBlock].join("\n");
  }

  _taskHasDeveloperResultArtifacts(taskDir) {
    if (!taskDir) return false;
    const candidates = ["dev_result.json", "dev_result.md", "dev_result.markdown"];
    for (const name of candidates) {
      const p = path.join(taskDir, name);
      if (fileExists(p)) return true;
    }
    return false;
  }

  _extractArtifactPathCandidatesFromText(text) {
    const out = new Set();
    if (!text) return [];
    const push = (raw) => {
      const value = String(raw || "").trim();
      if (!value) return;
      if (!/[\\/]/.test(value) && !/^\.\.?(?:[\\/]|$)/.test(value) && !/^data[\\/]/i.test(value)) return;
      if (!/\.(?:json|md|markdown|txt|log|csv|tsv|png|jpg|jpeg|webp)$/i.test(value)) return;
      out.add(value.replaceAll("/", path.sep).replaceAll("\\", path.sep));
    };

    for (const match of String(text).matchAll(/`([^`\r\n]+)`/g)) push(match[1]);
    for (const match of String(text).matchAll(/\b(?:\.\.?(?:[\\/])|data[\\/])[^\s"'`()\]]+\.(?:json|md|markdown|txt|log|csv|tsv|png|jpg|jpeg|webp)\b/gi)) {
      push(match[0]);
    }
    return Array.from(out);
  }

  _resolveArtifactCandidateAbs(run, raw, { taskDir } = {}) {
    const candidate = String(raw || "").trim();
    if (!candidate) return null;
    const normalized = candidate.replaceAll("/", path.sep).replaceAll("\\", path.sep);
    const bases = [];
    if (taskDir) bases.push(taskDir);
    if (run.cwd) bases.push(run.cwd);
    if (run.workspaceCwd) bases.push(run.workspaceCwd);

    if (path.isAbsolute(normalized)) {
      const abs = path.resolve(normalized);
      return fileExists(abs) ? abs : null;
    }
    for (const base of bases) {
      const abs = path.resolve(base, normalized);
      if (fileExists(abs)) return abs;
    }
    return null;
  }

  _taskReferencedArtifactAbsPaths(run, { taskDir, includeReview = true } = {}) {
    const files = [
      path.join(taskDir, "task.md"),
      path.join(taskDir, "manager_instruction.md"),
      ...(includeReview ? [path.join(taskDir, "manager_review.md")] : []),
    ];
    const resolved = new Set();
    for (const filePath of files) {
      if (!fileExists(filePath)) continue;
      const text = readTextBestEffort(filePath, 120_000);
      const candidates = this._extractArtifactPathCandidatesFromText(text);
      for (const raw of candidates) {
        const abs = this._resolveArtifactCandidateAbs(run, raw, { taskDir });
        if (abs) resolved.add(abs);
      }
    }
    return Array.from(resolved);
  }

  _taskReferencedOutcomeProofArtifactAbsPaths(run, { taskDir, includeReview = true } = {}) {
    const files = [
      path.join(taskDir, "task.md"),
      path.join(taskDir, "manager_instruction.md"),
      ...(includeReview ? [path.join(taskDir, "manager_review.md")] : []),
    ];
    const resolved = new Set();
    for (const filePath of files) {
      if (!fileExists(filePath)) continue;
      const text = readTextBestEffort(filePath, 120_000);
      const lines = String(text || "").split(/\r?\n/);
      let skipHistoricalBlock = false;
      for (const line of lines) {
        const trimmed = String(line || "").trim();
        if (
          /\b(?:historical evidence|diagnostic only|background diagnostics?|old \d+p reports?|old reports remain diagnostic)\b/i.test(
            trimmed,
          )
        ) {
          skipHistoricalBlock = true;
          continue;
        }
        if (
          skipHistoricalBlock &&
          (/(?:^#{1,6}\s+)/.test(trimmed) || /^[A-Z][A-Za-z0-9 ()/_-]{1,80}:\s*$/.test(trimmed))
        ) {
          skipHistoricalBlock = false;
        }
        if (skipHistoricalBlock) continue;
        if (/\b(?:historical|diagnostic only|background only|do not use as current gate)\b/i.test(trimmed)) continue;
        const candidates = this._extractArtifactPathCandidatesFromText(line);
        for (const raw of candidates) {
          const abs = this._resolveArtifactCandidateAbs(run, raw, { taskDir });
          if (abs && this._isLikelyOutcomeProofArtifact(abs)) resolved.add(abs);
        }
      }
    }
    return this._filterOutcomeProofArtifactsForTaskScope(run, Array.from(resolved), { taskDir });
  }

  _devResultReferencedArtifactAbsPaths(run, { taskDir } = {}) {
    const files = [
      path.join(taskDir, "dev_result.md"),
      path.join(taskDir, "dev_result.markdown"),
      path.join(taskDir, "dev_result.json"),
    ];
    const resolved = new Set();
    for (const filePath of files) {
      if (!fileExists(filePath)) continue;
      const text = readTextBestEffort(filePath, 200_000);
      const candidates = this._extractArtifactPathCandidatesFromText(text);
      for (const raw of candidates) {
        const abs = this._resolveArtifactCandidateAbs(run, raw, { taskDir });
        if (abs) resolved.add(abs);
      }
    }
    return Array.from(resolved);
  }

  _artifactSemanticFreshnessMs(abs) {
    if (!abs || !fileExists(abs)) return 0;
    const st = safeStat(abs);
    const fallbackMtimeMs = st?.mtimeMs ?? 0;
    if (!/\.json$/i.test(abs)) return fallbackMtimeMs;
    const r = readJsonBestEffort(abs);
    if (!r.ok || !r.value || typeof r.value !== "object") return fallbackMtimeMs;
    const candidates = [
      r.value?.meta?.generated_at,
      r.value?.generated_at,
      r.value?.updated_at,
      r.value?.finished_at,
      r.value?.completed_at,
      r.value?.at,
    ];
    for (const candidate of candidates) {
      const ms = tryParseIsoToMs(candidate);
      if (ms) return ms;
    }
    return fallbackMtimeMs;
  }

  _reviewFreshnessBaselineMs(reviewAbs) {
    if (!reviewAbs || !fileExists(reviewAbs)) return 0;
    const reviewHead = readTextHead(reviewAbs, 12_000) || "";
    const reviewedAt = reviewHead.match(/\bReviewed_at\s*:\s*([^\r\n]+)/i)?.[1] || "";
    const reviewedAtMs = tryParseIsoToMs(reviewedAt);
    if (reviewedAtMs) return reviewedAtMs;
    return safeStat(reviewAbs)?.mtimeMs ?? 0;
  }

  _isLikelyOutcomeProofArtifact(abs) {
    if (!abs || !/\.json$/i.test(abs)) return false;
    const normalized = String(abs).replace(/\\/g, "/").toLowerCase();
    if (normalized.includes("/reports/")) return true;
    return false;
  }

  _filterOutcomeProofArtifactsForTaskScope(run, artifacts, { taskDir } = {}) {
    const list = Array.isArray(artifacts) ? artifacts.filter(Boolean) : [];
    if (!list.length) return [];
    const expectedMode = this._taskExpectedPlayerMode(run, { taskDir });
    if (!expectedMode) return Array.from(new Set(list));
    const scoped = list.filter((abs) => {
      const name = path.basename(String(abs || "")).toLowerCase();
      if (expectedMode === "3p") {
        if (name.includes("_2p.")) return false;
        return true;
      }
      if (expectedMode === "2p") {
        if (name.includes("_3p.")) return false;
        return true;
      }
      return true;
    });
    return Array.from(new Set(scoped));
  }

  _taskReferencedEvidenceMtimeMs(run, { taskDir, includeReview = true } = {}) {
    let evidenceMtimeMs = 0;
    for (const abs of this._taskReferencedArtifactAbsPaths(run, { taskDir, includeReview })) {
      const st = safeStat(abs);
      if (st && typeof st.mtimeMs === "number" && st.mtimeMs > evidenceMtimeMs) evidenceMtimeMs = st.mtimeMs;
    }
    return evidenceMtimeMs;
  }

  _devResultReferencedEvidenceMtimeMs(run, { taskDir } = {}) {
    let evidenceMtimeMs = 0;
    for (const abs of this._devResultReferencedArtifactAbsPaths(run, { taskDir })) {
      if (!this._isLikelyOutcomeProofArtifact(abs)) continue;
      const freshnessMs = this._artifactSemanticFreshnessMs(abs);
      if (freshnessMs > evidenceMtimeMs) evidenceMtimeMs = freshnessMs;
    }
    return evidenceMtimeMs;
  }

  _validateDevResultReferencedArtifactsFresh(run, { taskDir, taskId, baselineMs = 0, baselineLabel = "" } = {}) {
    const proofArtifacts = this._devResultReferencedArtifactAbsPaths(run, { taskDir })
      .filter((abs) => this._isLikelyOutcomeProofArtifact(abs));
    if (!proofArtifacts.length || !baselineMs) return { ok: true };
    const staleProofs = [];
    for (const abs of proofArtifacts) {
      const freshnessMs = this._artifactSemanticFreshnessMs(abs);
      if (!freshnessMs || freshnessMs <= baselineMs) staleProofs.push(abs);
    }
    if (!staleProofs.length) return { ok: true };
    const staleRel = staleProofs.map((abs) => relPathForPrompt(run.cwd, abs)).slice(0, 4);
    return {
      ok: false,
      reason:
        `Outcome-driven REWORK for ${taskId}: dev_result.* references stale report artifacts (${staleRel.join(", ")}). ` +
        `Regenerate or update those reports before setting developer_status=ready_for_review; ` +
        `the cited evidence must be newer than ${baselineLabel || "the current manager review"}.`,
    };
  }

  _validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId } = {}) {
    const reviewAbs = path.join(taskDir, "manager_review.md");
    if (!fileExists(reviewAbs)) return { ok: true };
    const reviewHead = readTextHead(reviewAbs, 12_000) || "";
    const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
    const outcomeDriven =
      taskMeta.outcomeDriven ||
      /\bGoal check\s*:/i.test(reviewHead) ||
      /\bRerun justification\s*:/i.test(reviewHead);
    if (!outcomeDriven) return { ok: true };
    if (!/\bDecision\s*:\s*\*\*REWORK\*\*/i.test(reviewHead) && !/\bDecision\s*:\s*REWORK\b/i.test(reviewHead)) {
      return { ok: true };
    }

    const reviewMtimeMs = this._reviewFreshnessBaselineMs(reviewAbs);
    if (!reviewMtimeMs) return { ok: true };
    const reviewRel = relPathForPrompt(run.cwd, reviewAbs);

    const devResultEvidence = this._validateDevResultReferencedArtifactsFresh(run, {
      taskDir,
      taskId,
      baselineMs: reviewMtimeMs,
      baselineLabel: reviewRel,
    });
    if (!devResultEvidence.ok) return devResultEvidence;

    const proofArtifacts = this._taskReferencedOutcomeProofArtifactAbsPaths(run, { taskDir, includeReview: false });
    if (proofArtifacts.length) {
      const staleProofs = [];
      for (const abs of proofArtifacts) {
        const freshnessMs = this._artifactSemanticFreshnessMs(abs);
        if (!freshnessMs || freshnessMs <= reviewMtimeMs) staleProofs.push(abs);
      }
      if (!staleProofs.length) {
        return { ok: true };
      }
      const staleRel = staleProofs.map((abs) => relPathForPrompt(run.cwd, abs)).slice(0, 4);
      return {
        ok: false,
        reason:
          `Outcome-driven REWORK for ${taskId}: stale proof artifacts (${staleRel.join(", ")}). ` +
          `Before setting developer_status=ready_for_review, regenerate each required report with embedded freshness ` +
          `newer than ${reviewRel} (for JSON reports, e.g. meta.generated_at). Rewriting dev_result.* alone is insufficient.`,
      };
    }

    const referencedEvidenceMtimeMs = this._taskReferencedEvidenceMtimeMs(run, { taskDir, includeReview: false });
    if (referencedEvidenceMtimeMs > reviewMtimeMs) {
      return { ok: true };
    }

    const fallbackEvidenceMtimeMs = this._taskResultEvidenceMtimeMs(run, { taskDir });
    if (!referencedEvidenceMtimeMs && fallbackEvidenceMtimeMs > reviewMtimeMs) {
      return { ok: true };
    }

    const reportsHint = this._taskReferencedOutcomeProofArtifactAbsPaths(run, { taskDir, includeReview: false })
      .map((abs) => relPathForPrompt(run.cwd, abs))
      .filter((rel) => /\.json$/i.test(rel))
      .slice(0, 3);
    const artifactsText = reportsHint.length ? ` (${reportsHint.join(", ")})` : "";
    return {
      ok: false,
      reason:
        `Outcome-driven REWORK for ${taskId}: stale evidence. Before setting developer_status=ready_for_review, ` +
        `overwrite the required proof artifacts${artifactsText} with files newer than ${reviewRel}. ` +
        `Rewriting dev_result.* alone is insufficient.`,
    };
  }

  _taskHasActiveManagerRework(taskDir) {
    try {
      const reviewAbs = path.join(taskDir, "manager_review.md");
      if (!fileExists(reviewAbs)) return false;
      const head = readTextHead(reviewAbs, 12_000) || "";
      return /\bDecision\s*:\s*\*\*REWORK\*\*/i.test(head) || /\bDecision\s*:\s*REWORK\b/i.test(head);
    } catch {
      return false;
    }
  }

  _longJobRequestTargetPath(value, argv = []) {
    const parts = Array.isArray(argv) ? argv.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const launchKind = value && typeof value.launch_kind === "string" ? String(value.launch_kind).trim().toLowerCase() : "";
    const explicitScript = value && typeof value.script_path === "string" ? String(value.script_path).trim() : "";
    if (explicitScript) return explicitScript;
    if (!parts.length) return "";
    const first = parts[0].toLowerCase();
    if (first === "node" || first.endsWith("\\node.exe") || first.endsWith("/node.exe")) {
      for (let i = 1; i < parts.length; i += 1) {
        const candidate = parts[i];
        if (!candidate || candidate.startsWith("-")) continue;
        return candidate;
      }
      return "";
    }
    if (first === "powershell.exe" || first === "pwsh" || first === "pwsh.exe") {
      const idx = parts.findIndex((item) => item.toLowerCase() === "-file");
      if (idx >= 0 && idx + 1 < parts.length) return parts[idx + 1];
      return "";
    }
    if (first === "cmd.exe" || first === "cmd") {
      const last = parts[parts.length - 1] || "";
      return last.startsWith("-") ? "" : last;
    }
    if (launchKind === "argv") return parts[0] || "";
    return parts[0] || "";
  }

  _longJobRequestLooksProtocolAware(value) {
    if (!value || typeof value !== "object") return false;
    const launchKind = typeof value.launch_kind === "string" ? String(value.launch_kind).trim().toLowerCase() : "";
    const scriptPath = typeof value.script_path === "string" ? String(value.script_path).trim() : "";
    if (launchKind === "script" && scriptPath) return true;
    const argv = Array.isArray(value.command_argv) ? value.command_argv : [];
    const target = this._longJobRequestTargetPath(value, argv);
    if (!target) return false;
    const normalized = target.replace(/\\/g, "/").toLowerCase();
    return normalized.includes("/scripts/");
  }

  _taskExpectedPlayerMode(run, { taskDir } = {}) {
    const artifactNames = this._taskReferencedArtifactAbsPaths(run, { taskDir, includeReview: false })
      .map((abs) => path.basename(abs).toLowerCase());
    const artifact3pCount = artifactNames.filter((name) => name.includes("_3p.")).length;
    const artifact2pCount = artifactNames.filter((name) => name.includes("_2p.")).length;
    if (artifact3pCount && !artifact2pCount) return "3p";
    if (artifact2pCount && !artifact3pCount) return "2p";

    const taskText = readTextBestEffort(path.join(taskDir, "task.md"), 40_000);
    const managerInstruction = readTextBestEffort(path.join(taskDir, "manager_instruction.md"), 40_000);
    const combined = `${taskText}\n${managerInstruction}`;
    const text3pCount = (combined.match(/\b(?:3p|3 players?|3-player)\b/gi) || []).length;
    const text2pCount = (combined.match(/\b(?:2p|2 players?|2-player)\b/gi) || []).length;
    const score3p = artifact3pCount * 2 + text3pCount;
    const score2p = artifact2pCount * 2 + text2pCount;
    if (score3p > score2p) return "3p";
    if (score2p > score3p) return "2p";
    return null;
  }

  _resolveLongJobRequestScriptAbs(run, value) {
    const argv = Array.isArray(value?.command_argv) ? value.command_argv : [];
    const target = this._longJobRequestTargetPath(value, argv);
    if (!target) return "";
    if (path.isAbsolute(target)) return target;
    return path.resolve(run.cwd, target);
  }

  _inferLongJobRequestProfile(run, value) {
    const scriptAbs = this._resolveLongJobRequestScriptAbs(run, value);
    const scriptRel = scriptAbs ? relPathForPrompt(run.cwd, scriptAbs) : "";
    const sources = [];
    const pushSource = (text, opts = {}) => {
      if (typeof text !== "string" || !text) return;
      sources.push({
        text,
        baseDir: opts.baseDir || run.cwd,
        nestedRootDir: opts.nestedRootDir || "",
      });
    };
    if (value && typeof value.script_path === "string") pushSource(String(value.script_path));
    if (Array.isArray(value?.command_argv)) {
      value.command_argv.forEach((item) => pushSource(String(item || "")));
    }
    if (scriptAbs && fileExists(scriptAbs)) {
      const scriptText = readTextBestEffort(scriptAbs, 20_000);
      pushSource(scriptText, { baseDir: path.dirname(scriptAbs) });
      const nestedMatch = scriptText.match(/node\s+([^\r\n]+?\.mjs)\b/i);
      if (nestedMatch && nestedMatch[1]) {
        const nestedAbs = path.resolve(path.dirname(scriptAbs), nestedMatch[1].replace(/^"+|"+$/g, ""));
        if (fileExists(nestedAbs)) {
          pushSource(readTextBestEffort(nestedAbs, 30_000), {
            baseDir: path.dirname(nestedAbs),
            nestedRootDir: path.resolve(path.dirname(nestedAbs), ".."),
          });
        }
      }
    }
    const haystack = sources.map((entry) => entry.text).join("\n").replace(/\\/g, "/").toLowerCase();
    let playerMode = null;
    if (/(?:_3p(?:_|\.|\b)|3-player|3 players?|--players(?:\s+|['",])3\b|players?\s*[:=]\s*3\b)/i.test(haystack)) {
      playerMode = "3p";
    } else if (/(?:_2p(?:_|\.|\b)|2-player|2 players?|--players(?:\s+|['",])2\b|players?\s*[:=]\s*2\b)/i.test(haystack)) {
      playerMode = "2p";
    }
    let policyKind = null;
    if (/(?:easy_vs_easy|easy_sanity|--policy(?:\s+|['",])easy\b|policy\s*[:=]\s*easy\b)/i.test(haystack)) {
      policyKind = "easy";
    } else if (/(?:medium_vs_medium|medium_sanity|--policy(?:\s+|['",])medium\b|policy\s*[:=]\s*medium\b)/i.test(haystack)) {
      policyKind = "medium";
    }
    const outputArtifacts = [];
    const seenOutputs = new Set();
    const addOutputArtifact = (filename, abs) => {
      const cleanName = String(filename || "").trim();
      const cleanAbs = String(abs || "").trim();
      if (!cleanName || !cleanAbs) return;
      const key = `${cleanName}::${cleanAbs}`.toLowerCase();
      if (seenOutputs.has(key)) return;
      seenOutputs.add(key);
      outputArtifacts.push({ filename: cleanName, abs: cleanAbs });
    };
    for (const entry of sources) {
      const text = String(entry.text || "");
      const baseDir = entry.baseDir || run.cwd;
      const nestedRootDir = entry.nestedRootDir || "";
      const outputPattern = /reports[\\/](?<filename>[a-z0-9_.-]+\.json)\b/gi;
      let outputMatch;
      while ((outputMatch = outputPattern.exec(text))) {
        const filename = outputMatch.groups?.filename || outputMatch[1] || "";
        addOutputArtifact(filename, path.resolve(baseDir, "reports", filename));
        if (nestedRootDir) addOutputArtifact(filename, path.resolve(nestedRootDir, "reports", filename));
      }
      const rootResolvePattern = /resolve\(\s*rootDir\s*,\s*['"]reports[\\/](?<filename>[a-z0-9_.-]+\.json)['"]\s*\)/gi;
      let rootResolveMatch;
      while ((rootResolveMatch = rootResolvePattern.exec(text))) {
        const filename = rootResolveMatch.groups?.filename || rootResolveMatch[1] || "";
        if (nestedRootDir) addOutputArtifact(filename, path.resolve(nestedRootDir, "reports", filename));
      }
      const outputRelPattern = /outputRel\s*:\s*['"]reports[\\/](?<filename>[a-z0-9_.-]+\.json)['"]/gi;
      let outputRelMatch;
      while ((outputRelMatch = outputRelPattern.exec(text))) {
        const filename = outputRelMatch.groups?.filename || outputRelMatch[1] || "";
        if (nestedRootDir) addOutputArtifact(filename, path.resolve(nestedRootDir, "reports", filename));
      }
    }
    return { scriptAbs, scriptRel, playerMode, policyKind, outputArtifacts };
  }

  _pruneLongJobRequestFile(requestPath) {
    try {
      if (requestPath && fs.existsSync(requestPath)) fs.rmSync(requestPath, { force: true });
      return true;
    } catch {
      return false;
    }
  }

  _requestWasSupersededByFreshOutput(requestValue, profile) {
    if (!requestValue || typeof requestValue !== "object") return false;
    const createdAtMs = tryParseIsoToMs(requestValue.created_at) ?? 0;
    if (!createdAtMs) return false;
    const outputs = Array.isArray(profile?.outputArtifacts) ? profile.outputArtifacts : [];
    return outputs.some((artifact) => {
      const abs = artifact?.abs ? String(artifact.abs) : "";
      if (!abs || !fileExists(abs)) return false;
      const mtimeMs = safeStat(abs)?.mtimeMs ?? 0;
      return mtimeMs > createdAtMs;
    });
  }

  _collectUsableLongJobRequests(run, { taskId } = {}) {
    try {
      longJob.ensureJobsLayout(run.cwd);
      const reqFiles = longJob.listJobRequestFiles(run.cwd);
      const effectiveTaskId = taskId || run.currentTaskId || null;
      const usable = [];
      for (const p of reqFiles) {
        const r = longJob.readJsonBestEffort(p);
        if (!r.ok || !r.value || typeof r.value !== "object") continue;
        if (String(r.value.schema || "") !== "antidex.long_job.request.v1") continue;
        if (!this._jobRequestMatchesRun(run, r.value)) continue;
        if (!this._longJobRequestLooksProtocolAware(r.value)) continue;
        const reqTaskId = r.value.task_id ? String(r.value.task_id) : effectiveTaskId;
        const reqTaskDir = reqTaskId ? path.join(run.cwd, "data", "tasks", reqTaskId) : null;
        if (reqTaskId && reqTaskDir) {
          const requestCheck = this._validateLongJobRequestAgainstTask(run, {
            taskDir: reqTaskDir,
            taskId: reqTaskId,
            requestValue: r.value,
          });
          if (!requestCheck.ok) {
            this._pruneLongJobRequestFile(p);
            continue;
          }
        }
        const profile = this._inferLongJobRequestProfile(run, r.value);
        if (this._requestWasSupersededByFreshOutput(r.value, profile)) {
          this._pruneLongJobRequestFile(p);
          continue;
        }
        usable.push({ path: p, request: r.value, profile });
      }
      return usable;
    } catch {
      return [];
    }
  }

  _validateLongJobRequestAgainstTask(run, { taskDir, taskId, requestValue } = {}) {
    if (!run?.cwd || !taskDir || !taskId || !requestValue || typeof requestValue !== "object") return { ok: true };
    const profile = this._inferLongJobRequestProfile(run, requestValue);
    const expectedMode = this._taskExpectedPlayerMode(run, { taskDir });
    if (expectedMode && profile.playerMode && profile.playerMode !== expectedMode) {
      return {
        ok: false,
        reason:
          `Long-job request for ${taskId} targets ${profile.playerMode} evidence via ${profile.scriptRel || "the requested wrapper"}, ` +
          `but the task is currently scoped to ${expectedMode}.`,
      };
    }

    const managerInstruction = readTextBestEffort(path.join(taskDir, "manager_instruction.md"), 60_000);
    const easyControlFirst =
      /easy_vs_easy_sanity_3p\.json/i.test(managerInstruction) &&
      /run the\s+easy\s+3p\s+control\s+first/i.test(managerInstruction) &&
      /do not .*medium/i.test(managerInstruction);
    const easy3pReportAbs = path.join(run.cwd, "reports", "easy_vs_easy_sanity_3p.json");
    if (easyControlFirst && !fileExists(easy3pReportAbs) && profile.policyKind === "medium") {
      return {
        ok: false,
        reason:
          `Long-job request for ${taskId} launched a MEDIUM benchmark before the required EASY 3p control existed. ` +
          `Generate reports/easy_vs_easy_sanity_3p.json first.`,
      };
    }
    return { ok: true };
  }

  async _maybePromoteCurrentTaskToReadyForReview(runId, { reason } = {}) {
    const run = this._getRunRequired(runId);
    if (!run.cwd || !run.projectPipelineStatePath) return false;
    if (!run.currentTaskId) return false;
    if (run.developerStatus === "ready_for_review" || run.developerStatus === "blocked" || run.developerStatus === "failed") return false;

    const { taskDir, taskId } = taskContext(run);
    if (!this._taskHasDeveloperResultArtifacts(taskDir)) return false;

    // If the Manager explicitly requested REWORK for this task, do NOT auto-promote based on
    // the mere presence of existing dev_result.* from a previous attempt.
    // Outcome-driven tasks require fresh proof artifacts, not only a rewritten summary file.
    try {
      const fresh = this._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
      if (!fresh.ok) return false;

      const reviewAbs = path.join(taskDir, "manager_review.md");
      if (fileExists(reviewAbs)) {
        const head = readTextHead(reviewAbs, 4000) || "";
        const hasRework = /\bREWORK\b/i.test(head);
        if (hasRework) {
          const reviewMtimeMs = safeStat(reviewAbs)?.mtimeMs ?? 0;
          const evidenceMtimeMs = this._taskResultEvidenceMtimeMs(run, { taskDir });
          // If we have no evidence mtime, fall back to blocking promotion (safe).
          if (!evidenceMtimeMs || evidenceMtimeMs <= reviewMtimeMs) return false;
        }
      }
    } catch {
      // If anything goes wrong here, prefer NOT promoting (safer than causing a loop).
      return false;
    }

    // For AG tasks, do NOT auto-promote on mere presence of dev_result.json.
    // Require a successful referenced result.json, otherwise we can loop on "error/blocked" artifacts.
    if (run.assignedDeveloper === "developer_antigravity") {
      try {
        const ptrAbs = path.join(taskDir, "dev_result.json");
        if (!fileExists(ptrAbs)) return false;
        const ptr = readJsonBestEffort(ptrAbs);
        if (!ptr.ok || !ptr.value || typeof ptr.value !== "object") return false;
        const resPath = typeof ptr.value.result_path === "string" ? String(ptr.value.result_path) : "";
        if (!resPath) return false;
        const resAbs = path.isAbsolute(resPath) ? resPath : path.join(run.cwd, resPath);
        if (!fileExists(resAbs)) return false;
        const res = readJsonBestEffort(resAbs);
        if (!res.ok || !res.value || typeof res.value !== "object") return false;
        const status = typeof res.value.status === "string" ? String(res.value.status).trim().toLowerCase() : "";
        if (status !== "done" && status !== "ok" && status !== "success") return false;
      } catch {
        return false;
      }
    }

    const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
    if (!stateRead.ok || !stateRead.value || typeof stateRead.value !== "object") return false;
    const st = stateRead.value;

    const curTask = typeof st.current_task_id === "string" ? String(st.current_task_id) : null;
    if (curTask && curTask !== taskId) return false; // avoid promoting the wrong task if drifted mid-step

    const currentDev = normalizeDeveloperStatus(st.developer_status);
    if (currentDev === "ready_for_review") return false;

    st.developer_status = "ready_for_review";
    st.manager_decision = st.manager_decision ?? null;
    const atIso = nowIso();
    const why = reason ? ` (${reason})` : "";
    const existingSummary = typeof st.summary === "string" ? String(st.summary) : "";
    const promoteMsg = `Auto-reconcile: detected existing ${path.join("data", "tasks", taskId, "dev_result.*")} -> developer_status=ready_for_review${why}.`;
    st.summary = existingSummary ? `${existingSummary}\n${promoteMsg}` : promoteMsg;
    st.updated_at = atIso;

    try {
      writeJsonAtomic(run.projectPipelineStatePath, st);
    } catch {
      return false;
    }

    // Keep in-memory state aligned for immediate step selection.
    run.developerStatus = "ready_for_review";
    this._setRun(runId, run);
    this.emit("event", {
      runId,
      event: "diag",
      data: { role: "system", type: "info", message: `Promoted ${taskId} to ready_for_review based on existing dev_result artifacts.` },
    });
    return true;
  }

  async _stepManagerPlanning(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    const baselinePipelineStateMtimeMs = safeStat(run.projectPipelineStatePath)?.mtimeMs ?? 0;

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
        // Guardrail: TODO items must be dispatchable (no "(Manager)" owner lines).
        try {
          const todoText = readTextBestEffort(run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
          if (todoHasDisallowedManagerOwner(todoText)) {
            const relTodo = relPathForPrompt(run.cwd, run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
            return {
              ok: false,
              reason:
                `Invalid ${relTodo}: TODO must not contain (Manager) items. ` +
                `Rewrite TODO so each item is assigned to developer_codex or developer_antigravity (doc tasks are still dev tasks).`,
            };
          }
        } catch {
          // ignore
        }
        if (!run.currentTaskId) return { ok: false, reason: `Missing current_task_id in ${run.projectPipelineStatePath}` };
        if (!run.assignedDeveloper) return { ok: false, reason: `Missing assigned_developer in ${run.projectPipelineStatePath}` };
        if (run.projectPipelineStateFileMtimeMs !== null && run.projectPipelineStateFileMtimeMs <= baselinePipelineStateMtimeMs) {
          return { ok: false, reason: `pipeline_state.json was not updated during this planning turn (${run.projectPipelineStatePath})` };
        }
        const { taskDir } = taskContext(run);
        const taskMd = path.join(taskDir, "task.md");
        const instr = path.join(taskDir, "manager_instruction.md");
        if (!fileExists(taskMd)) {
          const rel = relPathForPrompt(run.cwd, taskMd);
          return { ok: false, reason: `Missing required file: ${rel} (${taskMd})` };
        }
        if (!fileExists(instr)) {
          const rel = relPathForPrompt(run.cwd, instr);
          return { ok: false, reason: `Missing required file: ${rel} (${instr})` };
        }
        return { ok: true };
      },
      maxAttempts: 3,
    });

    const updated = this._getRunRequired(runId);
    if (this._shouldPreserveTerminalRunState(runId)) return;
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Manager planning postconditions failed", at: nowIso(), where: "manager/planning" };
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
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

    if (!this._ensureTaskSpecOrBlock(runId, { context: "developer/dispatch" })) return;
    this._refreshTaskLongJobHistory(runId);

    if (run.assignedDeveloper === "manager") {
      this._blockManagerForAssignedDeveloperManager(runId, { context: "developer/dispatch" });
      return;
    }

    if (run.assignedDeveloper === "developer_antigravity") {
      await this._stepDeveloperAntigravity(runId);
      return;
    }
    if (run.assignedDeveloper && run.assignedDeveloper !== "developer_codex") {
      run.status = "failed";
      run.lastError = {
        message: `Assigned developer ${run.assignedDeveloper} is not supported`,
        at: nowIso(),
        where: "developer/dispatch",
      };
      this._setRun(runId, run);
      this._releaseRunningLock(runId);
      return;
    }

    run.status = "implementing";
    run.developerStatus = "ongoing";
    this._setRun(runId, run);

    const implementingTaskId = run.currentTaskId || null;
    if (!this._bumpDispatchCountOrBlock(runId, { taskIdOverride: implementingTaskId, developer: "developer_codex", limit: 5, context: "developer_codex" })) {
      return;
    }
    const threadId = await this._ensureThread({ runId, role: "developer" });
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "developer",
      step: "implementing",
      threadId,
      model: run.developerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) =>
        this._buildDeveloperPrompt(run, { turnNonce, retryReason, taskIdOverride: implementingTaskId }),
      verifyPostconditions: async ({ run }) => {
        const { taskDir, taskId } = taskContext(run, implementingTaskId);
        const ack = path.join(taskDir, "dev_ack.json");
        const resultMd = path.join(taskDir, "dev_result.md");
        const resultJson = path.join(taskDir, "dev_result.json");
        const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
        if (!fileExists(ack)) {
          const rel = relPathForPrompt(run.cwd, ack);
          return { ok: false, reason: `Missing required file for ${taskId}: ${rel} (${ack})` };
        }
        if (!fileExists(resultMd) && !fileExists(resultJson)) {
          const relMd = relPathForPrompt(run.cwd, resultMd);
          const relJson = relPathForPrompt(run.cwd, resultJson);
          return { ok: false, reason: `Missing required file for ${taskId}: ${relMd} or ${relJson}` };
        }
        if (run.developerStatus !== "ready_for_review" && run.developerStatus !== "waiting_job" && run.developerStatus !== "blocked") {
          const promoted = this._autoPromoteDeveloperStatusFromEvidence(run, { taskId });
          if (!promoted.ok) {
            return {
              ok: false,
              reason: promoted.reason || `developer_status is ${run.developerStatus || "(missing)"} (expected ready_for_review|waiting_job|blocked)`,
            };
          }
        }
        if (run.developerStatus === "blocked") {
          const questionsDir = path.join(taskDir, "questions");
          let hasQuestion = false;
          try {
            const ents = fs.existsSync(questionsDir) ? fs.readdirSync(questionsDir) : [];
            hasQuestion = ents.some((n) => /^Q-.*\.md$/i.test(n));
          } catch {
            hasQuestion = false;
          }
          if (!hasQuestion) {
            return {
              ok: false,
              reason: `developer_status=blocked for ${taskId} requires a question under ${relPathForPrompt(run.cwd, questionsDir)}`,
            };
          }
        }
        if (run.developerStatus === "ready_for_review" && taskMeta.outcomeDriven) {
          const freshEvidence = this._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
          if (!freshEvidence.ok) return freshEvidence;
          if (fileExists(resultMd)) {
            const resultText = readTextBestEffort(resultMd, 200_000);
            const check = validateOutcomeSuggestionMarkdown(resultText);
            if (!check.ok) {
              return {
                ok: false,
                reason:
                  `Outcome-driven task ${taskId}: ${relPathForPrompt(run.cwd, resultMd)} must include 'What this suggests next:' with ` +
                  `${check.missing.join(", ")}.`,
              };
            }
          } else {
            const resultRead = readJsonBestEffort(resultJson);
            if (!resultRead.ok || !resultRead.value || typeof resultRead.value !== "object") {
              return {
                ok: false,
                reason: `Outcome-driven task ${taskId}: invalid ${relPathForPrompt(run.cwd, resultJson)} (expected JSON with what_this_suggests_next).`,
              };
            }
            const suggestion = getOutcomeSuggestionObject(resultRead.value);
            const check = validateOutcomeSuggestionObject(suggestion);
            if (!check.ok) {
              return {
                ok: false,
                reason:
                  `Outcome-driven task ${taskId}: ${relPathForPrompt(run.cwd, resultJson)} must include what_this_suggests_next with ` +
                  `${check.missing.join(", ")}.`,
              };
            }
          }
        }
        if (run.developerStatus === "waiting_job") {
          // Long-job protocol: require a job request in data/jobs/requests (or an already-started job.json).
          try {
            longJob.ensureJobsLayout(run.cwd);
            const reqFiles = longJob.listJobRequestFiles(run.cwd);
            const matchingReqs = reqFiles.map((p) => ({ path: p, read: longJob.readJsonBestEffort(p) })).filter(({ read }) => {
              if (!read.ok || !read.value || typeof read.value !== "object") return false;
              const rid = read.value.run_id ? String(read.value.run_id) : "";
              const tid = read.value.task_id ? String(read.value.task_id) : "";
              if (rid && rid !== run.runId) return false;
              if (tid && tid !== taskId) return false;
              return true;
            });
            const okReq = matchingReqs.some(({ read }) => this._longJobRequestLooksProtocolAware(read.value));
            const okJob = this._hasProtocolAwareLiveLongJob(run, taskId);
            if (!matchingReqs.length && !okJob) {
              const reqDirRel = relPathForPrompt(run.cwd, longJob.jobRequestsDirAbs(run.cwd));
              return { ok: false, reason: `developer_status=waiting_job but no matching request found under ${reqDirRel}` };
            }
            if (!okReq && !okJob) {
              return {
                ok: false,
                reason:
                  `developer_status=waiting_job for ${taskId} requires a protocol-aware long-job wrapper under scripts/. ` +
                  `Use tools\\antidex.cmd job start --script .\\scripts\\<wrapper>.cmd (or argv pointing to a script under scripts/) so the job writes heartbeat/progress/result.`,
              };
            }
            for (const { read } of matchingReqs) {
              if (!this._longJobRequestLooksProtocolAware(read.value)) continue;
              const requestCheck = this._validateLongJobRequestAgainstTask(run, { taskDir, taskId, requestValue: read.value });
              if (!requestCheck.ok) return { ok: false, reason: requestCheck.reason || `Long-job request for ${taskId} does not match task scope.` };
            }
          } catch {
            // ignore; the supervisor will validate again
          }
        }
        return { ok: true };
      },
      maxAttempts: 3,
    });

    const updated = this._getRunRequired(runId);
    if (this._shouldPreserveTerminalRunState(runId)) return;
    if (!attempt.ok) {
      updated.status = "failed";
      updated.lastError = { message: attempt.errorMessage || "Developer postconditions failed", at: nowIso(), where: "developer" };
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
      return;
    }

    const after = this._getRunRequired(runId);
    if (after.developerStatus === "ready_for_review") {
      after.status = "reviewing";
      this._setRun(runId, after);
    } else if (after.developerStatus === "blocked") {
      after.status = "implementing";
      this._setRun(runId, after);
      await this._stepManagerAnswerQuestion(runId);
    } else if (after.developerStatus === "waiting_job") {
      const pendingReq = this._pickNextLongJobRequest(after);
      if (pendingReq) this._clearActiveLongJobReference(after, { preserveLastJobId: true });
      after.status = "waiting_job";
      this._setRun(runId, after);
    }
  }

  _appendAgLog(logPath, line) {
    if (!logPath || !line) return;
    try {
      ensureDir(path.dirname(logPath));
      fs.appendFileSync(logPath, String(line) + os.EOL, { encoding: "utf8" });
    } catch {
      // best-effort
    }
  }

  _emitAg(runId, event, data) {
    this.emit("event", { runId, event, data: { ...(data || {}), role: "developer_antigravity" } });
  }

  async _stepDeveloperAntigravity(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    if (!this._ensureTaskSpecOrBlock(runId, { context: "developer_antigravity/dispatch" })) return;

    const baseUrl = run.connectorBaseUrl ? String(run.connectorBaseUrl).trim() : "";
    if (!baseUrl) {
      run.status = "failed";
      run.lastError = { message: "connectorBaseUrl is missing (cannot dispatch to developer_antigravity)", at: nowIso(), where: "ag/dispatch" };
      this._setRun(runId, run);
      this._releaseRunningLock(runId);
      return;
    }

    run.status = "implementing";
    run.developerStatus = "ongoing";
    this._setRun(runId, run);

    const { taskId, taskDir, taskDirRel } = taskContext(run);
    const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
    const isOutcomeDriven = taskMeta.outcomeDriven;
    const agExpectedSilenceMs = readAgExpectedSilenceMs(taskDir);

    // Recovery guard: after 3 watchdog stalls for the same task, stop dispatching to AG automatically.
    if (this._blockAgAfterStalls(runId, { taskIdOverride: taskId })) return;

    if (!this._bumpDispatchCountOrBlock(runId, { taskIdOverride: taskId, developer: "developer_antigravity", limit: 3, context: "developer_antigravity" })) {
      return;
    }
    const turnNonce = this._newTurnNonce();
    const marker = turnMarkerPaths(run, turnNonce);

    const agLogPath = path.join(this._logsDir, `run_${runId.slice(0, 8)}_developer_antigravity_${nowIsoForFile()}_assistant.txt`);
    const startMeta = { step: "dispatching", threadId: null, turnId: null, model: "antigravity", assistantLogPath: agLogPath, rpcLogPath: null };
    this._emitAg(runId, "meta", startMeta);
    this._appendAgLog(agLogPath, `[meta] task=${taskId} cwd=${run.cwd}`);

    try {
      const r = this._getRunRequired(runId);
      if (!Array.isArray(r.logFiles)) r.logFiles = [];
      const startedAtMs = Date.now();
      r.logFiles.push({
        role: "developer_antigravity",
        step: "implementing",
        assistantLogPath: agLogPath,
        rpcLogPath: null,
        startedAtMs,
      });
      r.activeTurn = {
        role: "developer_antigravity",
        step: "dispatching",
        threadId: null,
        turnId: null,
        startedAtMs,
        assistantLogPath: agLogPath,
        rpcLogPath: null,
      };
      this._setRun(runId, r);
    } catch {
      // ignore
    }

    const connector = this._ensureConnector({ baseUrl });

    // Create (or reuse) an AG run folder per task attempt.
    let agRunId = null;
    const pointerPath = path.join(taskDir, "dev_result.json");
    const pointerRead = readJsonBestEffort(pointerPath);
    if (pointerRead.ok && pointerRead.value && typeof pointerRead.value === "object" && pointerRead.value.run_id) {
      agRunId = String(pointerRead.value.run_id);
    }

    const { runId: finalAgRunId, paths } = initAgRun({
      projectCwd: run.cwd,
      runId: agRunId,
      taskId,
      requestText: "",
    });
    agRunId = finalAgRunId;

    const requestRel = relPathForPrompt(run.cwd, paths.requestPath);
    const ackRel = relPathForPrompt(run.cwd, paths.ackPath);
    const resultRel = relPathForPrompt(run.cwd, paths.resultPath);
    const resultTmpRel = relPathForPrompt(run.cwd, paths.resultTmpPath);
    const artifactsRel = relPathForPrompt(run.cwd, paths.artifactsDir);
    const heartbeatAbs = path.join(run.cwd, "data", "AG_internal_reports", "heartbeat.json");

    const instructionsRel = relPathForPrompt(run.cwd, run.projectDeveloperAgInstructionPath || path.join(run.cwd, "agents", "developer_antigravity.md"));
    const cursorRulesRel = relPathForPrompt(run.cwd, run.projectAgCursorRulesPath || path.join(run.cwd, "agents", "AG_cursorrules.md"));
    const pipelineStateRel = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const taskMdRel = `${taskDirRel}/task.md`;
    const managerInstrRel = `${taskDirRel}/manager_instruction.md`;
    const managerReviewAbs = path.join(taskDir, "manager_review.md");
    const managerReviewRel = `${taskDirRel}/manager_review.md`;
    let managerReviewText = null;
    let isRework = false;
    try {
      if (fileExists(managerReviewAbs)) {
        managerReviewText = fs.readFileSync(managerReviewAbs, "utf8");
        isRework =
          /\bDecision:\s*\*\*?\s*REWORK\s*\*\*?/i.test(managerReviewText) ||
          /\bDecision:\s*REWORK\b/i.test(managerReviewText);
      }
    } catch {
      // ignore
    }
    const managerReviewExcerpt = managerReviewText ? String(managerReviewText).trim().slice(0, 4000) : null;

    // Thread policy for AG:
    // - First AG dispatch for a given PROJECT MUST open a new conversation to avoid cross-project contamination.
    // - Then we reuse the same conversation by default, unless Manager overrides with new_per_task (or AG is behaving oddly).
    const agPolicy = run.threadPolicy?.developer_antigravity || "reuse";
    const forceNewThread = run.agForceNewThreadNextByTask[taskId] === true;
    const wantNewThread = agPolicy === "new_per_task" || !run.agConversationStarted || forceNewThread;

    const promptLines = [
      "You are Antigravity (Developer AG) working inside an Antidex-managed project.",
      "Antidex is file-driven: the orchestrator only proceeds after you write the required files and the final turn marker.",
      "",
      `Dynamic options (from UI): ${buildDynamicOptionsLineForAg(run)}`,
      "ChatGPT rule: only consult ChatGPT if useChatGPT=ENABLED AND it is necessary for this task (or explicitly required in manager_instruction.md). If disabled, do not use ChatGPT unless explicitly asked by the user/Manager.",
      "Lovable rule: only use Lovable if useLovable=ENABLED AND the Manager explicitly requests a Lovable workflow for this task (SPEC §14.4). If disabled, do not use Lovable unless explicitly required by the user/Manager.",
      `Project cwd: ${run.cwd}`,
      `Task id: ${taskId}`,
      `AG run id: ${agRunId}`,
      `Conversation: ${wantNewThread ? "NEW thread (no prior context for this project)" : "REUSE existing project thread"}`,
    ];

    if (isRework) {
      promptLines.push(
        "",
        "DISPATCH TYPE: REWORK (previous submission was not accepted).",
        `You MUST read ${managerReviewRel} to understand what was missing and what to produce now.`,
      );
      if (managerReviewExcerpt) {
        promptLines.push("", `Rework details (from ${managerReviewRel}, truncated):`, "-----", managerReviewExcerpt, "-----");
      }
    }

    promptLines.push(
      "",
      "All paths below are relative to the project cwd unless stated otherwise.",
      "Absolute paths (preferred if there is any cwd ambiguity):",
      `- ACK: ${paths.ackPath}`,
      `- RESULT tmp: ${paths.resultTmpPath}`,
      `- RESULT: ${paths.resultPath}`,
      `- Task pointer: ${pointerPath}`,
      `- Heartbeat: ${heartbeatAbs}`,
      `- Turn marker tmp: ${marker.tmpAbs}`,
      `- Turn marker: ${marker.doneAbs}`,
      "",
      "Delivery handshake (do FIRST, within 30 seconds):",
      `- Write ACK (atomic) to: ${ackRel}`,
      `  - JSON example: { "status":"ack", "started_at":"${nowIso()}", "task_id":"${taskId}", "agent":"developer_antigravity" }`,
      "  - This ACK only proves you received the message; you can write it before reading everything else.",
      "",
      "Then read (in order) before doing the real work:",
      `- ${cursorRulesRel}`,
      `- ${instructionsRel}`,
      `- ${taskMdRel}`,
      `- ${managerInstrRel}`,
      ...(isRework && fileExists(managerReviewAbs) ? [`- ${managerReviewRel}`] : []),
      "",
      `Then execute the task described in ${taskMdRel}. If anything is unclear, use the Q/A protocol described in ${instructionsRel}.`,
      ...(isOutcomeDriven
        ? [
          "Outcome-driven task rule:",
          "- In result.json, include output.what_this_suggests_next with observed_signal / likely_cause / can_current_task_still_succeed_as_is / recommended_next_step / smallest_confirming_experiment.",
          "- Do not return raw metrics only; explain what the evidence suggests for the next step.",
          "",
        ]
        : []),
      "",
      "Required outputs (file protocol):",
      `- Heartbeat for progress: data/AG_internal_reports/heartbeat.json (update at least every 5 minutes during long work)`,
      "  - recommended fields: { updated_at, task_id, stage, note, expected_silence_ms }",
      "  - if you expect a long browser-only period with little filesystem activity, set stage=\"browser\" and expected_silence_ms to help the watchdog avoid false stalls.",
      `- RESULT (atomic): write ${resultTmpRel} then rename -> ${resultRel}`,
      `- Task pointer (required): ${taskDirRel}/dev_result.json (schema in ${instructionsRel})`,
      `- Pipeline state: update ${pipelineStateRel} with developer_status=\"ready_for_review\" and a summary pointing to ${taskDirRel}/dev_result.json`,
      `- Artifacts (optional but recommended): ${artifactsRel} (screenshots, exports, etc.)`,
      "",
      "Finish the turn LAST (atomic turn marker):",
      `- write ${marker.tmpRel} then rename -> ${marker.doneRel} (content: ok)`,
      "",
      `For traceability, this request is stored at: ${requestRel}`,
    );
    const prompt = promptLines.join("\n");

    // Persist request.md for humans (and as a recovery pointer).
    try {
      fs.writeFileSync(paths.requestPath, prompt + "\n", "utf8");
    } catch {
      // ignore
    }

    this._emitAg(runId, "delta", { step: "sending", delta: `\n[sending] ${taskId} via connector ${connector.baseUrl} (agRunId=${agRunId})\n` });
    this._appendAgLog(agLogPath, `[sending] baseUrl=${connector.baseUrl} agRunId=${agRunId}`);
    try {
      const r = this._getRunRequired(runId);
      if (r.activeTurn && r.activeTurn.role === "developer_antigravity") {
        r.activeTurn.step = "sending";
        this._setRun(runId, r);
      }
    } catch {
      // ignore
    }

    const sendRes = await connector.send({
      prompt,
      requestId: `antidex-${runId}-${taskId}`,
      runId: agRunId,
      newThread: wantNewThread,
      notify: run.connectorNotify,
      debug: run.connectorDebug,
      meta: {
        projectCwd: run.cwd,
        taskId,
        ackPath: paths.ackPath,
        resultTmpPath: paths.resultTmpPath,
        resultPath: paths.resultPath,
        pointerPath,
        markerDonePath: marker.doneAbs,
      },
    });

    // If we forced a new thread for recovery, consume that one-shot flag after dispatch.
    if (forceNewThread) {
      try {
        const r = this._getRunRequired(runId);
        if (r.agForceNewThreadNextByTask && typeof r.agForceNewThreadNextByTask === "object") {
          delete r.agForceNewThreadNextByTask[taskId];
          this._setRun(runId, r);
        }
      } catch {
        // ignore
      }
    }

    if (!sendRes?.ok) {
      const detail = sendRes?.json?.error ? ` (${sendRes.json.error})` : "";
      run.status = "failed";
      run.lastError = { message: `Connector /send failed: HTTP ${sendRes?.status || 0}${detail}`, at: nowIso(), where: "ag/send" };
      if (run.activeTurn && run.activeTurn.role === "developer_antigravity") run.activeTurn = null;
      this._setRun(runId, run);
      this._releaseRunningLock(runId);
      this._emitAg(runId, "diag", { step: "sending", type: "error", message: run.lastError.message });
      appendRecoveryLog(run, { role: "developer_antigravity", step: "sending", status: "error", message: run.lastError.message, task_id: taskId, ag_run_id: agRunId });
      return;
    }

    // The connector may return HTTP 200 but still report a non-fatal "verification failed" diagnostic.
    // Do NOT treat this as a dispatch failure: rely on filesystem progress (ACK/RESULT/heartbeat) instead.
    if (sendRes?.json?.ok === false) {
      const detail = sendRes?.json?.error ? ` (${sendRes.json.error})` : "";
      const msg = `Connector /send diagnostic: HTTP ${sendRes?.status || 0}${detail}`;
      this._emitAg(runId, "diag", { step: "sending", type: "warning", message: msg });
      this._appendAgLog(agLogPath, `[warn] ${msg}`);
      appendRecoveryLog(run, { role: "developer_antigravity", step: "sending", status: "warning", message: msg, task_id: taskId, ag_run_id: agRunId });
    }

    // Wait for ACK/RESULT + marker; keep the UI responsive by emitting progress deltas.
    try {
      const agReportsDirAbs = path.join(run.cwd, "data", "AG_internal_reports");
      const heartbeatPathAbs = path.join(agReportsDirAbs, "heartbeat.json");
      const projectIgnore = new Set([
        ".git",
        "node_modules",
        ".venv",
        "venv",
        ".pytest_cache",
        ".next",
        ".cache",
        "dist",
        "build",
        "coverage",
        // Antidex internal state is watched separately (reports + run dir).
        "data",
      ]);
      let watchdogStage = "waiting_ack";
      let lastWatchdogCheckAtMs = 0;
      let lastWatchdogDiagAtMs = 0;
      let lastActivityMtimeMs = Date.now(); // baseline: avoid immediate stall on pre-existing old mtimes
      let lastAgActivityMtimeMs = lastActivityMtimeMs;

      const agWatchdogTick = async () => {
        if (this._stopRequested.has(runId)) throw new Error("Run stopped");
        const now = Date.now();
        if (now - lastWatchdogCheckAtMs < AG_WATCHDOG_POLL_MS) return;
        lastWatchdogCheckAtMs = now;

        const reportsM = maxMtimeMsUnderPath(agReportsDirAbs);
        const runM = maxMtimeMsUnderPath(paths.runDir);
        const projectM = AG_WATCH_PROJECT_FS
          ? maxMtimeMsUnderPath(run.cwd, { maxEntries: AG_PROJECT_WATCH_MAX_ENTRIES, ignoreDirNames: projectIgnore })
          : null;
        const agM = Math.max(reportsM || 0, runM || 0);
        if (agM > lastAgActivityMtimeMs) lastAgActivityMtimeMs = agM;
        const maxM = Math.max(lastActivityMtimeMs, reportsM || 0, runM || 0, projectM || 0);
        if (maxM > lastActivityMtimeMs) lastActivityMtimeMs = maxM;

        const idleMs = now - lastActivityMtimeMs;

        // Browser hint: if AG announced a browser-only period, extend the stall threshold (best-effort).
        let effectiveStallMs = AG_STALL_MS;
        if (watchdogStage === "waiting_result") {
          effectiveStallMs = Math.max(effectiveStallMs, AG_STALL_RESULT_MS);
        }
        try {
          const hbStat = safeStat(heartbeatPathAbs);
          if (hbStat && hbStat.isFile()) {
            const hb = readJsonBestEffort(heartbeatPathAbs);
            if (hb.ok && hb.value && typeof hb.value === "object") {
              const stage = typeof hb.value.stage === "string" ? hb.value.stage.trim().toLowerCase() : "";
              const expected = Number(hb.value.expected_silence_ms);
              const expectedMs = Number.isFinite(expected) ? Math.max(0, expected) : 0;
              const hbUpdatedAtMs = tryParseIsoToMs(hb.value.updated_at) ?? hbStat.mtimeMs;
              if (stage === "browser" && expectedMs > 0) {
                const windowMs = expectedMs + AG_BROWSER_SILENCE_MARGIN_MS;
                if (now - hbUpdatedAtMs <= windowMs) effectiveStallMs = Math.max(effectiveStallMs, windowMs);
              }
            }
          }
        } catch {
          // ignore
        }

        // Optional per-task override (from task.md / manager_instruction.md) for long browser-only AG work.
        if (agExpectedSilenceMs && (watchdogStage === "waiting_result" || watchdogStage === "waiting_marker")) {
          effectiveStallMs = Math.max(effectiveStallMs, agExpectedSilenceMs);
        }

        if (idleMs > effectiveStallMs) {
          const minutes = Math.round(idleMs / 60_000);
          const effectiveMinutes = Math.round(effectiveStallMs / 60_000);
          const overrideMinutes = agExpectedSilenceMs ? Math.round(agExpectedSilenceMs / 60_000) : null;
          const thresholdNote = ` (stall threshold ~${effectiveMinutes} min${overrideMinutes ? `, override ~${overrideMinutes} min` : ""})`;
          const msg = `AG watchdog: no filesystem activity for ~${minutes} min during ${watchdogStage}${thresholdNote} (expected heartbeat under data/AG_internal_reports/).`;
          appendRecoveryLog(run, {
            role: "developer_antigravity",
            step: watchdogStage,
            status: "stalled",
            message: msg,
            task_id: taskId,
            ag_run_id: agRunId,
            watched: {
              ag_internal_reports_dir: relPathForPrompt(run.cwd, agReportsDirAbs),
              ag_run_dir: relPathForPrompt(run.cwd, paths.runDir),
            },
          });
          throw new Error(msg);
        }

        // Emit a lightweight periodic status line for observability while waiting.
        if (now - lastWatchdogDiagAtMs > 60_000) {
          lastWatchdogDiagAtMs = now;
          const minutes = Math.round(idleMs / 60_000);
          this._emitAg(runId, "delta", { step: watchdogStage, delta: `[watchdog] last fs activity ~${minutes} min ago; waiting...\n` });
        }
      };

      const onPoll = async () => agWatchdogTick();

      this._emitAg(runId, "delta", { step: "waiting_ack", delta: `\n[waiting] ack: ${ackRel}\n` });
      try {
        const r = this._getRunRequired(runId);
        if (r.activeTurn && r.activeTurn.role === "developer_antigravity") {
          r.activeTurn.step = "waiting_ack";
          this._setRun(runId, r);
        }
      } catch {
        // ignore
      }
      watchdogStage = "waiting_ack";
      const ackWaitStartReportsMs = maxMtimeMsUnderPath(agReportsDirAbs) || 0;
      const waitAckOrThrow = async () => {
        await waitForAck({ ackPath: paths.ackPath, timeoutMs: AG_ACK_TIMEOUT_MS, pollMs: 500, onPoll });
      };
      let resultAlreadyPresent = false;
      try {
        await waitAckOrThrow();
      } catch (e) {
        const sec = Math.round(AG_ACK_TIMEOUT_MS / 1000);
        const baseMsg = `AG watchdog: ACK not observed within ${sec}s (delivery uncertain). ${safeErrorMessage(e)}`;

        const reportsM = maxMtimeMsUnderPath(agReportsDirAbs) || 0;
        const reportsHint = reportsM > ackWaitStartReportsMs ? "AG reports changed during ACK wait." : "No AG reports change observed during ACK wait.";
          // If AG produced a RESULT without ACK, proceed (ACK is best-effort).
          try {
            await waitForResult({ resultPath: paths.resultPath, timeoutMs: 5_000, pollMs: 500, onPoll });
            resultAlreadyPresent = true;
            this._emitAg(runId, "diag", { step: "waiting_ack", type: "warning", message: "ACK missing but RESULT detected; continuing." });
          } catch {
            // Auto-resend once on first ACK timeout (delivery uncertain).
            if (!run.agAckResendCounts || typeof run.agAckResendCounts !== "object") run.agAckResendCounts = {};
            const ackResends = Number(run.agAckResendCounts[taskId] || 0);
            if (ackResends < 1) {
              run.agAckResendCounts[taskId] = ackResends + 1;
              this._setRun(runId, run);
              this._emitAg(runId, "diag", {
                step: "recovery",
                type: "warning",
                message: `No ACK after ${sec}s. ${reportsHint} Auto re-dispatching AG once with a new thread.`,
              });
              const resend = await connector.send({
                prompt,
                requestId: `antidex-${runId}-${taskId}-ackretry${ackResends + 1}`,
                runId: agRunId,
                newThread: true,
                notify: run.connectorNotify,
                debug: run.connectorDebug,
                meta: {
                  projectCwd: run.cwd,
                  taskId,
                  ackPath: paths.ackPath,
                  resultTmpPath: paths.resultTmpPath,
                  resultPath: paths.resultPath,
                  pointerPath,
                  markerDonePath: marker.doneAbs,
                  recovery: { kind: "ack_retry", attempt: ackResends + 1 },
                },
              });
              if (!resend?.ok) {
                const detail = resend?.json?.error ? ` (${resend.json.error})` : "";
                throw new Error(`AG watchdog: ack retry failed: HTTP ${resend?.status || 0}${detail}`);
              }
              lastActivityMtimeMs = Date.now();
              lastAgActivityMtimeMs = lastActivityMtimeMs;
              try {
                await waitAckOrThrow();
              } catch (e2) {
                throw new Error(baseMsg);
              }
            } else {
              // Escalation policy:
              // - If we've already had at least one AG stall for this task (priorStalls>=1),
              //   and a retry dispatch still yields no ACK, attempt a Reload Window and re-send once.
              // - Limit: 2 reloads per task across the run.
              const reloads = Number(run.agReloadCounts[taskId] || 0);
              const allowReload = priorStalls >= 1 && reloads < 2;
              if (!allowReload) throw new Error(baseMsg);

              // Perform Reload Window then re-send with NEW thread.
              run.agReloadCounts[taskId] = reloads + 1;
              run.agConversationStarted = false;
              this._setRun(runId, run);

              this._emitAg(runId, "diag", { step: "recovery", type: "warning", message: `No ACK after stall retry; reloading AG window (reload ${reloads + 1}/2) and re-sending…` });
              await this._reloadAgWindow({ runId, connector, taskId, reason: "no_ack_after_retry" });

              // Clear stale files to avoid parsing a corrupt/partial JSON from a previous attempt.
              try {
                fs.rmSync(paths.ackPath, { force: true });
                fs.rmSync(paths.resultPath, { force: true });
                fs.rmSync(paths.resultTmpPath, { force: true });
              } catch {
                // ignore
              }

              const resend = await connector.send({
                prompt,
                requestId: `antidex-${runId}-${taskId}-reload${reloads + 1}`,
                runId: agRunId,
                newThread: true,
                notify: run.connectorNotify,
                debug: run.connectorDebug,
                meta: {
                  projectCwd: run.cwd,
                  taskId,
                  ackPath: paths.ackPath,
                  resultTmpPath: paths.resultTmpPath,
                  resultPath: paths.resultPath,
                  pointerPath,
                  markerDonePath: marker.doneAbs,
                  recovery: { kind: "reload_window", attempt: reloads + 1 },
                },
              });
              if (!resend?.ok) {
                const detail = resend?.json?.error ? ` (${resend.json.error})` : "";
                throw new Error(`AG watchdog: reload+resend failed: HTTP ${resend?.status || 0}${detail}`);
              }

              // Reset baseline so we don't immediately consider inactivity based on old mtimes.
              lastActivityMtimeMs = Date.now();
              lastAgActivityMtimeMs = lastActivityMtimeMs;

              // Wait for ACK again (same timeout). If this fails, we fall back to the watchdog handoff.
              try {
                await waitAckOrThrow();
              } catch (e2) {
                throw new Error(baseMsg);
              }
            }
          }
      }

      // Once ACK is observed, consider the AG conversation initialized for this project (so subsequent tasks can reuse it).
      try {
        const r = this._getRunRequired(runId);
        r.agConversationStarted = true;
        this._setRun(runId, r);
      } catch {
        // ignore
      }
      try {
        const r = this._getRunRequired(runId);
        const manifestPath = r.projectManifestPath || path.join(r.cwd, "data", "antidex", "manifest.json");
        updateManifestAgConversation({ manifestPath, wantNewThread, atIso: nowIso() });
      } catch {
        // ignore
      }

      this._emitAg(runId, "delta", { step: "waiting_result", delta: `[waiting] result: ${resultRel}\n` });
      try {
        const r = this._getRunRequired(runId);
        if (r.activeTurn && r.activeTurn.role === "developer_antigravity") {
          r.activeTurn.step = "waiting_result";
          this._setRun(runId, r);
        }
      } catch {
        // ignore
      }
      watchdogStage = "waiting_result";
      if (!resultAlreadyPresent) {
        try {
          await waitForResult({ resultPath: paths.resultPath, timeoutMs: AG_RESULT_TIMEOUT_MS, pollMs: 800, onPoll });
        } catch (e) {
          const minutes = Math.round(AG_RESULT_TIMEOUT_MS / 60_000);
          throw new Error(`AG watchdog: RESULT not observed within ~${minutes} min. ${safeErrorMessage(e)}`);
        }
      }

      const start = Date.now();
      while (Date.now() - start < TURN_MARKER_TIMEOUT_MS) {
        watchdogStage = "waiting_marker";
        await agWatchdogTick();
        const ok = this._verifyTurnMarker({ run, marker });
        if (ok.ok) break;
        await sleep(500);
      }
      const markerOk = this._verifyTurnMarker({ run, marker });
      if (!markerOk.ok) throw new Error(`AG watchdog: ${markerOk.reason}`);

      // Ensure pointer exists; if missing, fail so we can retry via re-dispatch (manager will see it).
      const pointer = readJsonBestEffort(pointerPath);
      if (!pointer.ok) throw new Error(`Missing or invalid pointer dev_result.json: ${pointer.error}`);
      if (isOutcomeDriven) {
        const agResult = readJsonBestEffort(paths.resultPath);
        if (!agResult.ok || !agResult.value || typeof agResult.value !== "object") {
          throw new Error(`Outcome-driven AG task ${taskId}: invalid result.json (${agResult.error || "missing object"})`);
        }
        const suggestion = getOutcomeSuggestionObject(agResult.value);
        const check = validateOutcomeSuggestionObject(suggestion);
        if (!check.ok) {
          throw new Error(
            `Outcome-driven AG task ${taskId}: result.json must include output.what_this_suggests_next with ${check.missing.join(", ")}`,
          );
        }
      }

      // Update pipeline_state.json ourselves (AG often won't touch it reliably).
      if (this._shouldPreserveTerminalRunState(runId)) return;
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.run_id = state.run_id || run.runId;
      state.iteration = Number.isInteger(state.iteration) ? state.iteration : run.iteration;
      state.phase = "dispatching";
      state.current_task_id = taskId;
      state.assigned_developer = "developer_antigravity";
      state.thread_policy = run.threadPolicy || state.thread_policy;
      const atIso = nowIso();
      state.ag_conversation = state.ag_conversation && typeof state.ag_conversation === "object" ? state.ag_conversation : {};
      state.ag_conversation.started = true;
      if (!state.ag_conversation.started_at) state.ag_conversation.started_at = atIso;
      state.ag_conversation.last_used_at = atIso;
      if (wantNewThread) state.ag_conversation.last_reset_at = atIso;
      state.developer_status = "ready_for_review";
      state.manager_decision = null;
      state.summary = `AG task done: see ${relPathForPrompt(run.cwd, pointerPath)} and ${resultRel}`;
      state.updated_at = atIso;
      writeJsonAtomic(run.projectPipelineStatePath, state);

      const updated = this._getRunRequired(runId);
      updated.developerStatus = "ready_for_review";
      updated.status = "reviewing";
      this._setRun(runId, updated);

      this._emitAg(runId, "completed", { step: "implementing", assistantText: `AG completed: ${taskId} (agRunId=${agRunId})\n` });
      this._appendAgLog(agLogPath, `[done] task=${taskId}`);

      // Reset watchdog retry counter for this task on success.
      try {
        const r = this._getRunRequired(runId);
        if (r.agRetryCounts && typeof r.agRetryCounts === "object" && r.agRetryCounts[taskId]) {
          delete r.agRetryCounts[taskId];
          this._setRun(runId, r);
        }
      } catch {
        // ignore
      }
      try {
        const r = this._getRunRequired(runId);
        if (r.activeTurn && r.activeTurn.role === "developer_antigravity") {
          r.activeTurn = null;
          this._setRun(runId, r);
        }
      } catch {
        // ignore
      }
    } catch (e) {
      const msg = safeErrorMessage(e);
      if (msg === "Run stopped") {
        const updated = this._getRunRequired(runId);
        updated.status = "stopped";
        updated.lastError = updated.lastError || { message: "Stopped by user", at: nowIso(), where: "stop" };
        if (updated.activeTurn && updated.activeTurn.role === "developer_antigravity") updated.activeTurn = null;
        this._setRun(runId, updated);
        this._releaseRunningLock(runId);
        return;
      }
      const isWatchdog = msg.startsWith("AG watchdog:");
      if (isWatchdog) {
        const updated = this._getRunRequired(runId);
        if (!updated.agRetryCounts || typeof updated.agRetryCounts !== "object") updated.agRetryCounts = {};
        updated.agRetryCounts[taskId] = Number(updated.agRetryCounts[taskId] || 0) + 1;
        const attemptNo = Number(updated.agRetryCounts[taskId] || 1);
        // Force a fresh AG thread next time (best-effort) to recover from a polluted/odd session.
        if (!updated.agForceNewThreadNextByTask || typeof updated.agForceNewThreadNextByTask !== "object") updated.agForceNewThreadNextByTask = {};
        updated.agForceNewThreadNextByTask[taskId] = true;

        const questionAbs = writeTaskQuestion({
          taskDir,
          prefix: "Q-watchdog",
          title: `AG stalled for ${taskId} (attempt ${attemptNo}/3)`,
          body: [
            "The orchestrator observed no filesystem activity from AG for too long during this task.",
            "",
            `Watchdog error: ${msg}`,
            "",
            "What AG should have been updating:",
            "- data/AG_internal_reports/heartbeat.json (or any file under data/AG_internal_reports/)",
            `- data/antigravity_runs/${agRunId}/ (ack.json / result.json / artifacts/)`,
            "",
            "Action required (Manager):",
            `1) Inspect AG progress files: data/AG_internal_reports/ and data/antigravity_runs/${agRunId}/`,
            `2) Decide how to continue for task ${taskId}:`,
            "   - Retry AG (recommended now): re-dispatch to AG; a NEW AG thread will be forced once automatically.",
            "   - If this is a long browser-only task, add ag_expected_silence_minutes (or ag_expected_silence_ms) to task.md or manager_instruction.md before retrying.",
            "   - If this keeps failing, switch this task to developer_codex (assigned_developer=developer_codex).",
            "",
            "When you have decided:",
            `- Update ${taskDirRel}/manager_instruction.md with concrete next steps.`,
            `- Update data/pipeline_state.json: set developer_status=\"ongoing\" and a summary pointing to your decision + this question file.`,
          ].join("\n"),
        });
        const relQ = relPathForPrompt(updated.cwd, questionAbs);

        // Mark the project state as blocked so the pipeline hands control to the Manager on the next step.
        try {
          const stateRead = readJsonBestEffort(updated.projectPipelineStatePath);
          const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
          state.developer_status = "blocked";
          state.summary = `Watchdog: AG stalled (${attemptNo}/3) for ${taskId}. Manager action required (see ${relQ}).`;
          state.updated_at = nowIso();
          writeJsonAtomic(updated.projectPipelineStatePath, state);
        } catch {
          // ignore
        }

        updated.status = "implementing";
        updated.developerStatus = "blocked";
        updated.lastError = { message: `AG stalled (${attemptNo}/3) for ${taskId} (see ${relQ})`, at: nowIso(), where: "ag/watchdog" };
        if (updated.activeTurn && updated.activeTurn.role === "developer_antigravity") updated.activeTurn = null;
        this._setRun(runId, updated);
        this._emitAg(runId, "diag", { step: "waiting", type: "warning", message: updated.lastError.message });
        appendRecoveryLog(updated, { role: "developer_antigravity", step: "watchdog", status: "stalled", attempt: attemptNo, task_id: taskId, ag_run_id: agRunId, question: relQ });
        return;
      }

      const updated = this._getRunRequired(runId);

      // Robustness: AG non-watchdog errors should not hard-stop a long-running pipeline.
      // Block and hand control back to the Manager with a clear question for next action.
      try {
        const questionAbs = writeTaskQuestion({
          taskDir,
          prefix: "Q-ag-error",
          title: `AG error while waiting for ${taskId}`,
          body: [
            "Antidex encountered a non-watchdog error while waiting for AG.",
            "",
            `Error: ${msg}`,
            "",
            "Manager action required:",
            `- Inspect AG run folder: data/antigravity_runs/${agRunId}/ (ack.json / result.json / artifacts/)`,
            "- Decide how to proceed:",
            "  - Retry AG (maybe force a NEW thread, or clarify instructions/outputs)",
            "  - Or switch this task to developer_codex",
            "",
            "Then:",
            `- Update ${taskDirRel}/manager_instruction.md if needed`,
            "- Update data/pipeline_state.json with developer_status=ongoing (to retry) or blocked (if you need clarification).",
          ].join("\n"),
        });
        const relQ = relPathForPrompt(updated.cwd, questionAbs);
        try {
          const stateRead = readJsonBestEffort(updated.projectPipelineStatePath);
          const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
          state.developer_status = "blocked";
          state.manager_decision = null;
          state.summary = `AG error while waiting for ${taskId}. Manager action required (see ${relQ}).`;
          state.updated_at = nowIso();
          writeJsonAtomic(updated.projectPipelineStatePath, state);
        } catch {
          // ignore
        }
        updated.status = "implementing";
        updated.developerStatus = "blocked";
        updated.lastError = { message: `AG wait error (see ${relQ}): ${msg}`, at: nowIso(), where: "ag/wait" };
      } catch {
        updated.status = "implementing";
        updated.developerStatus = "blocked";
        updated.lastError = { message: msg, at: nowIso(), where: "ag/wait" };
      }
      if (updated.activeTurn && updated.activeTurn.role === "developer_antigravity") updated.activeTurn = null;
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
      this._emitAg(runId, "diag", { step: "waiting", type: "warning", message: updated.lastError.message || msg });
    }
  }

  async _stepManagerReview(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;

    const reviewTaskId = run.currentTaskId || null;
    if (!this._ensureTaskSpecOrBlock(runId, { taskIdOverride: reviewTaskId, context: "manager/review" })) return;
    if (!this._bumpReviewCountOrBlock(runId, { taskIdOverride: reviewTaskId, limit: 8 })) return;
    this._refreshTaskLongJobHistory(runId, { taskId: reviewTaskId });

    run.status = "reviewing";
    this._setRun(runId, run);

    // Freshness guard: a "review" must actually produce/modify manager_review.md for the current task.
    // Otherwise the pipeline can appear to have "only one REWORK" while looping on the same stale review file.
    let baselineReviewMtimeMs = 0;
    let baselineManagerInstrMtimeMs = 0;
    let baselineTodoMtimeMs = 0;
    try {
      const { taskDir } = taskContext(run, reviewTaskId);
      const reviewAbs = path.join(taskDir, "manager_review.md");
      baselineReviewMtimeMs = safeStat(reviewAbs)?.mtimeMs ?? 0;
      const instrAbs = path.join(taskDir, "manager_instruction.md");
      baselineManagerInstrMtimeMs = safeStat(instrAbs)?.mtimeMs ?? 0;
    } catch {
      baselineReviewMtimeMs = 0;
      baselineManagerInstrMtimeMs = 0;
    }
    try {
      const todoAbs = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
      baselineTodoMtimeMs = safeStat(todoAbs)?.mtimeMs ?? 0;
    } catch {
      baselineTodoMtimeMs = 0;
    }

    const threadId = await this._ensureThread({ runId, role: "manager" });
    let expectedReviewTurnNonce = null;
    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "manager",
      step: "reviewing",
      threadId,
      model: run.managerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => {
        expectedReviewTurnNonce = turnNonce || null;
        return this._buildManagerReviewPrompt(run, { turnNonce, retryReason, taskIdOverride: reviewTaskId });
      },
      verifyPostconditions: async ({ run }) => {
        const { taskDir, taskId } = taskContext(run, reviewTaskId);
        const review = path.join(taskDir, "manager_review.md");
        if (!fileExists(review)) {
          const rel = relPathForPrompt(run.cwd, review);
          return { ok: false, reason: `Missing required file for ${taskId}: ${rel} (${review})` };
        }
        const head = readTextHead(review, 8000) || "";
        const full = readTextBestEffort(review, 200_000) || head;
        const reviewTurnNonce = extractManagerReviewTurnNonce(head) || extractManagerReviewTurnNonce(full);
        const reviewTouchedThisTurn = Boolean(expectedReviewTurnNonce && reviewTurnNonce === expectedReviewTurnNonce);
        const stReview = safeStat(review);
        if (
          !reviewTouchedThisTurn &&
          stReview &&
          typeof stReview.mtimeMs === "number" &&
          stReview.mtimeMs <= baselineReviewMtimeMs
        ) {
          const rel = relPathForPrompt(run.cwd, review);
          return {
            ok: false,
            reason:
              `Stale ${rel}: Manager review must either update manager_review.md in this review turn ` +
              `(file mtime did not change) or include 'Turn nonce: ${expectedReviewTurnNonce || "<turn_nonce>"}'.`,
          };
        }
        const hasAccepted = /\bACCEPTED\b/i.test(head);
        const hasRework = /\bREWORK\b/i.test(head);
        if (!hasAccepted && !hasRework) {
          return { ok: false, reason: `manager_review.md must include ACCEPTED or REWORK for ${taskId}` };
        }
        if (hasRework) {
          // Guardrail: REWORK must contain a "Next actions:" section with at least one concrete action,
          // to prevent "rerun the same thing" loops.
          const lines = String(full || "").split(/\r?\n/);
          const idx = lines.findIndex((l) => /^\s*next\s+actions\s*:\s*$/i.test(String(l || "")));
          if (idx < 0) {
            return { ok: false, reason: `REWORK for ${taskId} must include a 'Next actions:' section (at least 1 concrete action).` };
          }
          let hasAction = false;
          for (let i = idx + 1; i < lines.length; i++) {
            const raw = String(lines[i] || "");
            const t = raw.trim();
            if (!t) continue;
            // Stop if we reached a new section header.
            if (/^\s*#{1,6}\s+/.test(t)) break;
            // Consider a "Key:" style header as end of this section (conservative).
            if (/^[A-Za-z][A-Za-z0-9 _/-]{2,60}:\s*$/.test(t) && !/^\s*[-*]\s+/.test(t)) break;
            hasAction = true;
            break;
          }
          if (!hasAction) {
            return { ok: false, reason: `REWORK for ${taskId}: 'Next actions:' must contain at least one non-empty action line.` };
          }

          // Guardrail: a REWORK review must change something about the next attempt:
          // either update manager_instruction.md for this task OR update doc/TODO.md (new task/reorder/reassign).
          const instrAbs = path.join(taskDir, "manager_instruction.md");
          const todoAbs = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
          const instrMtime = safeStat(instrAbs)?.mtimeMs ?? 0;
          const todoMtime = safeStat(todoAbs)?.mtimeMs ?? 0;
          const changedInstr = instrMtime > baselineManagerInstrMtimeMs;
          const changedTodo = todoMtime > baselineTodoMtimeMs;
          if (!changedInstr && !changedTodo) {
            const relInstr = relPathForPrompt(run.cwd, instrAbs);
            const relTodo = relPathForPrompt(run.cwd, todoAbs);
            return {
              ok: false,
              reason:
                `REWORK for ${taskId}: you must change the next attempt. ` +
                `Update either ${relInstr} (adjust approach/params/proofs) or ${relTodo} (new task/reorder/reassign) during this review turn.`,
            };
          }

          const taskMeta = readTaskSpecMeta(taskDir, { maxChars: 4000 });
          if (taskMeta.outcomeDriven) {
            const goalCheckBlock = extractMarkdownNamedBlock(full, "Goal check", [
              "Next actions",
              "Notes",
              "Reasons (short)",
              "Rework request",
              "What is good",
              "Why REWORK",
              "Why ACCEPTED",
              "Commit",
            ]);
            if (goalCheckBlock === null) {
              return { ok: false, reason: `REWORK for outcome-driven task ${taskId} must include a 'Goal check:' block.` };
            }
            const requiredGoalLabels = [
              "Final goal",
              "Evidence that invalidates",
              "Failure type",
              "Decision",
              "Why this is the right level",
            ];
            for (const label of requiredGoalLabels) {
              if (!hasMarkdownLabeledValue(goalCheckBlock, label)) {
                return {
                  ok: false,
                  reason: `REWORK for outcome-driven task ${taskId}: missing '${label}:' in Goal check.`,
                };
              }
            }
            const failureType = normalizeOutcomeFailureType(readMarkdownLabeledValue(goalCheckBlock, "Failure type"));
            if (!failureType) {
              return {
                ok: false,
                reason:
                  `REWORK for outcome-driven task ${taskId}: 'Failure type:' must be one of ` +
                  "local_task_issue | measurement_or_protocol_issue | upstream_plan_issue.",
              };
            }
            if (failureType !== "upstream_plan_issue") {
              if (!hasMarkdownLabeledValue(full, "Rerun justification")) {
                return {
                  ok: false,
                  reason:
                    `REWORK for outcome-driven task ${taskId}: local/protocol reruns require 'Rerun justification:' ` +
                    "to explain why the next attempt can still produce new signal.",
                };
              }
            } else {
              if (!changedTodo) {
                return {
                  ok: false,
                  reason:
                    `REWORK for outcome-driven task ${taskId}: upstream_plan_issue requires updating ${relPathForPrompt(run.cwd, todoAbs)} ` +
                    "during this review turn.",
                };
              }
              const todoText = readTextBestEffort(todoAbs, 200_000);
              const nextTodoTask = parseTodoNextUndone(todoText);
              if (!nextTodoTask || !nextTodoTask.taskId || nextTodoTask.taskId === taskId) {
                return {
                  ok: false,
                  reason:
                    `REWORK for outcome-driven task ${taskId}: upstream_plan_issue requires an upstream TODO task ` +
                    "to become the first unchecked item before the current task.",
                };
              }
            }
          }
        }

        // Gating: do not "ACCEPT" manual E2E tests when they only validated an error path.
        // If task_kind=manual_test and evidence indicates "blocked" (missing prereqs, etc.),
        // force the Manager to create an env/setup task or block explicitly.
        try {
          const taskMd = path.join(taskDir, "task.md");
          const taskHead = fileExists(taskMd) ? readTextHead(taskMd, 2500) || "" : "";
          const kindMatch = taskHead.match(/^\s*task_kind\s*:\s*([^\s#]+)/im);
          const taskKind = kindMatch ? String(kindMatch[1]).trim().toLowerCase() : null;
          if (taskKind === "manual_test" && hasAccepted && !hasRework) {
            const devResultJson = path.join(taskDir, "dev_result.json");
            const devResultMd = path.join(taskDir, "dev_result.md");
            let outcome = null;
            let blockingReason = null;
            let artifactsDirRel = null;
            try {
              const jr = readJsonBestEffort(devResultJson);
              if (jr.ok && jr.value && typeof jr.value === "object") {
                outcome = typeof jr.value.outcome === "string" ? String(jr.value.outcome).trim().toLowerCase() : null;
                blockingReason =
                  typeof jr.value.blocking_reason === "string" ? String(jr.value.blocking_reason).trim() : null;
                artifactsDirRel =
                  typeof jr.value.artifacts_dir === "string" ? String(jr.value.artifacts_dir).trim() : null;
              }
            } catch {
              // ignore
            }
            const devHead = fileExists(devResultMd) ? readTextHead(devResultMd, 8000) || "" : "";
            const looksBlocked =
              outcome === "blocked" ||
              outcome === "fail" ||
              /\btikal\s+not\s+found\b/i.test(devHead) ||
              (/\bnon disponible\b/i.test(devHead) && /\btikal\b/i.test(devHead)) ||
              /\bjava\b/i.test(devHead) && /\bmissing\b/i.test(devHead);
            if (looksBlocked) {
              const relDev = fileExists(devResultMd) ? relPathForPrompt(run.cwd, devResultMd) : relPathForPrompt(run.cwd, devResultJson);
              const why = blockingReason ? ` (${blockingReason})` : "";
              return {
                ok: false,
                reason:
                  `Gating violation for ${taskId}: task_kind=manual_test but evidence indicates BLOCKED${why} in ${relDev}. ` +
                  `Do NOT ACCEPT. Create an env/setup task (or mark manager_decision=blocked) and retry.`,
              };
            }

            // Manual tests should carry concrete, reviewable evidence (at minimum: a screenshot and/or output artifact).
            // This reduces false ACCEPT when the "test" was only a narrative or a proxy (e.g. TestClient) that the user
            // cannot reproduce via the real UI workflow.
            const evidenceDirsAbs = [];
            evidenceDirsAbs.push(path.join(taskDir, "artifacts"));
            if (artifactsDirRel) {
              const p = artifactsDirRel.replaceAll("/", path.sep);
              // artifacts_dir is expected to be relative to project cwd.
              evidenceDirsAbs.push(path.join(run.cwd, p));
            }
            const hasEvidenceFile = (dirAbs) => {
              try {
                if (!dirAbs || !fs.existsSync(dirAbs)) return false;
                const st = fs.statSync(dirAbs);
                if (!st.isDirectory()) return false;
                const files = fs.readdirSync(dirAbs);
                return files.some((name) => {
                  const n = String(name || "").toLowerCase();
                  if (!(n.endsWith(".png") || n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".docx") || n.endsWith(".zip"))) return false;
                  try {
                    const fst = fs.statSync(path.join(dirAbs, name));
                    return fst.isFile() && fst.size > 0;
                  } catch {
                    return false;
                  }
                });
              } catch {
                return false;
              }
            };
            const evidenceOk = evidenceDirsAbs.some(hasEvidenceFile);
            if (!evidenceOk) {
              const relDirs = evidenceDirsAbs.map((d) => relPathForPrompt(run.cwd, d));
              return {
                ok: false,
                reason:
                  `Gating violation for ${taskId}: task_kind=manual_test and decision=ACCEPTED, but no evidence artifact was found. ` +
                  `Add at least one screenshot (.png) and/or output file (.docx) under one of: ${relDirs.join(", ")}; then re-review.`,
              };
            }
          }
        } catch {
          // ignore gating failures; the core postconditions still apply
        }

        // Validate the project pipeline_state.json directly (do not rely on run.managerDecision),
        // so we can enforce invariants that prevent infinite review loops.
        const psRead = readJsonBestEffort(run.projectPipelineStatePath);
        if (!psRead.ok || !psRead.value || typeof psRead.value !== "object") {
          const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
          return { ok: false, reason: `Invalid ${ps} (must be valid JSON)` };
        }
        const decision = normalizeManagerDecision(psRead.value.manager_decision);
        const dev = normalizeDeveloperStatus(psRead.value.developer_status);
        const currentTaskInState = typeof psRead.value.current_task_id === "string" ? String(psRead.value.current_task_id) : null;
        if (!decision) {
          const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
          return { ok: false, reason: `Missing manager_decision in ${ps} (set to continue|blocked|completed)` };
        }

        // Guardrail: TODO items must be dispatchable (no "(Manager)" owner lines).
        try {
          const todoText = readTextBestEffort(run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
          if (todoHasDisallowedManagerOwner(todoText)) {
            const relTodo = relPathForPrompt(run.cwd, run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md"));
            return {
              ok: false,
              reason:
                `Invalid ${relTodo}: TODO must not contain (Manager) items. ` +
                `Rewrite TODO so each item is assigned to developer_codex or developer_antigravity (doc tasks are still dev tasks).`,
            };
          }
        } catch {
          // ignore
        }

        // Invariants:
        // - continue must advance the pipeline (developer_status must not stay ready_for_review).
        // - blocked should reflect developer_status=blocked for routing to Manager answering.
        if (decision === "continue") {
          if (dev === "ready_for_review") {
            const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
            return {
              ok: false,
              reason:
                `Invalid pipeline_state for ${taskId}: manager_decision=continue but developer_status=ready_for_review in ${ps}. ` +
                `After ACCEPTED or REWORK you must set developer_status=ongoing and (if ACCEPTED) set current_task_id to the next task id.`,
            };
          }
          if (dev !== "ongoing") {
            const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
            return { ok: false, reason: `Invalid pipeline_state for ${taskId}: manager_decision=continue expects developer_status=ongoing in ${ps}` };
          }
          // If the review says ACCEPTED (not REWORK), the Manager must advance to a new current_task_id
          // (or mark completed). Keeping the same id would cause a re-dispatch loop.
          if (hasAccepted && !hasRework && currentTaskInState === taskId) {
            const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
            return {
              ok: false,
              reason:
                `Invalid pipeline_state for ${taskId}: manager_review.md says ACCEPTED but current_task_id did not advance in ${ps}. ` +
                `Set current_task_id to the next task id (or set manager_decision=completed if done).`,
            };
          }
          if (hasAccepted && !hasRework && currentTaskInState && currentTaskInState !== taskId) {
            const next = this._taskSpecPaths(run, currentTaskInState);
            const missing = [];
            if (!fileExists(next.taskMdAbs)) missing.push(relPathForPrompt(run.cwd, next.taskMdAbs));
            if (!fileExists(next.managerInstrAbs)) missing.push(relPathForPrompt(run.cwd, next.managerInstrAbs));
            if (missing.length) {
              return {
                ok: false,
                reason: `Missing task spec for next task ${currentTaskInState}: ${missing.join(", ")}.`,
              };
            }

            // Guardrail: research -> SPEC integration must occur before implementation if rules_summary.md exists.
            // If a rules research produced rules_summary.md, the next tasks must include a spec_integration step
            // that embeds the confirmed rules into doc/SPEC.md (and updates doc/TESTING_PLAN.md).
            try {
              const rulesSummaries = findRulesSummaryPaths(run.cwd);
              if (rulesSummaries.length) {
                const specText = readTextBestEffort(run.projectSpecPath || path.join(run.cwd, "doc", "SPEC.md"));
                const integrated = specHasConfirmedRulesMarker(specText);
                const nextTaskHead = readTextHead(next.taskMdAbs, 2500) || "";
                const kindMatch = nextTaskHead.match(/^\s*task_kind\s*:\s*([^\s#]+)/im);
                const nextKind = kindMatch ? String(kindMatch[1]).trim().toLowerCase() : null;
                if (!integrated && nextKind !== "spec_integration" && nextKind !== "rules_research") {
                  const relSpec = relPathForPrompt(run.cwd, run.projectSpecPath || path.join(run.cwd, "doc", "SPEC.md"));
                  const relSum = relPathForPrompt(run.cwd, rulesSummaries[0]);
                  return {
                    ok: false,
                    reason:
                      `Rules research output detected (${relSum}) but ${relSpec} does not yet embed the confirmed rules. ` +
                      `Before continuing implementation, insert a dispatchable task with task_kind=spec_integration to integrate rules into SPEC + adjust TESTING_PLAN, then continue.`,
                  };
                }
              }
            } catch {
              // ignore
            }
          }
        }
        if (decision === "blocked" && dev !== "blocked") {
          const ps = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
          return { ok: false, reason: `Invalid pipeline_state for ${taskId}: manager_decision=blocked expects developer_status=blocked in ${ps}` };
        }
        return { ok: true };
      },
      maxAttempts: 3,
    });

    const updated = this._getRunRequired(runId);
    if (this._shouldPreserveTerminalRunState(runId)) return;
    if (!attempt.ok) {
      // Robustness: failing postconditions should not hard-stop a long-running pipeline.
      // Block and hand control back to the Manager with an explicit question.
      try {
        const { taskId, taskDir, taskDirRel } = taskContext(updated, reviewTaskId);
        const qAbs = writeTaskQuestion({
          taskDir,
          prefix: "Q-manager-review",
          title: `Manager review did not satisfy required postconditions for ${taskId}`,
          body: [
            "Antidex cannot proceed because the Manager review turn did not produce the required files/state.",
            "",
            `Error: ${attempt.errorMessage || "Manager review postconditions failed"}`,
            "",
            "Fix and retry:",
            `- Ensure ${taskDirRel}/manager_review.md exists and includes ACCEPTED or REWORK`,
            `- Ensure data/pipeline_state.json is valid and consistent:`,
            "  - If ACCEPTED and next task exists: set current_task_id to next, developer_status=ongoing, manager_decision=continue",
            "  - If REWORK on the same task: keep current_task_id, set developer_status=ongoing, manager_decision=continue",
            "  - If REWORK reveals an upstream-plan issue: update TODO so an upstream task is first, set current_task_id to it (or let TODO rebase do it), then set manager_decision=continue",
            "  - If blocked: set developer_status=blocked, manager_decision=blocked",
            "  - If completed: set manager_decision=completed",
            "",
            "Then click Continue pipeline.",
          ].join("\n"),
        });
        const relQ = relPathForPrompt(updated.cwd, qAbs);
        try {
          const stateRead = readJsonBestEffort(updated.projectPipelineStatePath);
          const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
          state.developer_status = "blocked";
          state.manager_decision = null;
          state.summary = `Orchestrator: manager review postconditions failed for ${taskId} (see ${relQ}).`;
          state.updated_at = nowIso();
          writeJsonAtomic(updated.projectPipelineStatePath, state);
        } catch {
          // ignore
        }
        updated.status = "implementing";
        updated.developerStatus = "blocked";
        updated.managerDecision = null;
        updated.lastError = { message: `Manager review blocked for ${taskId} (see ${relQ})`, at: nowIso(), where: "manager/review" };
      } catch {
        updated.status = "implementing";
        updated.developerStatus = "blocked";
        updated.managerDecision = null;
        updated.lastError = { message: attempt.errorMessage || "Manager review postconditions failed", at: nowIso(), where: "manager/review" };
      }
      if (updated.activeTurn && updated.activeTurn.role === "manager") updated.activeTurn = null;
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
      return;
    }

    // Successful review: reset review-loop + dispatch-loop counters for this task (progress was made).
    try {
      this._refreshTaskLongJobHistory(runId, { taskId: reviewTaskId });
      const { taskId } = taskContext(updated, reviewTaskId);
      if (!updated.taskReviewCounts || typeof updated.taskReviewCounts !== "object") updated.taskReviewCounts = {};
      updated.taskReviewCounts[taskId] = 0;
      if (!updated.taskDispatchCounts || typeof updated.taskDispatchCounts !== "object") updated.taskDispatchCounts = {};
      updated.taskDispatchCounts[taskId] = 0;
      this._setRun(runId, updated);
    } catch {
      // ignore
    }

    const after = this._getRunRequired(runId);
    const decision = after.managerDecision;
    // Consume the decision marker in the project pipeline_state.json so it can't be reprocessed forever.
    try {
      const stateRead = readJsonBestEffort(after.projectPipelineStatePath);
      if (stateRead.ok && stateRead.value && typeof stateRead.value === "object") {
        if (stateRead.value.manager_decision != null) {
          stateRead.value.manager_decision = null;
          stateRead.value.updated_at = nowIso();
          writeJsonAtomic(after.projectPipelineStatePath, stateRead.value);
        }
      }
    } catch {
      // best-effort
    }
    if (decision === "completed") {
      // Normalize project state to a terminal-ish shape for clearer resumes.
      // (Keep fields within the documented schema; prefer `idle` rather than introducing a new status.)
      try {
        const stateRead = readJsonBestEffort(after.projectPipelineStatePath);
        if (stateRead.ok && stateRead.value && typeof stateRead.value === "object") {
          stateRead.value.phase = "completed";
          stateRead.value.developer_status = "idle";
          stateRead.value.manager_decision = null;
          if (typeof stateRead.value.summary !== "string" || !stateRead.value.summary.trim()) {
            stateRead.value.summary = "completed";
          }
          stateRead.value.updated_at = nowIso();
          writeJsonAtomic(after.projectPipelineStatePath, stateRead.value);
        }
      } catch {
        // best-effort
      }
      after.status = "completed";
      this._setRun(runId, after);
      this._releaseRunningLock(runId);
      return;
    }
    if (decision === "continue") {
      await this._forceRebaseToTodo(runId, { reason: "manager_review" });
      const rebased = this._getRunRequired(runId);
      rebased.iteration = Math.max(1, Number(rebased.iteration || after.iteration || 1)) + 1;
      rebased.managerDecision = null;
      rebased.status = rebased.developerStatus === "ready_for_review" ? "reviewing" : "implementing";
      this._setRun(runId, rebased);
      return;
    }
    if (decision === "blocked") {
      // Non-fatal: pause the pipeline and let the Manager/user unblock via answers + pipeline_state changes.
      after.status = "implementing";
      after.developerStatus = "blocked";
      after.managerDecision = null;
      after.lastError = { message: "Pipeline blocked (manager_decision=blocked)", at: nowIso(), where: "manager/review" };
      this._setRun(runId, after);
      this._releaseRunningLock(runId);
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
    this._refreshTaskLongJobHistory(runId);

    run.status = "reviewing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });
    const specPaths = this._taskSpecPaths(run);
    const missingTaskSpec = specPaths ? !fileExists(specPaths.taskMdAbs) || !fileExists(specPaths.managerInstrAbs) : false;

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
        const questionsDir = path.join(taskDir, "questions");
        let hasAnswer = false;
        let needsPostIncidentAnswer = false;
        let latestQuestion = null;
        try {
          const ents = fs.existsSync(answersDir) ? fs.readdirSync(answersDir) : [];
          hasAnswer = ents.some((n) => /^A-.*\.md$/i.test(n));
        } catch {
          hasAnswer = false;
        }
        if (!hasAnswer) return { ok: false, reason: `Missing answers/A-*.md in ${relPathForPrompt(run.cwd, answersDir)}` };

        // If a post-incident review was requested by the orchestrator, require a dedicated answer + minimal template.
        try {
          if (fs.existsSync(questionsDir)) {
            const qEnts = fs.readdirSync(questionsDir).filter((n) => /^Q-.*\.md$/i.test(n));
            const qWithTimes = qEnts
              .map((n) => {
                try {
                  const abs = path.join(questionsDir, n);
                  const st = fs.statSync(abs);
                  return { n, abs, mtimeMs: Number(st.mtimeMs || 0) };
                } catch {
                  return null;
                }
              })
              .filter(Boolean)
              .sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
            if (qWithTimes.length) {
              latestQuestion = qWithTimes[0];
              needsPostIncidentAnswer = /^Q-post-incident-.*\.md$/i.test(latestQuestion.n);
            }
          }
        } catch {
          // ignore
        }

        if (run.lastError && run.lastError.where === "guardrail/post_incident_review") needsPostIncidentAnswer = true;

        if (needsPostIncidentAnswer) {
          let hasPostIncidentAnswer = false;
          let answerAbs = null;
          try {
            const aEnts = fs.existsSync(answersDir) ? fs.readdirSync(answersDir) : [];
            const aPost = aEnts.filter((n) => /^A-post-incident-.*\.md$/i.test(n));
            if (aPost.length) {
              hasPostIncidentAnswer = true;
              answerAbs = path.join(answersDir, aPost.sort().slice(-1)[0]);
            }
          } catch {
            hasPostIncidentAnswer = false;
          }
          if (!hasPostIncidentAnswer) {
            return {
              ok: false,
              reason: `Post-incident review requires answers/A-post-incident-*.md in ${relPathForPrompt(run.cwd, answersDir)}`,
            };
          }
          try {
            const body = fs.readFileSync(answerAbs, "utf8");
            const hasDecision = /\bDecision\s*:/i.test(body);
            const hasPlanChange = /\bPlan change\s*:/i.test(body);
            if (!hasDecision || !hasPlanChange) {
              return {
                ok: false,
                reason: `Post-incident answer must include at least 'Decision:' and 'Plan change:' (${relPathForPrompt(run.cwd, answerAbs)})`,
              };
            }
          } catch {
            return { ok: false, reason: `Unable to read post-incident answer file: ${relPathForPrompt(run.cwd, answerAbs)}` };
          }

          // Require an explicit state decision when post-incident is active (don't silently stay blocked).
          const decision = normalizeManagerDecision(run.managerDecision);
          if (run.developerStatus === "blocked" && decision !== "blocked" && decision !== "completed") {
            return {
              ok: false,
              reason:
                "Post-incident review requires a state decision: set developer_status=ongoing/ready_for_review, or set manager_decision=blocked/completed.",
            };
          }
        }

        // If the pipeline is blocked due to missing task spec files, the Manager must create them as part of the answer.
        if (missingTaskSpec) {
          const pathsAfter = this._taskSpecPaths(run);
          const missing = [];
          if (pathsAfter && !fileExists(pathsAfter.taskMdAbs)) missing.push(relPathForPrompt(run.cwd, pathsAfter.taskMdAbs));
          if (pathsAfter && !fileExists(pathsAfter.managerInstrAbs)) missing.push(relPathForPrompt(run.cwd, pathsAfter.managerInstrAbs));
          if (missing.length) return { ok: false, reason: `Missing task spec file(s): ${missing.join(", ")}` };
        }
        if (run.developerStatus !== "ongoing" && run.developerStatus !== "ready_for_review" && run.developerStatus !== "blocked") {
          return {
            ok: false,
            reason: `developer_status is ${run.developerStatus || "(missing)"} (expected ongoing|ready_for_review|blocked)`,
          };
        }
        if (run.developerStatus === "ready_for_review") {
          const { taskDir, taskId } = taskContext(run);
          const freshEvidence = this._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
          if (!freshEvidence.ok) return freshEvidence;
        }

        // If the block comes from specific orchestrator guardrails, require the Manager to actually resolve it
        // instead of writing an answer file while leaving the state unchanged (which would burn tokens).
        try {
          if (run.lastError && run.lastError.where === "guardrail/assigned_developer_manager") {
            // Allow the Manager to close the run via manager_decision=completed, even if assigned_developer remains "manager".
            if (run.managerDecision !== "completed") {
              if (run.assignedDeveloper === "manager") {
                return { ok: false, reason: `assigned_developer is still "manager" (must be developer_codex or developer_antigravity, or set manager_decision=completed)` };
              }
              if (run.developerStatus === "blocked") {
                return { ok: false, reason: `Resolve guardrail: set developer_status to ongoing (dispatch) or set manager_decision=completed` };
              }
            }
          }
        } catch {
          // ignore
        }

        // If this task is blocked due to the "review loop" guardrail, the Manager must choose a concrete next action
        // (advance to re-review or re-dispatch). Leaving developer_status=blocked would keep us stuck in the same guardrail.
        try {
          const q = fs.existsSync(questionsDir) ? fs.readdirSync(questionsDir) : [];
          const isReviewLoopGuard = q.some((n) => /^Q-review-loo.*\.md$/i.test(n) || /^Q-review-loop.*\.md$/i.test(n));
          if (isReviewLoopGuard && run.developerStatus === "blocked") {
            return { ok: false, reason: `Review-loop guardrail requires resolving the block (set developer_status to ongoing or ready_for_review).` };
          }
        } catch {
          // ignore
        }

        // If this task is blocked due to the generic loop guard, require an explicit state change.
        try {
          const q = fs.existsSync(questionsDir) ? fs.readdirSync(questionsDir) : [];
          const isLoopGuard = q.some((n) => /^Q-loop-.*\.md$/i.test(n));
          if (isLoopGuard) {
            const decision = normalizeManagerDecision(run.managerDecision);
            if (run.developerStatus === "blocked" && decision !== "blocked" && decision !== "completed") {
              return {
                ok: false,
                reason:
                  "Loop guard requires a state change: set developer_status=ongoing/ready_for_review, or set manager_decision=blocked/completed.",
              };
            }
          }
        } catch {
          // ignore
        }

        return { ok: true };
      },
      maxAttempts: 3,
    });

    const updated = this._getRunRequired(runId);
    if (this._shouldPreserveTerminalRunState(runId)) return;
    if (!attempt.ok) {
      // Robustness: missing marker / postconditions should not be a fatal error for long-running runs.
      // Block with a clear error so the user can Continue after fixing the situation.
      updated.status = "implementing";
      updated.developerStatus = "blocked";
      updated.lastError = { message: attempt.errorMessage || "Manager answer postconditions failed", at: nowIso(), where: "manager/answering" };
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
      return;
    }

    const after = this._getRunRequired(runId);
    // Manager intervention: reset dispatch loop counters for this task so the pipeline can retry safely.
    try {
      const { taskId } = taskContext(after);
      if (after.taskDispatchCounts && typeof after.taskDispatchCounts === "object") {
        after.taskDispatchCounts[taskId] = 0;
        this._setRun(runId, after);
      }
    } catch {
      // ignore
    }
    // Manager intervention: if answering a review-loop guard, reset review counters to allow a fresh cycle.
    try {
      const { taskId, taskDir } = taskContext(after);
      const questionsDir = path.join(taskDir, "questions");
      let hasReviewLoopGuard = after.lastError && after.lastError.where === "guardrail/review_loop";
      if (!hasReviewLoopGuard) {
        const ents = fs.existsSync(questionsDir) ? fs.readdirSync(questionsDir) : [];
        hasReviewLoopGuard = ents.some((n) => /^Q-review-loo.*\.md$/i.test(n) || /^Q-review-loop.*\.md$/i.test(n));
      }
      if (hasReviewLoopGuard) {
        if (!after.taskReviewCounts || typeof after.taskReviewCounts !== "object") after.taskReviewCounts = {};
        after.taskReviewCounts[taskId] = 0;
        this._setRun(runId, after);
      }
    } catch {
      // ignore
    }
    if (after.managerDecision === "completed") {
      // Let the Manager close the run from an answering step (common after guardrails).
      try {
        const stateRead = readJsonBestEffort(after.projectPipelineStatePath);
        if (stateRead.ok && stateRead.value && typeof stateRead.value === "object") {
          stateRead.value.phase = "completed";
          stateRead.value.developer_status = "idle";
          stateRead.value.manager_decision = null;
          stateRead.value.updated_at = nowIso();
          writeJsonAtomic(after.projectPipelineStatePath, stateRead.value);
        }
      } catch {
        // best-effort
      }
      after.status = "completed";
      after.developerStatus = "idle";
      after.managerDecision = null;
      after.lastError = null;
      this._setRun(runId, after);
      this._releaseRunningLock(runId);
      return;
    }
    if (after.developerStatus === "ongoing") {
      after.status = "implementing";
      this._setRun(runId, after);
    } else if (after.developerStatus === "ready_for_review") {
      after.status = "reviewing";
      this._setRun(runId, after);
    }
  }

  _queueUserCommand(runId, { message, source = "ui_send" } = {}) {
    const run = this._getRunRequired(runId);
    const cmdText = String(message || "").trim();
    if (!cmdText) throw new Error("Missing message");

    if (run.pendingUserCommand && run.pendingUserCommand.status === "pending") {
      const queued = this._queueFollowupUserCommand(run, { message: cmdText, source });
      run.status = "implementing";
      run.developerStatus = "blocked";
      run.lastError = run.lastError || { message: `User command pending: ${run.pendingUserCommand.id}`, at: nowIso(), where: "user_command" };
      this._setRun(runId, run);
      return queued;
    }

    {
      const pending = this._createUserCommandRecord(run, { message: cmdText, source });
      this._writeUserCommandFile(run, pending);
      this._writeUserCommandProjectState(run, { active: pending, queued: null });

      run.pendingUserCommand = pending;
      run.status = "implementing";
      run.developerStatus = "blocked";
      run.lastError = run.lastError || { message: `User command pending: ${pending.id}`, at: nowIso(), where: "user_command" };
      this._setRun(runId, run);
      return pending;
    }

    const dirAbs = run.projectUserCommandsDir || path.join(run.cwd, "data", "user_commands");
    ensureDir(dirAbs);
    const id = `CMD-${nowIsoForFile()}`;
    const cmdAbs = path.join(dirAbs, `${id}.md`);
    const respAbs = path.join(dirAbs, `${id}_response.md`);
    const cmdRel = relPathForPrompt(run.cwd, cmdAbs);
    const respRel = relPathForPrompt(run.cwd, respAbs);

    const content = [
      `# User command — ${id}`,
      "",
      `created_at: ${nowIso()}`,
      `source: ${source}`,
      "",
      "## Instruction (HIGH PRIORITY)",
      "You must treat this as a priority override from the user.",
      "Reconcile it with doc/TODO.md and update the project truth (tasks + docs + pipeline_state) accordingly.",
      "",
      "## User message",
      cmdText,
      "",
      "## Required response",
      `Write your response to: ${respRel}`,
      "",
    ].join("\n");
    writeTextAtomic(cmdAbs, content);

    // Mark the pipeline as blocked so the Manager processes the command before any further dispatch/review.
    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.developer_status = "blocked";
      state.manager_decision = null;
      state.summary = `User command queued: ${cmdRel}`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // best-effort
    }

    const pending = {
      id,
      status: "pending",
      source,
      createdAt: nowIso(),
      cmdAbs,
      respAbs,
      cmdRel,
      respRel,
    };

    run.pendingUserCommand = pending;
    run.status = "implementing";
    run.developerStatus = "blocked";
    run.lastError = run.lastError || { message: `User command pending: ${id}`, at: nowIso(), where: "user_command" };
    this._setRun(runId, run);
    return pending;
  }

  _newUserCommandMessage({ message, source = "ui_send" } = {}) {
    return {
      id: `MSG-${nowIsoForFile()}`,
      createdAt: nowIso(),
      source,
      text: String(message || "").trim(),
    };
  }

  _createUserCommandRecord(run, { message, source = "ui_send" } = {}) {
    const dirAbs = run.projectUserCommandsDir || path.join(run.cwd, "data", "user_commands");
    ensureDir(dirAbs);
    const id = `CMD-${nowIsoForFile()}`;
    const cmdAbs = path.join(dirAbs, `${id}.md`);
    const respAbs = path.join(dirAbs, `${id}_response.md`);
    return {
      id,
      status: "pending",
      source,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      cmdAbs,
      respAbs,
      cmdRel: relPathForPrompt(run.cwd, cmdAbs),
      respRel: relPathForPrompt(run.cwd, respAbs),
      messages: [this._newUserCommandMessage({ message, source })],
    };
  }

  _renderUserCommandFile(run, cmd) {
    const messages = Array.isArray(cmd?.messages) && cmd.messages.length ? cmd.messages : [];
    const lines = [
      `# User command - ${String(cmd?.id || "CMD")}`,
      "",
      `created_at: ${cmd?.createdAt || nowIso()}`,
      `updated_at: ${cmd?.updatedAt || cmd?.createdAt || nowIso()}`,
      `source: ${cmd?.source || "ui_send"}`,
      `message_count: ${Math.max(1, messages.length || 1)}`,
      "",
      "## Instruction (HIGH PRIORITY)",
      "You must treat this as a priority override from the user.",
      "Reconcile it with doc/TODO.md and update the project truth (tasks + docs + pipeline_state) accordingly.",
      "",
    ];

    if (messages.length <= 1) {
      const msg = messages[0] || null;
      lines.push("## User message");
      lines.push(msg?.text || "");
      lines.push("");
    } else {
      lines.push("## User messages");
      lines.push("Deliver all of these messages in the same reconciliation step.");
      lines.push("");
      for (let i = 0; i < messages.length; i += 1) {
        const msg = messages[i];
        lines.push(`### Message ${i + 1} - ${msg.id}`);
        lines.push(`created_at: ${msg.createdAt}`);
        lines.push(`source: ${msg.source}`);
        lines.push("");
        lines.push(msg.text || "");
        lines.push("");
      }
    }

    lines.push("## Required response");
    lines.push(`Write your response to: ${cmd?.respRel || "(missing response path)"}`);
    lines.push("");
    return lines.join("\n");
  }

  _writeUserCommandFile(run, cmd) {
    if (!cmd?.cmdAbs) return;
    cmd.updatedAt = nowIso();
    if (!cmd.cmdRel) cmd.cmdRel = relPathForPrompt(run.cwd, cmd.cmdAbs);
    if (cmd.respAbs && !cmd.respRel) cmd.respRel = relPathForPrompt(run.cwd, cmd.respAbs);
    writeTextAtomic(cmd.cmdAbs, this._renderUserCommandFile(run, cmd));
  }

  _writeUserCommandProjectState(run, { active, queued } = {}) {
    try {
      const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
      const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
      state.developer_status = "blocked";
      state.manager_decision = null;
      if (active?.cmdRel && queued?.cmdRel) state.summary = `User command pending: ${active.cmdRel}; queued follow-up: ${queued.cmdRel}`;
      else if (active?.cmdRel) state.summary = `User command queued: ${active.cmdRel}`;
      else if (queued?.cmdRel) state.summary = `User command queued: ${queued.cmdRel}`;
      state.updated_at = nowIso();
      writeJsonAtomic(run.projectPipelineStatePath, state);
    } catch {
      // best-effort
    }
  }

  _queueFollowupUserCommand(run, { message, source = "ui_send" } = {}) {
    const cmdText = String(message || "").trim();
    if (!cmdText) throw new Error("Missing message");

    let queued = run.queuedUserCommand;
    if (!queued || queued.status !== "pending") {
      queued = this._createUserCommandRecord(run, { message: cmdText, source });
    } else {
      if (!Array.isArray(queued.messages)) queued.messages = [];
      queued.messages.push(this._newUserCommandMessage({ message: cmdText, source }));
    }

    queued.status = "pending";
    queued.updatedAt = nowIso();
    this._writeUserCommandFile(run, queued);
    run.queuedUserCommand = queued;
    this._writeUserCommandProjectState(run, { active: run.pendingUserCommand || null, queued });
    return queued;
  }

  _promoteQueuedUserCommand(runId) {
    const run = this._getRunRequired(runId);
    const queued = run.queuedUserCommand;
    if (!queued || queued.status !== "pending") return false;

    run.pendingUserCommand = queued;
    run.queuedUserCommand = null;
    run.status = "implementing";
    run.developerStatus = "blocked";
    run.lastError = { message: `User command pending: ${queued.id}`, at: nowIso(), where: "user_command" };
    this._writeUserCommandProjectState(run, { active: queued, queued: null });
    this._setRun(runId, run);
    return true;
  }

  _buildManagerUserCommandPrompt(run, { turnNonce, retryReason } = {}) {
    const docsRules = relPathForPrompt(run.cwd, run.projectDocRulesPath || path.join(run.cwd, "doc", "DOCS_RULES.md"));
    const docsIndex = relPathForPrompt(run.cwd, run.projectDocIndexPath || path.join(run.cwd, "doc", "INDEX.md"));
    const specPath = relPathForPrompt(run.cwd, run.projectSpecPath);
    const todoPath = relPathForPrompt(run.cwd, run.projectTodoPath);
    const testingPath = relPathForPrompt(run.cwd, run.projectTestingPlanPath);
    const decisionsPath = relPathForPrompt(run.cwd, run.projectDecisionsPath || path.join(run.cwd, "doc", "DECISIONS.md"));
    const pipelineStatePath = relPathForPrompt(run.cwd, run.projectPipelineStatePath);
    const resumePacketPath = resumePacketRelForRole(run, "manager");
    const marker = turnNonce ? turnMarkerPaths(run, turnNonce) : null;

    const cmd = run.pendingUserCommand;
    const cmdRel = cmd?.cmdAbs ? relPathForPrompt(run.cwd, cmd.cmdAbs) : null;
    const respRel = cmd?.respAbs ? relPathForPrompt(run.cwd, cmd.respAbs) : null;

    const header = buildReadFirstHeader({
      role: "manager",
      turnNonce,
      readPaths: [
        ...(resumePacketPath ? [resumePacketPath] : []),
        relPathForPrompt(run.cwd, run.projectManagerInstructionPath || path.join(run.cwd, "agents", "manager.md")),
        docsRules,
        docsIndex,
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        pipelineStatePath,
        ...(cmdRel ? [cmdRel] : []),
      ],
      writePaths: [
        specPath,
        todoPath,
        testingPath,
        decisionsPath,
        docsIndex,
        pipelineStatePath,
        ...(respRel ? [respRel] : []),
        ...(marker ? [marker.tmpRel, marker.doneRel] : []),
      ],
      retryReason,
    });

    const body = [
      "Goal: process the user command (priority override) and reconcile the project truth so the pipeline can continue.",
      "",
      "Non-negotiable rule:",
      "- Antidex will enforce NEXT task = first unchecked task in doc/TODO.md after you finish. Do not skip newly inserted gate tasks.",
      "- If the command requires work: ensure doc/TODO.md contains at least one unchecked actionable task item (with an owner in parentheses). If no work is needed: set manager_decision=completed in data/pipeline_state.json (and say so in the response).",
      "",
      ...(cmdRel ? [`User command file: ${cmdRel}`] : []),
      ...(respRel ? [`Write response file: ${respRel}`] : []),
      "",
      "What to do:",
      "1) Read the user command + current docs.",
      "2) Update doc/TODO.md (and doc/SPEC.md / doc/DECISIONS.md if needed) so the command is integrated.",
      "3) Ensure required task folders exist under data/tasks/<task_id>/ with task.md + manager_instruction.md.",
      "4) Update data/pipeline_state.json so current_task_id + assigned_developer match the intended next action.",
      "5) Write the response file with: what you understood, what changed, what the next task is.",
      "",
      "Finish by writing the turn marker (atomic) as usual.",
    ].join("\n");

    return `${header}\n\n${body}\n`;
  }

  async _stepManagerProcessUserCommand(runId) {
    const run = this._getRunRequired(runId);
    if (this._stopRequested.has(runId)) return;
    if (!run.pendingUserCommand || run.pendingUserCommand.status !== "pending") return;

    run.status = "reviewing";
    this._setRun(runId, run);

    const threadId = await this._ensureThread({ runId, role: "manager" });

    const attempt = await this._runTurnWithHandshake({
      runId,
      role: "manager",
      step: "user_command",
      threadId,
      model: run.managerModel,
      buildPrompt: ({ run, turnNonce, retryReason }) => this._buildManagerUserCommandPrompt(run, { turnNonce, retryReason }),
      verifyPostconditions: async ({ run }) => {
        const cmd = run.pendingUserCommand;
        if (!cmd || cmd.status !== "pending") return { ok: false, reason: "Missing pending user command" };
        if (!cmd.respAbs || !fileExists(cmd.respAbs)) return { ok: false, reason: `Missing response file: ${cmd.respRel || cmd.respAbs}` };
        // Robustness: ensure the override actually results in an actionable next step (or an explicit close).
        // Otherwise a completed run can "re-complete" immediately, making the override look ignored.
        try {
          const todoAbs = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
          const todoText = readTextBestEffort(todoAbs);
          const next = parseTodoNextUndone(todoText);
          if (next && next.taskId) return { ok: true };
        } catch {
          // ignore
        }
        try {
          const psRead = readJsonBestEffort(run.projectPipelineStatePath);
          const ps = psRead.ok && psRead.value && typeof psRead.value === "object" ? psRead.value : null;
          const decision = normalizeManagerDecision(ps?.manager_decision);
          const phase = typeof ps?.phase === "string" ? String(ps.phase).trim().toLowerCase() : "";
          if (decision === "completed" || phase === "completed") return { ok: true };
        } catch {
          // ignore
        }
        return {
          ok: false,
          reason:
            "User command processed, but no actionable NEXT task found. Update doc/TODO.md to include at least one unchecked task item (with an owner in parentheses), OR explicitly set manager_decision=completed in data/pipeline_state.json.",
        };
      },
      maxAttempts: 3,
    });

    const updated = this._getRunRequired(runId);
    if (this._shouldPreserveTerminalRunState(runId)) return;
    if (!attempt.ok) {
      updated.status = "implementing";
      updated.developerStatus = "blocked";
      updated.lastError = { message: attempt.errorMessage || "Manager user_command postconditions failed", at: nowIso(), where: "manager/user_command" };
      this._setRun(runId, updated);
      this._releaseRunningLock(runId);
      return;
    }

    // Mark processed + archive into history
    try {
      const cur = this._getRunRequired(runId);
      if (cur.pendingUserCommand && cur.pendingUserCommand.status === "pending") {
        cur.pendingUserCommand.status = "processed";
        cur.pendingUserCommand.processedAt = nowIso();
        if (!Array.isArray(cur.userCommandHistory)) cur.userCommandHistory = [];
        cur.userCommandHistory.push({ ...cur.pendingUserCommand });
        cur.pendingUserCommand = null;
        this._setRun(runId, cur);
      }
    } catch {
      // ignore
    }

    await this._syncFromProjectState(runId);
    await this._forceRebaseToTodo(runId, { reason: "user_command_processed" });
    if (this._stopRequested.has(runId)) return;
    if (this._promoteQueuedUserCommand(runId)) {
      await this._stepManagerProcessUserCommand(runId);
    }
  }

  async _forceRebaseToTodo(runId, { reason = "rebase" } = {}) {
    const run = this._getRunRequired(runId);
    const todoSnapshot = this._readTodoSnapshot(run);
    const todoAbs = todoSnapshot.todoAbs;
    const todoText = readTextBestEffort(todoAbs);
    const next = parseTodoNextUndone(todoText);
    const atIso = nowIso();

    this._acknowledgeTodoSnapshot(run, todoSnapshot, { reason });

    if (!next || !next.taskId) return;

    const taskId = next.taskId;
    const owner = next.owner || null;

    try {
      if (run.projectTasksDir) ensureDir(path.join(run.projectTasksDir, taskId));
    } catch {
      // ignore
    }

    const specPaths = this._taskSpecPaths(run, taskId);
    const missing = [];
    if (!fileExists(specPaths.taskMdAbs)) missing.push(relPathForPrompt(run.cwd, specPaths.taskMdAbs));
    if (!fileExists(specPaths.managerInstrAbs)) missing.push(relPathForPrompt(run.cwd, specPaths.managerInstrAbs));
    const isMissingSpec = missing.length > 0;

    const psRead = readJsonBestEffort(run.projectPipelineStatePath);
    const currentProjectState = psRead.ok && psRead.value && typeof psRead.value === "object" ? psRead.value : {};
    const currentStateTaskId =
      typeof currentProjectState.current_task_id === "string" ? String(currentProjectState.current_task_id) : null;
    const currentStateDev = normalizeDeveloperStatus(currentProjectState.developer_status);
    const currentStateDecision = normalizeManagerDecision(currentProjectState.manager_decision);
    const hasActiveManagerRework = !isMissingSpec && this._taskHasActiveManagerRework(specPaths.taskDir);
    const preserveInPlaceContinueIntent =
      !isMissingSpec &&
      reason === "manager_review" &&
      currentStateTaskId === taskId &&
      currentStateDecision === "continue" &&
      currentStateDev === "ongoing";
    const preserveSameTaskReworkIntent =
      !isMissingSpec &&
      reason === "manager_review" &&
      currentStateTaskId === taskId &&
      hasActiveManagerRework;

    const desiredDevStatus = (() => {
      if (preserveInPlaceContinueIntent || preserveSameTaskReworkIntent) return "ongoing";
      if (isMissingSpec) return "blocked";
      const { taskDir } = taskContext(run, taskId);
      if (fileExists(path.join(taskDir, "dev_result.json")) || fileExists(path.join(taskDir, "dev_result.md"))) return "ready_for_review";
      return "ongoing";
    })();

    try {
      const ps = currentProjectState && typeof currentProjectState === "object" ? { ...currentProjectState } : {};
      ps.current_task_id = taskId;
      if (owner) ps.assigned_developer = owner;
      ps.developer_status = desiredDevStatus;
      ps.manager_decision = null;
      if (preserveInPlaceContinueIntent || preserveSameTaskReworkIntent) {
        const existingSummary = typeof ps.summary === "string" ? String(ps.summary).trim() : "";
        ps.summary = existingSummary || `Continue ${taskId} after manager review.`;
      } else {
        ps.summary = isMissingSpec
          ? `Rebased to first undone TODO task: ${taskId} (${reason}) - missing task spec.`
          : `Rebased to first undone TODO task: ${taskId} (${reason}).`;
      }
      ps.updated_at = atIso;
      writeJsonAtomic(run.projectPipelineStatePath, ps);
    } catch {
      // ignore
    }

    run.currentTaskId = taskId;
    if (owner) run.assignedDeveloper = owner;
    run.developerStatus = desiredDevStatus;
    run.managerDecision = null;
    run.status = desiredDevStatus === "ready_for_review" ? "reviewing" : "implementing";
    run.lastError = isMissingSpec
      ? {
          message: `Missing task spec for ${taskId}: ${missing.join(", ")}`,
          at: atIso,
          where: "guardrail/missing_task_spec",
          source: "todo_rebase",
        }
      : null;
    this._setRun(runId, run);

    if (isMissingSpec) {
      const { taskDir, taskDirRel } = taskContext(run, taskId);
      writeTaskQuestion({
        taskDir,
        prefix: "Q-missing-task-spec",
        title: `Missing task spec for ${taskId}`,
        body: [
          "The orchestrator rebased to the first undone TODO task, but required task spec files are missing.",
          "",
          `Missing: ${missing.join(", ")}`,
          "",
          "Manager action required:",
          `1) Create/restore BOTH files for this task:`,
          `   - ${taskDirRel}/task.md`,
          `   - ${taskDirRel}/manager_instruction.md`,
          "2) Write a short answer in answers/A-*.md (what you changed/decided).",
          "3) Update data/pipeline_state.json to resume safely:",
          "   - If developer outputs already exist: set developer_status=ready_for_review.",
          "   - Else: set developer_status=ongoing (so the developer will be dispatched).",
          "",
          "Then click Continue pipeline.",
          `Task dir: ${taskDirRel}`,
        ].join("\n"),
      });
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
    // Always create the assistant log file, even if the model never emits deltas.
    // (Otherwise we'd only have the rpc.log which is hard to read.)
    ensureEmptyFile(assistantLogPath);

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
      lastActivityAtMs: Date.now(),
      commandRunning: false,
      commandStartedAtMs: null,
      assistantLogPath,
      rpcLogPath,
      _resolve: null,
      _reject: null,
      _timeout: null,
      _inactivityInterval: null,
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

    const inactivityMs = (() => {
      // Allow per-role overrides to avoid premature aborts on long dev turns.
      const envKey = `ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS_${String(role || "").toUpperCase()}`;
      const raw = (process.env[envKey] || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return TURN_INACTIVITY_TIMEOUT_MS;
    })();
    const softTimeoutMs = (() => {
      const envKey = `ANTIDEX_TURN_SOFT_TIMEOUT_MS_${String(role || "").toUpperCase()}`;
      const raw = (process.env[envKey] || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return TURN_SOFT_TIMEOUT_MS;
    })();
    const hardTimeoutMs = (() => {
      const envKey = `ANTIDEX_TURN_HARD_TIMEOUT_MS_${String(role || "").toUpperCase()}`;
      const raw = (process.env[envKey] || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return TURN_HARD_TIMEOUT_MS;
    })();
    const commandInactivityMs = (() => {
      // Optional override for long command executions (otherwise rely on hard-timeout only).
      const raw = (process.env.ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS_COMMAND || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return null;
    })();
    const commandSoftTimeoutMs = (() => {
      const raw = (process.env.ANTIDEX_TURN_SOFT_TIMEOUT_MS_COMMAND || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return TURN_SOFT_TIMEOUT_MS_COMMAND;
    })();
    const commandHardTimeoutMs = (() => {
      const raw = (process.env.ANTIDEX_TURN_HARD_TIMEOUT_MS_COMMAND || "").trim();
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n > 0) return n;
      return TURN_HARD_TIMEOUT_MS_COMMAND;
    })();

    active._inactivityInterval = setInterval(() => {
      const still = this._active;
      if (!still || still !== active) return;
      const now = Date.now();
      // During long command executions, the Codex event stream may go quiet even though work is progressing.
      // Use log file mtimes as an additional best-effort liveness signal.
      try {
        if (still.commandRunning) {
          const paths = [still.rpcLogPath, still.assistantLogPath].filter(Boolean);
          for (const p of paths) {
            try {
              const st = fs.statSync(p);
              if (Number.isFinite(st?.mtimeMs) && st.mtimeMs > Number(still.lastActivityAtMs || 0)) still.lastActivityAtMs = st.mtimeMs;
            } catch {
              // ignore
            }
          }
        }
      } catch {
        // ignore
      }
      const idleMs = now - Number(still.lastActivityAtMs || still.startedAtMs || now);
      const wallMs = now - Number(still.startedAtMs || now);
      const effectiveHardMs = still.commandRunning ? commandHardTimeoutMs : hardTimeoutMs;
      const effectiveSoftMs = still.commandRunning ? commandSoftTimeoutMs : softTimeoutMs;
      const isHardTimeout = effectiveHardMs > 0 && wallMs > effectiveHardMs;
      const effectiveInactivityMs = still.commandRunning ? commandInactivityMs : inactivityMs;
      const isIdleTimeout = effectiveInactivityMs > 0 && idleMs > effectiveInactivityMs;
      const isSoftTimeout = effectiveSoftMs > 0 && wallMs > effectiveSoftMs;

      // Soft timeout: do NOT interrupt. We only warn and switch to "watch" mode.
      // Escalation rule: if we are past soft timeout AND no activity is observed for a grace period,
      // we treat it as a stall and abort the turn (which triggers Manager/Corrector handling).
      if (isSoftTimeout) {
        try {
          if (!still.softTimeoutAtMs) {
            still.softTimeoutAtMs = now;
            still.softTimeoutLastDiagAtMs = 0;
          }
          const shouldDiag = !still.softTimeoutLastDiagAtMs || now - Number(still.softTimeoutLastDiagAtMs) > 5 * 60 * 1000;
          if (shouldDiag) {
            still.softTimeoutLastDiagAtMs = now;
            this.emit("event", {
              runId: still.runId,
              event: "diag",
              data: {
                role: "system",
                type: "warning",
                message: `Soft timeout reached for ${still.role}/${still.step} (${Math.round(wallMs / 60000)}m). Watching for progress; will escalate if no activity for ${Math.round(
                  TURN_SOFT_STALL_GRACE_MS / 60000
                )}m.`,
              },
            });
            try {
              const r = this._getRunRequired(still.runId);
              this._appendRunTimeline(still.runId, { type: "soft_timeout", role: still.role, step: still.step, wall_ms: wallMs });
              // Persist a non-fatal hint for post-mortem; do not block the run here.
              r.lastSoftTimeout = { at: nowIso(), role: still.role, step: still.step, wallMs };
              this._setRun(still.runId, r);
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore
        }
      }

      // Avoid killing long-running silent commands by default: only escalate soft-timeout into an incident
      // when we're NOT in a commandExecution, or when the operator explicitly configured a command inactivity timeout.
      const allowSoftStallEscalation = !still.commandRunning || (still.commandRunning && commandInactivityMs && commandInactivityMs > 0);
      const isSoftStall = isSoftTimeout && TURN_SOFT_STALL_GRACE_MS > 0 && idleMs > TURN_SOFT_STALL_GRACE_MS && allowSoftStallEscalation;
      if (!isHardTimeout && !isIdleTimeout && !isSoftStall) return;

      const reason = isHardTimeout ? "Turn hard timed out" : isSoftStall ? "Turn stalled after soft timeout" : "Turn inactive timed out";
      still.lastErrorMessage = reason;
      try {
        if (still.threadId && still.turnId) void this._codex.turnInterrupt({ threadId: still.threadId, turnId: still.turnId });
      } catch {
        // ignore
      }
      try {
        const r = this._getRunRequired(still.runId);
        const where = isHardTimeout ? "turn/hard_timeout" : isSoftStall ? "turn/soft_timeout" : "turn/inactivity";
        r.lastError = { message: reason, at: nowIso(), where };
        // IMPORTANT: do not leave the run in a limbo state where lastError is set but status stays "ongoing".
        // Block developer runs (so Manager/Corrector can intervene) and fail non-developer runs.
        if (String(still.role || "").startsWith("developer")) {
          // On hard-timeout, stop the auto-run to avoid burning tokens in repeated Corrector/Manager loops
          // while a potentially-zombie Codex turn is still running server-side.
          if (isHardTimeout) r.status = "stopped";
          else if (r.status !== "failed" && r.status !== "stopped" && r.status !== "paused" && r.status !== "canceled") r.status = "implementing";
          r.developerStatus = "blocked";
          try {
            const psRead = readJsonBestEffort(r.projectPipelineStatePath);
            const ps = psRead.ok && psRead.value && typeof psRead.value === "object" ? psRead.value : {};
            ps.developer_status = "blocked";
            ps.manager_decision = null;
            ps.summary = `Orchestrator timeout (${where}): ${reason}`;
            ps.updated_at = nowIso();
            writeJsonAtomic(r.projectPipelineStatePath, ps);
          } catch {
            // ignore
          }
        } else {
          r.status = "failed";
        }
        r.activeTurn = null;
        this._setRun(still.runId, r);
      } catch {
        // ignore
      }
      const err = new Error(reason);
      still._reject?.(err);
      try {
        if (still._inactivityInterval) clearInterval(still._inactivityInterval);
      } catch {
        // ignore
      }
      this._active = null;
      this._codex.setLogPath(null);
    }, 2_500);
    active._inactivityInterval.unref?.();

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
      if (active._inactivityInterval) clearInterval(active._inactivityInterval);
      this._active = null;
      this._codex.setLogPath(null);
      const msg = safeErrorMessage(e);
      this.emit("event", { runId, event: "diag", data: { role, type: "error", message: msg } });
      try {
        const run = this._getRunRequired(runId);
        if (run.activeTurn) {
          run.activeTurn = null;
          this._setRun(runId, run);
        }
      } catch {
        // ignore
      }
      try {
        active._reject?.(e);
      } catch {
        // ignore
      }
      throw e;
    }

    let result;
    try {
      result = await promise;
    } finally {
      const still = this._active;
      if (still === active) {
        if (active._inactivityInterval) clearInterval(active._inactivityInterval);
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

    // Any message for the active turn counts as liveness/progress for inactivity-based timeouts.
    // This mirrors the AG filesystem watchdog behavior (inactivity, not wall-clock).
    try {
      active.lastActivityAtMs = Date.now();
    } catch {
      // ignore
    }

    if (method === "codex/event/exec_command_begin") {
      active.commandRunning = true;
      active.commandStartedAtMs = Date.now();
      return;
    }
    if (method === "codex/event/exec_command_end") {
      active.commandRunning = false;
      active.commandStartedAtMs = null;
      return;
    }
    if (method === "item/commandExecution/outputDelta") {
      active.commandRunning = true;
      if (!active.commandStartedAtMs) active.commandStartedAtMs = Date.now();
      return;
    }
    if (method === "item/started") {
      const item = params?.item;
      if (item && item.type === "commandExecution") {
        active.commandRunning = true;
        active.commandStartedAtMs = Date.now();
        return;
      }
    }

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
        if (item && item.type === "commandExecution") {
          active.commandRunning = false;
          active.commandStartedAtMs = null;
          return;
        }
        if (item && item.type === "agentMessage" && typeof item.text === "string") {
          active.assistantText = item.text;
          // Ensure we have a readable assistant log even if no deltas were emitted.
          try {
            if (active.assistantLogPath) {
              ensureEmptyFile(active.assistantLogPath);
              const st = safeStat(active.assistantLogPath);
              const isEmpty = !st || (typeof st.size === "number" && st.size === 0);
              if (isEmpty && active.assistantText) {
                fs.appendFileSync(active.assistantLogPath, active.assistantText + os.EOL, { encoding: "utf8" });
              }
            }
          } catch {
            // best-effort
          }
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
  async _handleIncident(runId, context) {
    let run = this._getRunRequired(runId);
    // Special guardrail: post-incident review is an intentional Manager intervention step.
    // Do NOT treat it as a new incident / do NOT trigger the Corrector again.
    if (run.developerStatus === "blocked" && run.lastError?.where === "guardrail/post_incident_review") {
      return false;
    }
    // Reconcile stale dispatch_loop for AG: if watchdog stalls already reached the cap,
    // prefer the "AG disabled" guardrail to force a Manager decision.
    try {
      const taskId = run.currentTaskId;
      const stalls = Number(run.agRetryCounts?.[taskId] || 0);
      if (
        run.developerStatus === "blocked" &&
        run.lastError?.where === "guardrail/dispatch_loop" &&
        run.assignedDeveloper === "developer_antigravity" &&
        taskId &&
        stalls >= 3
      ) {
        if (this._blockAgAfterStalls(runId, { taskIdOverride: taskId, priorStalls: stalls })) {
          try {
            const updated = this._getRunRequired(runId);
            if (updated.taskDispatchCounts && typeof updated.taskDispatchCounts === "object") {
              updated.taskDispatchCounts[taskId] = 0;
              this._setRun(runId, updated);
            }
            run = this._getRunRequired(runId);
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }
    // A pending user command is usually an intentional "blocked" state: do NOT treat it as an incident.
    // The next step is a Manager reconcile, not Corrector intervention.
    //
    // Exception: if the Manager failed the `user_command` step postconditions (after retries), we treat it as a guardrail
    // so the Corrector can intervene (typically by fixing prompts/postconditions/UX in Antidex itself).
    if (
      (
        (run.pendingUserCommand && run.pendingUserCommand.status === "pending") ||
        (run.queuedUserCommand && run.queuedUserCommand.status === "pending")
      ) &&
      run.lastError?.where !== "manager/user_command"
    ) {
      return false;
    }
    // If the run was explicitly stopped by the user, the Corrector must not consume budget nor attempt a fix.
    // We still write an incident artifact for post-mortem / traceability.
    const isUserStop =
      run.status === "paused" ||
      run.status === "canceled" ||
      run.lastError?.where === "stop" ||
      run.lastError?.where === "pause" ||
      run.lastError?.message === "Stopped by user" ||
      run.lastError?.message === "Run stopped";
    const supervisorEnabled = process.env.ANTIDEX_SUPERVISOR === "1";

    const validGuards = [
      "guardrail/dispatch_loop",
      "guardrail/review_loop",
      "guardrail/loop",
      "guardrail/missing_task_spec",
      "guardrail/missing_current_task_id",
      "manager/user_command",
      "turn/inactivity",
      "turn/hard_timeout",
      "turn/soft_timeout",
      "ag/watchdog",
      "ag/send",
      "ag/wait",
      "job/start",
      "job/crash",
      "job/stalled",
      "job/monitor_missed",
      "job/result_invalid",
      "job/restart_failed",
      "auto",
      "sync"
    ];

    // We trigger if status==="failed" (which handles explicit failures) OR if it's blocked by one of these guardrails.
    const isExplicitFail = run.status === "failed";
    const isMatchedGuardrail = run.developerStatus === "blocked" && run.lastError?.where && validGuards.includes(run.lastError.where);

    if (!isExplicitFail && !isMatchedGuardrail) return false;

    const incidentWhere = String(run.lastError?.where || (run.status === "failed" ? "failed" : "blocked")).trim() || "unknown";
    const incidentMsg = String(run.lastError?.message || "").trim();
    const isAgDisabledGuardrail = incidentWhere === "ag/watchdog" && /AG disabled/i.test(incidentMsg);
    const skipCorrectorForMissingSpec =
      incidentWhere === "guardrail/missing_task_spec" && run.lastError && run.lastError.source === "todo_rebase";
    const incidentSig = this._normalizeCorrectorIncidentSignature({
      where: incidentWhere,
      message: incidentMsg,
      taskId: run.currentTaskId,
    });

    // Always write an incident artifact (even when the Corrector is disabled) so the user can debug and
    // so we can say "Corrector would have intervened here".
    const ts = nowIsoForFile().slice(0, 19);
    const short = incidentWhere.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 20);
    const incidentDir = path.join(this._dataDir, "incidents");
    const incidentPath = path.join(incidentDir, `INC-${ts}-${runId}-${short}.json`);

    const evidencePaths = [];
    const correctorDocs = {
      runbook_path: null,
      fix_patterns_path: null,
      spec_path: null,
      error_handling_path: null,
      robustness_path: null,
      decisions_path: null,
      index_path: null,
    };
    const recentIncidentPaths = [];
    try {
      // Corrector "runbook" context (Antidex repo docs)
      const root = this._rootDir || process.cwd();
      correctorDocs.runbook_path = path.join(root, "doc", "CORRECTOR_RUNBOOK.md");
      correctorDocs.fix_patterns_path = path.join(root, "doc", "CORRECTOR_FIX_PATTERNS.md");
      correctorDocs.spec_path = path.join(root, "doc", "SPEC.md");
      correctorDocs.error_handling_path = path.join(root, "doc", "ERROR_HANDLING.md");
      correctorDocs.robustness_path = path.join(root, "doc", "ROBUSTNESS_IMPROVEMENTS.md");
      correctorDocs.decisions_path = path.join(root, "doc", "DECISIONS.md");
      correctorDocs.index_path = path.join(root, "doc", "INDEX.md");

      // Recent incidents for this run (so the Corrector sees "history" beyond the current incident).
      try {
        if (fs.existsSync(incidentDir)) {
          const files = fs
            .readdirSync(incidentDir)
            .filter((n) => n.includes(`-${runId}-`) && n.endsWith(".json"))
            .sort();
          const take = files.slice(Math.max(0, files.length - 6));
          for (const f of take) recentIncidentPaths.push(path.join(incidentDir, f));
        }
      } catch {
        // ignore
      }

      evidencePaths.push(path.join(this._dataDir, "pipeline_state.json"));
      if (run.projectPipelineStatePath) evidencePaths.push(run.projectPipelineStatePath);
      if (run.projectRecoveryLogPath) evidencePaths.push(run.projectRecoveryLogPath);
      if (run.currentTaskId && run.projectTasksDir) evidencePaths.push(path.join(run.projectTasksDir, run.currentTaskId));
      if (Array.isArray(run.logFiles)) {
        for (const lf of run.logFiles.slice(-6)) {
          if (lf?.assistantLogPath) evidencePaths.push(lf.assistantLogPath);
          if (lf?.rpcLogPath) evidencePaths.push(lf.rpcLogPath);
        }
      }
    } catch {
      // ignore
    }

    ensureDir(path.dirname(incidentPath));
    const incidentData = {
      where: incidentWhere,
      signature: incidentSig,
      run_id: runId,
      project_cwd: run.cwd,
      task_id: run.currentTaskId,
      context: String(context || ""),
      expected: "Pipeline to advance smoothly",
      observed: incidentMsg || "Unknown error or guardrail blocked the pipeline",
      last_error: run.lastError,
      evidence_paths: evidencePaths,
      corrector_docs: correctorDocs,
      run_timeline_path: this._runTimelinePath(runId),
      run_summary_path: this._runSummaryPath(runId),
      recent_incident_paths: recentIncidentPaths,
      attempts: run.correctorTotalCount || 0,
      corrector_enabled: !!run.enableCorrector,
      would_trigger_corrector: !skipCorrectorForMissingSpec,
    };

    // "Bundle" artifact: a stable pointer file the Corrector can read first.
    // This lets us evolve corrector context without breaking incident schema.
    const bundlePath = incidentPath.replace(/(\.json)$/, "_bundle$1");
    try {
      writeJsonAtomic(bundlePath, {
        at: nowIso(),
        run_id: runId,
        incident_path: incidentPath,
        corrector_docs: correctorDocs,
        run_timeline_path: incidentData.run_timeline_path,
        run_summary_path: incidentData.run_summary_path,
        recent_incident_paths: recentIncidentPaths,
        evidence_paths: evidencePaths,
      });
      incidentData.bundle_path = bundlePath;
    } catch {
      // ignore
    }
    try {
      writeJsonAtomic(incidentPath, incidentData);
    } catch {
      // ignore
    }
    try {
      const relIncident = path.relative(this._dataDir, incidentPath).replace(/\\/g, "/");
      this._appendRunTimeline(runId, {
        type: "incident_created",
        where: incidentWhere,
        sig: incidentSig,
        incident: relIncident,
      });
    } catch {
      // ignore
    }

    if (skipCorrectorForMissingSpec) {
      this.emit("event", {
        runId,
        event: "diag",
        data: {
          role: "system",
          type: "info",
          message: "Missing task spec after TODO rebase: Manager action required (Corrector skipped).",
        },
      });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "manager_action_required", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    // External-corrector mode: do NOT run the in-process Corrector.
    // Instead, stop the run and write a stable "pending" marker that an external daemon can pick up.
    //
    // Rationale: the external daemon has better process-level control (restart, port recovery, crash isolation),
    // and can decide whether to run the heavy Corrector vs ask for manual intervention.
    const externalCorrectorEnabled = process.env.ANTIDEX_EXTERNAL_CORRECTOR === "1";
    if (externalCorrectorEnabled) {
      try {
        const pendingDir = path.join(this._dataDir, "external_corrector");
        ensureDir(pendingDir);
        const pendingPath = path.join(pendingDir, "pending.json");
        writeJsonAtomic(pendingPath, {
          at: nowIso(),
          runId,
          where: incidentWhere,
          sig: incidentSig,
          incidentPath: path.resolve(String(incidentPath || "")),
          bundlePath: incidentData?.bundle_path ? path.resolve(String(incidentData.bundle_path)) : null,
          context: String(context || ""),
        });
      } catch {
        // ignore
      }

      try {
        const snap = this._getRunRequired(runId);
        snap.status = "stopped";
        snap.developerStatus = "blocked";
        snap.managerDecision = null;
        snap.lastError = { message: incidentMsg || "Incident pending external corrector", at: nowIso(), where: "corrector/external_pending" };
        this._setRun(runId, snap);
      } catch {
        // ignore
      }

      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "warning", message: "External corrector mode: run stopped and pending marker written (data/external_corrector/pending.json)." },
      });
      return true;
    }

    if (isAgDisabledGuardrail) {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "warning", message: "AG disabled guardrail: triggering Corrector to diagnose and propose a robust next step." },
      });
    }

    if (!supervisorEnabled) {
      this.emit("event", {
        runId,
        event: "diag",
        data: {
          role: "system",
          type: "warning",
          message:
            "Supervisor is not enabled: Corrector will still run, but cannot auto-restart Antidex. If it applies a fix that requires a restart, you will need to restart Antidex manually.",
        },
      });
    }

    if (!run.enableCorrector) {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: "Correcteur disabled: auto-fix would have been attempted here." },
      });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "disabled", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    if (incidentWhere === "ag/watchdog") {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: "AG watchdog stall: Manager action required; Correcteur will not attempt an auto-fix." },
      });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "ag_watchdog", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    if (incidentWhere === "job/crash") {
      this.emit("event", {
        runId,
        event: "diag",
        data: { role: "system", type: "info", message: "Long job crash: Manager action required; Correcteur will not attempt an auto-fix." },
      });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "job_crash", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    if (isUserStop) {
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "info", message: "Run stopped by user: Correcteur will not attempt an auto-fix." } });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "user_stop", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    // 1. Verify loop caps (only when enabled)
    run.correctorIncidentCounts = run.correctorIncidentCounts || {};
    run.correctorTotalCount = run.correctorTotalCount || 0;

    const countSignature = run.correctorIncidentCounts[incidentSig] || 0;
    const maxPerSignature = clampInt(parseInt(process.env.ANTIDEX_CORRECTOR_MAX_ATTEMPTS_PER_SIGNATURE || "5", 10), 1, 50);
    const maxTotalRaw = process.env.ANTIDEX_CORRECTOR_MAX_TOTAL_ATTEMPTS;
    const maxTotal = maxTotalRaw ? clampInt(parseInt(maxTotalRaw, 10), 1, 10_000) : Infinity;

    if (countSignature >= maxPerSignature || run.correctorTotalCount >= maxTotal) {
      const capMsg =
        countSignature >= maxPerSignature
          ? `per-signature cap reached (${countSignature}/${maxPerSignature}) for ${incidentSig}`
          : `total cap reached (${run.correctorTotalCount}/${maxTotal})`;
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "warning", message: `Correcteur loop cap reached: ${capMsg}. Surface to Manager.` } });
      try {
        this._appendRunTimeline(runId, { type: "corrector_skipped", reason: "cap_reached", sig: incidentSig });
      } catch {
        // ignore
      }
      return false;
    }

    run.correctorIncidentCounts[incidentSig] = countSignature + 1;
    run.correctorTotalCount += 1;
    this._setRun(runId, run);

    this.emit("event", { runId, event: "diag", data: { role: "system", type: "warning", message: `Triggering Corrector for incident: ${incidentSig}` } });
    try {
      const relIncident = path.relative(this._dataDir, incidentPath).replace(/\\/g, "/");
      this._appendRunTimeline(runId, { type: "corrector_triggered", sig: incidentSig, incident: relIncident });
    } catch {
      // ignore
    }

    // 2. Trigger auto-fix pipeline
    await this._runCorrector(runId, incidentPath, incidentData);
    return true;
  }

  _forcePostIncidentReview(runId, { incidentPath, incidentData } = {}) {
    // Best-effort: if anything fails here, we fall back to the default incident flow.
    try {
      const run = this._getRunRequired(runId);
      if (!run?.cwd || !run?.projectPipelineStatePath) return false;
      if (!run.currentTaskId) return false;

      const { taskDir, taskId, taskDirRel } = taskContext(run);
      const incidentAbs = incidentPath ? path.resolve(String(incidentPath)) : null;
      const resultAbs = incidentAbs ? incidentAbs.replace(/(\.json)$/, "_result$1") : null;
      const bundleAbs = (() => {
        try {
          const b = String(incidentData?.bundle_path || "").trim();
          return b ? path.resolve(b) : incidentAbs ? incidentAbs.replace(/(\.json)$/, "_bundle$1") : null;
        } catch {
          return incidentAbs ? incidentAbs.replace(/(\.json)$/, "_bundle$1") : null;
        }
      })();

      const relIncident = incidentAbs ? path.relative(this._dataDir, incidentAbs).replace(/\\/g, "/") : null;
      const relResult = resultAbs ? path.relative(this._dataDir, resultAbs).replace(/\\/g, "/") : null;
      const relBundle = bundleAbs ? path.relative(this._dataDir, bundleAbs).replace(/\\/g, "/") : null;
      const fixStatus = incidentData?.fix_status ? String(incidentData.fix_status) : "unknown";
      const where = incidentData?.where ? String(incidentData.where) : String(run.lastError?.where || "unknown");
      const sig = incidentData?.signature ? String(incidentData.signature) : null;
      const obs = incidentData?.observed ? String(incidentData.observed) : null;
      const fixError = incidentData?.fix_error ? String(incidentData.fix_error) : null;

      const qAbs = writeTaskQuestion({
        taskDir,
        prefix: "Q-post-incident",
        title: `Post-incident review required — ${taskId}`,
        body: [
          "A Corrector was triggered for an incident on this run. Before resuming dispatch/review, the Manager must take a step back and decide how to proceed.",
          "",
          "Required actions (Manager):",
          `1) Read the incident bundle + result:`,
          `   - incident: ${relIncident || incidentAbs || "(missing)"}`,
          `   - result: ${relResult || resultAbs || "(missing)"}`,
          `   - bundle: ${relBundle || bundleAbs || "(missing)"}`,
          "",
          "2) Write a short response under the task folder:",
          `   - ${taskDirRel}/answers/A-post-incident-<id>.md`,
          "",
          "Template (minimum):",
          "- Incident: <file or signature>",
          "- What happened: <1 paragraph>",
          "- Decision: continue|blocked|completed",
          "- Plan change: <list changes> OR 'none (why)'",
          "",
          "3) Update data/pipeline_state.json to reflect your decision, then click Continue pipeline.",
          "",
          "Summary (for context):",
          `- where: ${where}`,
          ...(sig ? [`- signature: ${sig}`] : []),
          ...(obs ? [`- observed: ${obs}`] : []),
          `- corrector_fix_status: ${fixStatus}`,
          ...(fixError ? [`- corrector_fix_error: ${clampString(fixError, 500)}`] : []),
        ].join("\n"),
      });
      const relQ = relPathForPrompt(run.cwd, qAbs);

      // Update project pipeline_state.json so the run is recoverable across restarts.
      try {
        const psRead = readJsonBestEffort(run.projectPipelineStatePath);
        const ps = psRead.ok && psRead.value && typeof psRead.value === "object" ? psRead.value : {};
        ps.developer_status = "blocked";
        ps.manager_decision = null;
        const existing = typeof ps.summary === "string" ? String(ps.summary) : "";
        const msg = `Orchestrator: post-incident review required for ${taskId} (see ${relQ}).`;
        ps.summary = existing ? `${existing}\n${msg}` : msg;
        ps.updated_at = nowIso();
        writeJsonAtomic(run.projectPipelineStatePath, ps);
      } catch {
        // ignore
      }

      // Align in-memory state for immediate routing.
      try {
        const snap = this._getRunRequired(runId);
        snap.status = snap.status === "paused" || snap.status === "canceled" ? snap.status : "implementing";
        snap.developerStatus = "blocked";
        snap.managerDecision = null;
        snap.lastError = { message: `Post-incident review required for ${taskId} (see ${relQ})`, at: nowIso(), where: "guardrail/post_incident_review" };
        if (snap.activeTurn) snap.activeTurn = null;
        this._setRun(runId, snap);
      } catch {
        // ignore
      }

      try {
        this.emit("event", { runId, event: "diag", data: { role: "system", type: "warning", message: `Post-incident review required (see ${relQ}).` } });
      } catch {
        // ignore
      }

      return true;
    } catch {
      return false;
    }
  }

  _normalizeCorrectorIncidentSignature({ where, message, taskId }) {
    const w = String(where || "unknown").trim() || "unknown";
    const m = String(message || "").trim();
    const t = taskId ? String(taskId).trim() : null;

    // Make signatures stable across retries by stripping volatile ids/timestamps from messages.
    const stripVolatile = (s) =>
      String(s || "")
        .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
        .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/g, "<ts>")
        .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\b/g, "<ts>")
        .replace(/\(\d+\/\d+\)/g, "(<n>/<m>)")
        .replace(/Q-[^\s)]+/g, "Q-<id>");

    // Stable signatures per class (prefer deterministic fields over the raw message).
    if (w === "guardrail/missing_task_spec") return `guardrail/missing_task_spec:${t || "<no_task>"}`;
    if (w === "guardrail/dispatch_loop") return `guardrail/dispatch_loop:${t || "<no_task>"}`;
    if (w === "guardrail/review_loop") return `guardrail/review_loop:${t || "<no_task>"}`;
    if (w === "guardrail/loop") return `guardrail/loop:${t || "<no_task>"}`;
    if (w === "ag/watchdog") return `ag/watchdog:${t || "<no_task>"}`;
    if (w === "turn/inactivity") return `turn/inactivity:${t || "<no_task>"}`;
    if (w === "turn/hard_timeout") return `turn/hard_timeout:${t || "<no_task>"}`;

    if (w === "auto") {
      const connRefused = m.match(/ECONNREFUSED\s+([0-9.]+):(\d+)/i);
      if (connRefused) return `auto:ECONNREFUSED:${connRefused[1]}:${connRefused[2]}`;
      const enoent = m.match(/\bENOENT\b/i);
      if (enoent) return `auto:ENOENT:${stripVolatile(m).slice(0, 120)}`;
    }

    const normMsg = stripVolatile(m).slice(0, 160);
    return normMsg ? `${w}:${t ? `${t}:` : ""}${normMsg}` : `${w}:${t || "<no_task>"}`;
  }

  async _runCorrector(runId, incidentPath, incidentData) {
    const run = this._getRunRequired(runId);
    this.emit("event", { runId, event: "diag", data: { role: "system", type: "info", message: `Corrector agent starting for ${path.basename(incidentPath)}...` } });
    try {
      const relIncident = path.relative(this._dataDir, incidentPath).replace(/\\/g, "/");
      this._appendRunTimeline(runId, { type: "corrector_start", incident: relIncident });
    } catch {
      // ignore
    }

    run.status = "implementing";
    run.developerStatus = "auto_fixing";
    this._setRun(runId, run);

    // Deterministic test mode: simulate a successful fix without invoking Codex.
    // This validates incident -> corrector -> restart -> auto-resume end-to-end under supervisor,
    // without depending on LLM behavior.
    if (process.env.ANTIDEX_TEST_FAKE_CORRECTOR === "1") {
      try {
        const outDir = path.join(this._dataDir, "corrector_test");
        ensureDir(outDir);
        writeJsonAtomic(path.join(outDir, `fix_${nowIsoForFile()}.json`), {
          run_id: runId,
          incident_path: path.resolve(String(incidentPath || "")),
          where: incidentData?.where || null,
          observed: incidentData?.observed || null,
          at: nowIso(),
        });
      } catch {
        // ignore
      }

      incidentData.fix_status = "success";
      writeJsonAtomic(incidentPath.replace(/(\.json)$/, "_result$1"), incidentData);

      // Post-incident review (required): surface what happened + what changed before resuming.
      this._forcePostIncidentReview(runId, { incidentPath, incidentData });

      // Put the run back into a resumable state so the auto-resume call can proceed normally.
      try {
        const snap = this._getRunRequired(runId);
        snap.status = "stopped";
        snap.developerStatus = "idle";
        snap.managerDecision = null;
        snap.lastError = null;
        snap.activeTurn = null;
        this._setRun(runId, snap);
      } catch {
        // ignore
      }

      // Write a system-level resume marker, then restart under supervisor.
      ensureDir(path.join(this._dataDir, "auto_resume"));
      writeJsonAtomic(path.join(this._dataDir, "auto_resume", "pending.json"), { runId });
      try {
        writeJsonAtomic(path.join(this._dataDir, "auto_resume", "restart_request.json"), {
          at: nowIso(),
          runId,
          reason: "corrector_fix_applied",
          incident: path.resolve(String(incidentPath || "")),
          mode: "test_fake_corrector",
        });
      } catch {
        // ignore
      }
      try {
        this._appendRunTimeline(runId, { type: "restart_requested", reason: "corrector_fix_applied", mode: "test_fake_corrector" });
      } catch {
        // ignore
      }

      setTimeout(() => {
        if (process.env.ANTIDEX_SUPERVISOR === "1") process.exit(42);
      }, 200);
      return true;
    }

    const antidexRoot = this._rootDir;
    const incidentAbs = path.resolve(String(incidentPath || ""));
    const runbookAbs = path.join(antidexRoot, "doc", "CORRECTOR_RUNBOOK.md");
    const patternsAbs = path.join(antidexRoot, "doc", "CORRECTOR_FIX_PATTERNS.md");
    const bundleAbs = (() => {
      try {
        const b = String(incidentData?.bundle_path || "").trim();
        return b ? path.resolve(b) : incidentAbs.replace(/(\.json)$/, "_bundle$1");
      } catch {
        return incidentAbs.replace(/(\.json)$/, "_bundle$1");
      }
    })();
    const prompt = [
      "READ FIRST (role: corrector)",
      "You are the Antidex Corrector (auto-fix). Your goal is to unblock the pipeline by fixing Antidex itself.",
      "",
      `Antidex repo root (cwd): ${antidexRoot}`,
      "Corrector context (read these FIRST):",
      `- Runbook (Normal vs Change): ${runbookAbs}`,
      `- Fix patterns (memory): ${patternsAbs}`,
      "",
      "Incident bundle (read before the incident, if present):",
      `- ${bundleAbs}`,
      `Incident file (read it first): ${incidentAbs}`,
      `Target project (read-only context): ${run.cwd}`,
      "",
      `Expected vs observed: ${incidentData.expected} -> ${incidentData.observed}`,
      `Error: ${incidentData.last_error?.message || "none"}`,
      "",
      "Rules:",
      "- Implement the fix by editing Antidex code directly on disk (server/web/scripts/docs as needed).",
      "- Keep the fix minimal and robust (Antidex must run 12h+).",
      "- Prefer PROCESS fixes (guardrails/invariants/instrumentation/retries) that prevent the incident class from recurring, over ad-hoc changes.",
      "- The runbook/patterns are the BASE: if you hit a special case not covered, you MAY evolve them (without breaking 'NORMAL' invariants) and record the change in doc/DECISIONS.md + update doc/CORRECTOR_FIX_PATTERNS.md.",
      "- After changes, run a quick smoke check from the Antidex repo (e.g. `npm -s test:api` OR a minimal node require check).",
      "- Conclude with a short summary of what you changed and why.",
    ].join("\n");

    const correctorThreadId = run.correctorThreadId || null;

    try {
      const sandbox = DEFAULT_SANDBOX;
      const approvalPolicy = DEFAULT_APPROVAL_POLICY;
      let threadResp;
      if (correctorThreadId) {
        try {
          threadResp = await this._codex.threadResume({ threadId: correctorThreadId, cwd: antidexRoot, sandbox, approvalPolicy, model: run.developerModel });
        } catch (e) {
          const msg = safeErrorMessage(e);
          const invalidThread =
            /\binvalid thread id\b/i.test(msg) ||
            /\burn:uuid\b/i.test(msg) ||
            // Note: some codex app-server RPC errors are serialized like `{"code":-32600,"message":"..."}`.
            // `\b-32600\b` does NOT match `:-32600` (non-word char before `-`), so use a simple contains() guard.
            msg.includes("-32600") ||
            /\bno rollout found\b/i.test(msg);
          if (!invalidThread) throw e;
          this.emit("event", {
            runId,
            event: "diag",
            data: { role: "system", type: "warn", message: `Corrector thread resume failed (${msg}). Starting a new thread.` },
          });
          threadResp = await this._codex.threadStart({ cwd: antidexRoot, sandbox, approvalPolicy, model: run.developerModel });
          // Force update of the stored thread id below.
          run.correctorThreadId = null;
        }
      } else {
        threadResp = await this._codex.threadStart({ cwd: antidexRoot, sandbox, approvalPolicy, model: run.developerModel });
      }
      const threadId = String(threadResp?.thread?.id ?? threadResp?.threadId ?? "");

      if (!run.correctorThreadId && threadId) {
        run.correctorThreadId = threadId;
        this._setRun(runId, run);
      }

      const turnPromise = this._runTurn({
        runId,
        role: "developer_codex",
        step: "corrector",
        threadId,
        model: run.developerModel,
        prompt
      });

      // Default behavior: no artificial timeout for the Corrector, because it is supposed to unblock long runs.
      // You can re-enable a timeout via env var if needed for CI or debugging (milliseconds).
      const timeoutMsRaw = (process.env.ANTIDEX_CORRECTOR_TURN_TIMEOUT_MS || "").trim();
      const timeoutMs = timeoutMsRaw ? Number(timeoutMsRaw) : 0;
      const turnRes =
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? await withTimeout(turnPromise, timeoutMs, "Corrector turn timed out")
          : await turnPromise;

      if (turnRes.turnStatus === "failed") {
        throw new Error(turnRes.errorMessage || "Corrector turn failed");
      }
    } catch (e) {
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "error", message: `Corrector run failed: ${safeErrorMessage(e)}` } });
      incidentData.fix_status = "failed";
      incidentData.fix_error = safeErrorMessage(e);
      writeJsonAtomic(incidentPath.replace(/(\.json)$/, "_result$1"), incidentData);
      // Post-incident review (required) even when the Corrector fails.
      this._forcePostIncidentReview(runId, { incidentPath, incidentData });
      return false;
    } finally {
      // setLogPath is managed by _runTurn itself
    }

    // Quick smoke check: ensure Antidex JS can be required after the fix (syntax / module errors).
    try {
      const { spawnSync } = require("node:child_process");
      const r = spawnSync(
        process.execPath,
        ["-e", "require('./server/pipelineManager.js'); console.log('ok')"],
        { cwd: antidexRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      if (r.status !== 0) {
        const stderr = (r.stderr || Buffer.from("")).toString("utf8").trim();
        throw new Error(stderr || `smoke check failed (exit=${r.status})`);
      }
    } catch (e) {
      this.emit("event", { runId, event: "diag", data: { role: "system", type: "error", message: `Corrector smoke check failed: ${safeErrorMessage(e)}` } });
      incidentData.fix_status = "failed";
      incidentData.fix_error = `smoke check failed: ${safeErrorMessage(e)}`;
      writeJsonAtomic(incidentPath.replace(/(\.json)$/, "_result$1"), incidentData);
      this._forcePostIncidentReview(runId, { incidentPath, incidentData });
      return false;
    }

    incidentData.fix_status = "success";
    writeJsonAtomic(incidentPath.replace(/(\.json)$/, "_result$1"), incidentData);
    // Post-incident review (required) before resuming the pipeline after a Corrector-triggering incident.
    this._forcePostIncidentReview(runId, { incidentPath, incidentData });
    try {
      const relIncident = path.relative(this._dataDir, incidentPath).replace(/\\/g, "/");
      this._appendRunTimeline(runId, { type: "corrector_done", fix_status: "success", incident: relIncident });
    } catch {
      // ignore
    }

    this.emit("event", { runId, event: "diag", data: { role: "system", type: "info", message: "Corrector finished. Restarting server via code 42..." } });

    // We clear the active turn and running lock before exiting so we don't lock forever
    try {
      const snap = this._getRunRequired(runId);
      if (snap.activeTurn) snap.activeTurn = null;
      this._setRun(runId, snap);
      this._releaseRunningLock(runId);
    } catch {
      // ignore
    }

    // Write a system-level resume marker
    ensureDir(path.join(this._dataDir, "auto_resume"));
    writeJsonAtomic(path.join(this._dataDir, "auto_resume", "pending.json"), { runId });
    try {
      writeJsonAtomic(path.join(this._dataDir, "auto_resume", "restart_request.json"), {
        at: nowIso(),
        runId,
        reason: "corrector_fix_applied",
        incident: path.resolve(String(incidentPath || "")),
        mode: "codex_corrector",
      });
    } catch {
      // ignore
    }
    try {
      this._appendRunTimeline(runId, { type: "restart_requested", reason: "corrector_fix_applied", mode: "codex_corrector" });
    } catch {
      // ignore
    }

    const supervisorEnabled = process.env.ANTIDEX_SUPERVISOR === "1";
    if (!supervisorEnabled) {
      try {
        const snap = this._getRunRequired(runId);
        this._clearActiveLongJobReference(snap, { preserveLastJobId: true });
        snap.status = "stopped";
        snap.developerStatus = "idle";
        snap.managerDecision = null;
        snap.lastError = { message: "Corrector applied fix; restart Antidex to continue.", at: nowIso(), where: "corrector/restart_required" };
        this._setRun(runId, snap);
      } catch {
        // ignore
      }
      try {
        const stateRead = readJsonBestEffort(run.projectPipelineStatePath);
        const state = stateRead.ok && stateRead.value && typeof stateRead.value === "object" ? stateRead.value : {};
        state.developer_status = "idle";
        state.manager_decision = null;
        state.summary = "Corrector applied fix; restart Antidex to continue.";
        state.updated_at = nowIso();
        writeJsonAtomic(run.projectPipelineStatePath, state);
      } catch {
        // ignore
      }
    }

    setTimeout(() => {
      if (supervisorEnabled) {
        process.exit(42);
      } else {
        this.emit("event", {
          runId,
          event: "diag",
          data: {
            role: "system",
            type: "warning",
            message: "Corrector applied a fix but supervisor is not enabled. Restart Antidex via `node scripts/supervisor.js` to resume automatically.",
          },
        });
      }
    }, 500);

    return true;
  }

  async runExternalCorrectorPending() {
    const pendingPath = path.join(this._dataDir, "external_corrector", "pending.json");
    const pendingRead = readJsonBestEffort(pendingPath);
    if (!pendingRead.ok || !pendingRead.value || typeof pendingRead.value !== "object") {
      throw new Error("No external corrector pending marker found");
    }
    const pending = pendingRead.value;
    const runId = pending?.runId ? String(pending.runId) : null;
    const incidentPath = pending?.incidentPath ? String(pending.incidentPath) : null;
    if (!runId) throw new Error("Pending marker missing runId");
    if (!incidentPath) throw new Error("Pending marker missing incidentPath");

    const incidentRead = readJsonBestEffort(incidentPath);
    if (!incidentRead.ok || !incidentRead.value || typeof incidentRead.value !== "object") {
      throw new Error(`Could not read incident: ${incidentPath}`);
    }

    // Mark handled (best-effort) before running: if the Corrector triggers a restart, we don't want to re-run it on boot.
    try {
      const dir = path.dirname(pendingPath);
      ensureDir(dir);
      const handled = path.join(dir, `handled_${nowIsoForFile()}.json`);
      fs.renameSync(pendingPath, handled);
    } catch {
      // ignore
    }

    await this._runCorrector(runId, incidentPath, incidentRead.value);
    return { ok: true };
  }
}

module.exports = { PipelineManager };
