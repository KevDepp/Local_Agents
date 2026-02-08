const http = require("node:http");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { CodexAppServerClient, resolveCodexCandidates } = require("./codexAppServerClient");
const { StateStore } = require("./stateStore");
const { listRoots, listDirs } = require("./fsApi");

const ROOT_DIR = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const DATA_DIR = path.join(ROOT_DIR, "data");
const STATE_PATH = path.join(DATA_DIR, "state.json");
const LOGS_DIR = path.join(DATA_DIR, "logs");

const DEFAULT_SANDBOX = "danger-full-access";
const DEFAULT_APPROVAL_POLICY = "never";

const FALLBACK_MODELS = ["gpt-5.2-codex", "gpt-5.1", "gpt-5-mini", "gpt-4.1", "o3-mini"];

function parseAllowedRoots() {
  const raw = String(process.env.CWD_ROOTS || "").trim();
  if (!raw) return [];
  const sep = process.platform === "win32" ? ";" : ":";
  const roots = raw
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p))
    .filter((p) => {
      try {
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
  return roots;
}

function isPathWithin(root, target) {
  try {
    const rel = path.relative(root, target);
    if (rel === "") return true;
    if (rel.startsWith("..") || path.isAbsolute(rel)) return false;
    return true;
  } catch {
    return false;
  }
}

const ALLOWED_ROOTS = parseAllowedRoots();

function isPathAllowed(targetPath) {
  if (!ALLOWED_ROOTS.length) return true;
  const resolved = path.resolve(targetPath);
  return ALLOWED_ROOTS.some((root) => isPathWithin(root, resolved));
}

function getCodexStatus() {
  const { envPath, extPath, pathPath } = resolveCodexCandidates();
  if (envPath) return { ok: true, source: "CODEX_EXE", path: envPath, hint: null };
  if (pathPath) return { ok: true, source: "PATH", path: pathPath, hint: null };
  if (extPath) return { ok: true, source: "VSCODE_EXTENSION", path: extPath, hint: null };
  return {
    ok: false,
    source: "NOT_FOUND",
    path: null,
    hint: "Set CODEX_EXE, install the VS Code Codex extension, or add codex to PATH.",
  };
}

function getOpenAiApiKeyInfo() {
  const present = Boolean(process.env.OPENAI_API_KEY && String(process.env.OPENAI_API_KEY).trim());
  const pass = String(process.env.CODEX_PASS_OPENAI_API_KEY || "").trim().toLowerCase();
  const passedToCodex = pass === "1" || pass === "true" || pass === "yes";
  return {
    openaiApiKeyPresentInEnv: present,
    openaiApiKeyPassedToCodex: present && passedToCodex,
  };
}

let cachedLoginStatus = { atMs: 0, kind: "unknown", raw: null, error: null };
function getCodexLoginStatus() {
  const now = Date.now();
  if (now - cachedLoginStatus.atMs < 10_000) return cachedLoginStatus;

  const s = getCodexStatus();
  if (!s.ok || !s.path) {
    cachedLoginStatus = { atMs: now, kind: "unknown", raw: null, error: "codex not found" };
    return cachedLoginStatus;
  }

  try {
    const r = spawnSync(s.path, ["login", "status"], { encoding: "utf8", windowsHide: true });
    const out = String(r.stdout || "").trim();
    const err = String(r.stderr || "").trim();
    const raw = out || err || null;
    const lower = (raw || "").toLowerCase();
    const kind = lower.includes("chatgpt")
      ? "chatgpt"
      : lower.includes("api key") || lower.includes("openai api")
        ? "api_key"
        : "unknown";
    cachedLoginStatus = { atMs: now, kind, raw: raw ? raw.split(/\r?\n/)[0] : null, error: null };
    return cachedLoginStatus;
  } catch (e) {
    cachedLoginStatus = { atMs: now, kind: "unknown", raw: null, error: safeErrorMessage(e) };
    return cachedLoginStatus;
  }
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

function sendJson(res, status, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(json);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(text);
}

function readJson(req, { maxBytes = 2 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0;
    let data = "";
    req.on("data", (chunk) => {
      const s = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      total += Buffer.byteLength(s, "utf8");
      if (total > maxBytes) {
        reject(new Error(`Body too large (> ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      data += s;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function contentTypeForExt(ext) {
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function serveStatic(req, res, pathname) {
  let p = pathname;
  if (p === "/") p = "/index.html";
  if (p.includes("..")) {
    sendText(res, 400, "Bad path");
    return;
  }
  const filePath = path.join(WEB_DIR, p);
  if (!filePath.startsWith(WEB_DIR)) {
    sendText(res, 400, "Bad path");
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 404, "Not found");
    return;
  }
  const bytes = fs.readFileSync(filePath);
  sendText(res, 200, bytes, contentTypeForExt(path.extname(filePath).toLowerCase()));
}

function getTodaySessionsDir() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return path.join(os.homedir(), ".codex", "sessions", yyyy, mm, dd);
}

function findBestEffortRolloutPath({ startedAtMs, threadId }) {
  const dir = getTodaySessionsDir();
  if (!fs.existsSync(dir)) return null;

  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("rollout-") && n.endsWith(".jsonl"))
      .map((n) => path.join(dir, n))
      .map((p) => ({ p, st: fs.statSync(p) }))
      .filter((x) => x.st.isFile())
      .filter((x) => x.st.mtimeMs >= startedAtMs - 2_000)
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
      .slice(0, 10);
  } catch {
    return null;
  }

  const idNeedle = threadId ? `"${threadId}"` : null;
  for (const f of files) {
    if (!idNeedle) return f.p;
    try {
      const raw = fs.readFileSync(f.p, "utf8");
      if (raw.includes(idNeedle)) return f.p;
    } catch {
      // ignore
    }
  }

  return files[0]?.p ?? null;
}

function sseSend(res, { event, data }) {
  if (event) res.write(`event: ${event}\n`);
  const payload = typeof data === "string" ? data : JSON.stringify(data);
  for (const line of payload.split(/\r?\n/)) res.write(`data: ${line}\n`);
  res.write("\n");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const state = new StateStore({ filePath: STATE_PATH });

const codex = new CodexAppServerClient({ trace: false });
const runs = new Map();
let activeRunId = null;

function getActiveRun() {
  if (!activeRunId) return null;
  return runs.get(activeRunId) ?? null;
}

function pushRunEvent(run, evt) {
  run.events.push(evt);
  if (run.events.length > 2000) run.events.splice(0, run.events.length - 2000);
  for (const client of run.clients) {
    try {
      sseSend(client, evt);
    } catch {
      // ignore
    }
  }
}

function matchesRun(run, params) {
  if (!params || typeof params !== "object") return false;
  const tid = params.threadId ? String(params.threadId) : null;
  const turnId = params.turnId ? String(params.turnId) : null;
  const completedTurnId = params.turn?.id ? String(params.turn.id) : null;

  if (run.threadId && tid && tid !== run.threadId) return false;
  if (run.turnId && turnId && turnId !== run.turnId) return false;
  if (run.turnId && completedTurnId && completedTurnId !== run.turnId) return false;
  return true;
}

codex.on("notification", (msg) => {
  const run = getActiveRun();
  if (!run) return;

  const method = String(msg.method || "");
  const params = msg.params;
  if (!matchesRun(run, params)) return;

  if (method === "turn/started") {
    try {
      run.threadId = String(params.threadId ?? run.threadId ?? "");
      run.turnId = String(params.turn?.id ?? run.turnId ?? "");
      pushRunEvent(run, { event: "meta", data: { threadId: run.threadId, turnId: run.turnId } });
    } catch {
      // ignore
    }
    return;
  }

  if (method === "item/agentMessage/delta") {
    const delta = String(params.delta ?? "");
    if (!delta) return;
    run.assistantText += delta;
    pushRunEvent(run, { event: "delta", data: delta });
    return;
  }

  if (method === "item/completed") {
    try {
      const item = params.item;
      if (item && item.type === "agentMessage" && typeof item.text === "string") {
        run.assistantText = item.text;
      }
    } catch {
      // ignore
    }
    return;
  }

  if (method === "error") {
    try {
      const msg = params?.error?.message ? String(params.error.message) : "Unknown error";
      run.lastErrorMessage = msg;
      pushRunEvent(run, { event: "diag", data: { type: "error", message: msg } });
    } catch {
      // ignore
    }
    return;
  }

  if (method === "turn/completed") {
    void (async () => {
      const didRetry = await retryIfUnsupportedEffort({
        run,
        params: params?.turn ? params : { turn: params?.turn, threadId: params?.threadId },
        approvalPolicy: DEFAULT_APPROVAL_POLICY,
      });
      if (didRetry) return;

      run.status = String(params.turn?.status ?? "completed");
      run.lastErrorMessage =
        run.status === "failed" && params.turn?.error?.message
          ? String(params.turn.error.message)
          : run.lastErrorMessage || null;
      run.completedAtMs = Date.now();
      run.rolloutPath = findBestEffortRolloutPath({
        startedAtMs: run.startedAtMs,
        threadId: run.threadId,
      });
      activeRunId = null;
      codex.setLogPath(null);
      pushRunEvent(run, {
        event: "completed",
        data: {
          status: run.status,
          threadId: run.threadId,
          turnId: run.turnId,
          logPath: run.logPath,
          rolloutPath: run.rolloutPath,
          assistantText: run.assistantText,
          errorMessage: run.lastErrorMessage,
        },
      });
    })();
    return;
  }
});

async function getModelsBestEffort() {
  if (codex.isRunning()) {
    try {
      await codex.initialize();
      const r = await codex.modelList();
      const entries = extractModelEntries(r);
      if (entries.length) {
        const ids = entries
          .map((m) => (m && typeof m === "object" ? m.id || m.model || m.name : null))
          .filter(Boolean)
          .map(String);
        if (ids.length) return { source: "app-server", models: Array.from(new Set(ids)) };
      }
    } catch {
      // ignore
    }
  }
  return { source: "fallback", models: FALLBACK_MODELS };
}

function extractModelEntries(r) {
  if (!r) return [];
  if (Array.isArray(r.data)) return r.data.filter((x) => x && typeof x === "object");
  if (Array.isArray(r.models)) return r.models.filter((x) => x && typeof x === "object");
  if (Array.isArray(r)) return r.filter((x) => x && typeof x === "object");
  return [];
}

function normalizeEffort(effort) {
  const s = typeof effort === "string" ? effort.trim().toLowerCase() : "";
  if (!s) return "";
  if (s === "xh" || s === "x-high" || s === "extra-high" || s === "extra_high") return "xhigh";
  return s;
}

function pickMaxEffort(list) {
  const order = { none: 0, low: 1, medium: 2, high: 3, xhigh: 4 };
  let best = null;
  let bestScore = -1;
  for (const e of list) {
    const key = normalizeEffort(e);
    const score = order[key];
    if (score === undefined) continue;
    if (score > bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function parseSupportedEffortsFromAnyMessage(message) {
  const s = String(message || "");
  const found = new Set();
  const re = /'(none|low|medium|high|xhigh)'/gi;
  for (;;) {
    const m = re.exec(s);
    if (!m) break;
    found.add(String(m[1]).toLowerCase());
  }
  return Array.from(found);
}

async function retryIfUnsupportedEffort({ run, params, approvalPolicy }) {
  if (!run || run.status !== "running") return false;
  if ((run.retryCount || 0) >= 1) return false;

  const status = String(params?.turn?.status || "");
  if (status.toLowerCase() !== "failed") return false;

  const errMsg = params?.turn?.error?.message;
  const supported = parseSupportedEffortsFromAnyMessage(errMsg);
  if (!supported.length) return false;

  const max = pickMaxEffort(supported);
  if (!max) return false;

  const used = normalizeEffort(run.effortUsed || "");
  if (used && used === max) return false;

  run.retryCount = (run.retryCount || 0) + 1;
  run.assistantText = "";
  run.effortUsed = max;

  pushRunEvent(run, { event: "meta", data: { retry: true, effortUsed: run.effortUsed } });

  try {
    const turnResp = await codex.turnStart({
      threadId: run.threadId,
      prompt: run.prompt,
      approvalPolicy,
      model: run.model,
      effort: run.effortUsed,
    });
    const newTurnId = String(turnResp?.turn?.id ?? "");
    if (newTurnId) run.turnId = newTurnId;
    pushRunEvent(run, {
      event: "meta",
      data: { threadId: run.threadId, turnId: run.turnId, effortUsed: run.effortUsed },
    });
    return true;
  } catch (e) {
    pushRunEvent(run, { event: "error", data: { message: safeErrorMessage(e) } });
    return false;
  }
}

function supportedEffortsForModelEntry(entry) {
  const raw = entry?.supportedReasoningEfforts;
  if (!Array.isArray(raw) || !raw.length) return [];
  const out = raw
    .map((x) => (x && typeof x === "object" ? x.reasoningEffort : null))
    .filter(Boolean)
    .map((x) => normalizeEffort(String(x)))
    .filter(Boolean);
  return Array.from(new Set(out));
}

function findModelEntry(models, modelIdOrName) {
  const want = modelIdOrName ? String(modelIdOrName).trim() : "";
  if (want) {
    const lower = want.toLowerCase();
    const exact =
      models.find((m) => String(m.id || "").toLowerCase() === lower) ||
      models.find((m) => String(m.model || "").toLowerCase() === lower) ||
      models.find((m) => String(m.displayName || "").toLowerCase() === lower) ||
      null;
    if (exact) return exact;

    // Only do prefix aliasing when the caller is explicitly targeting a Codex model.
    // Avoid mapping generic names like "gpt-5.1" onto "gpt-5.1-codex-..." since those
    // can have different supported efforts.
    if (lower.includes("codex")) {
      const prefixMatches = models
        .map((m) => {
          const id = String(m.id || "").toLowerCase();
          const model = String(m.model || "").toLowerCase();
          const displayName = String(m.displayName || "").toLowerCase();
          const ok =
            id.startsWith(lower) || model.startsWith(lower) || displayName.startsWith(lower);
          if (!ok) return null;
          const score = Math.min(
            id ? id.length : 10_000,
            model ? model.length : 10_000,
            displayName ? displayName.length : 10_000,
          );
          return { m, score };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score);

      return prefixMatches[0]?.m || null;
    }

    return null;
  }
  return models.find((m) => m && m.isDefault) || null;
}

async function clampEffortBestEffort({ requestedEffort, model }) {
  const desired = normalizeEffort(requestedEffort) || "high";
  try {
    await codex.initialize();
    const catalog = await codex.modelList();
    const entries = extractModelEntries(catalog);
    if (!entries.length) return { desired, used: desired, source: "unknown" };

    const entry = findModelEntry(entries, model);
    const supported = supportedEffortsForModelEntry(entry);
    if (!supported.length) {
      // Unknown model: be conservative. If the user picked xhigh, clamp to high.
      // We'll still auto-retry on failure if Codex reports the supported set.
      if (desired === "xhigh") return { desired, used: "high", source: "unknown-model-clamped" };
      return { desired, used: desired, source: "model-missing-efforts" };
    }

    const supportedSet = new Set(supported);
    if (supportedSet.has(desired)) return { desired, used: desired, source: "supported" };
    return { desired, used: pickMaxEffort(supported) || desired, source: "clamped" };
  } catch {
    return { desired, used: desired, source: "error" };
  }
}

async function startRun({ prompt, cwd, model, effort, threadMode, threadId }) {
  if (getActiveRun()) throw new Error("A run is already in progress");
  ensureDir(LOGS_DIR);

  await codex.start({ cwd: ROOT_DIR });
  await codex.initialize();

  const runId = crypto.randomUUID();
  const logPath = path.join(LOGS_DIR, `run_${nowIsoForFile()}_${runId.slice(0, 8)}.log`);
  codex.setLogPath(logPath);

  const sandbox = DEFAULT_SANDBOX;
  const approvalPolicy = DEFAULT_APPROVAL_POLICY;

  const effortInfo = await clampEffortBestEffort({ requestedEffort: effort, model });

  let threadResp;
  if (threadMode === "resume") {
    threadResp = await codex.threadResume({ threadId, cwd, sandbox, approvalPolicy, model });
  } else {
    threadResp = await codex.threadStart({ cwd, sandbox, approvalPolicy, model });
  }
  const resolvedThreadId = String(threadResp?.thread?.id ?? "");
  if (!resolvedThreadId) throw new Error("thread/start|resume did not return thread.id");

  const turnResp = await codex.turnStart({
    threadId: resolvedThreadId,
    prompt,
    approvalPolicy,
    model,
    effort: effortInfo.used,
  });
  const resolvedTurnId = String(turnResp?.turn?.id ?? "");

  const run = {
    runId,
    status: "running",
    prompt,
    cwd,
    model: model || null,
    effortRequested: effortInfo.desired,
    effortUsed: effortInfo.used,
    retryCount: 0,
    threadId: resolvedThreadId,
    turnId: resolvedTurnId || null,
    assistantText: "",
    lastErrorMessage: null,
    startedAtMs: Date.now(),
    completedAtMs: null,
    logPath,
    rolloutPath: null,
    events: [],
    clients: new Set(),
  };

  runs.set(runId, run);
  activeRunId = runId;

  state.touchThread({ threadId: resolvedThreadId, cwd, model });
  state.setLastUsed({
    cwd,
    model: model || null,
    effort: effortInfo.desired,
    threadId: resolvedThreadId,
  });

  pushRunEvent(run, {
    event: "meta",
    data: {
      runId,
      status: run.status,
      cwd: run.cwd,
      model: run.model,
      effortRequested: run.effortRequested,
      effortUsed: run.effortUsed,
      threadId: run.threadId,
      turnId: run.turnId,
      logPath: run.logPath,
    },
  });

  const timeoutMs = 10 * 60 * 1000;
  setTimeout(async () => {
    const still = runs.get(runId);
    if (!still || still.status !== "running") return;
    still.status = "timeout";
    try {
      if (still.threadId && still.turnId)
        await codex.turnInterrupt({ threadId: still.threadId, turnId: still.turnId });
    } catch {
      // ignore
    } finally {
      activeRunId = null;
      codex.setLogPath(null);
      pushRunEvent(still, { event: "error", data: { message: "Timed out" } });
    }
  }, timeoutMs).unref?.();

  return { runId, threadId: resolvedThreadId, turnId: resolvedTurnId || null, logPath };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      codex: getCodexStatus(),
      login: getCodexLoginStatus(),
      ...getOpenAiApiKeyInfo(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      ok: true,
      codex: getCodexStatus(),
      login: getCodexLoginStatus(),
      ...getOpenAiApiKeyInfo(),
      cwdRestricted: ALLOWED_ROOTS.length > 0,
      allowedRoots: ALLOWED_ROOTS,
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, {
      ok: true,
      state: state.getState(),
      defaults: { sandbox: DEFAULT_SANDBOX, approvalPolicy: DEFAULT_APPROVAL_POLICY },
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/threads") {
    sendJson(res, 200, { ok: true, threads: state.getState().recentThreads });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/models") {
    const r = await getModelsBestEffort();
    sendJson(res, 200, { ok: true, ...r });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fs/roots") {
    const preferred = ALLOWED_ROOTS.length
      ? ALLOWED_ROOTS
      : [path.resolve(ROOT_DIR, ".."), state.getState().lastCwd].filter(Boolean);
    sendJson(res, 200, {
      ok: true,
      roots: listRoots({
        preferredRoots: preferred,
        includeSystemRoots: ALLOWED_ROOTS.length === 0,
      }),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fs/list") {
    const p = url.searchParams.get("path");
    if (!p) {
      sendJson(res, 400, { ok: false, error: "Missing ?path=" });
      return;
    }
    if (!isPathAllowed(p)) {
      sendJson(res, 403, { ok: false, error: "Path is outside allowed roots" });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, ...listDirs(p) });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    const body = await readJson(req);
    const prompt = body?.prompt;
    const cwd = body?.cwd;
    const model = body?.model ? String(body.model).trim() : null;
    const effortRaw = body?.effort ? String(body.effort).trim() : "";
    const effort = effortRaw ? effortRaw : null;
    const threadMode = body?.threadMode === "resume" ? "resume" : "new";
    const requestedThreadId = body?.threadId ? String(body.threadId) : null;

    if (typeof prompt !== "string") {
      sendJson(res, 400, { ok: false, error: "prompt must be a string" });
      return;
    }
    if (typeof cwd !== "string" || !cwd.trim()) {
      sendJson(res, 400, { ok: false, error: "cwd must be a non-empty string" });
      return;
    }
    const resolvedCwd = path.resolve(cwd);
    if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
      sendJson(res, 400, { ok: false, error: `cwd is not a directory: ${resolvedCwd}` });
      return;
    }
    if (!isPathAllowed(resolvedCwd)) {
      sendJson(res, 403, { ok: false, error: "cwd is outside allowed roots" });
      return;
    }

    const resumeThreadId =
      threadMode === "resume" ? requestedThreadId || state.getState().lastThreadId : null;
    if (threadMode === "resume" && !resumeThreadId) {
      sendJson(res, 400, { ok: false, error: "threadId is required in resume mode" });
      return;
    }

    try {
      const codexStatus = getCodexStatus();
      if (!codexStatus.ok) {
        sendJson(res, 500, { ok: false, error: "codex.exe not found", hint: codexStatus.hint });
        return;
      }
      const run = await startRun({
        prompt,
        cwd: resolvedCwd,
        model,
        effort,
        threadMode,
        threadId: resumeThreadId,
      });
      sendJson(res, 200, { ok: true, ...run });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stop") {
    const body = await readJson(req);
    const runId = body?.runId ? String(body.runId) : null;
    const run = runId ? runs.get(runId) : getActiveRun();
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }
    if (run.status !== "running") {
      sendJson(res, 409, { ok: false, error: `run is not running (status=${run.status})` });
      return;
    }
    try {
      if (run.threadId && run.turnId)
        await codex.turnInterrupt({ threadId: run.threadId, turnId: run.turnId });
    } catch {
      // ignore
    }
    run.status = "interrupted";
    activeRunId = null;
    codex.setLogPath(null);
    pushRunEvent(run, { event: "error", data: { message: "Interrupted" } });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/stream/")) {
    const runId = url.pathname.split("/").pop();
    const run = runs.get(runId);
    if (!run) {
      sendText(res, 404, "run not found");
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

    res.write(": ok\n\n");
    for (const evt of run.events) sseSend(res, evt);

    run.clients.add(res);

    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 15_000);
    ping.unref?.();

    req.on("close", () => {
      clearInterval(ping);
      run.clients.delete(res);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

const PORT = Number(process.env.PORT || 3210);
const server = http.createServer(async (req, res) => {
  try {
    const base = `http://${req.headers.host || "127.0.0.1"}`;
    const url = new URL(req.url || "/", base);

    if (url.pathname === "/health" || url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res, url.pathname);
      return;
    }

    sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[local-codex-appserver] listening on http://127.0.0.1:${PORT}/`);
});
