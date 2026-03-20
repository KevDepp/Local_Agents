const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveCodexCandidates } = require("../../Local_Codex_appserver/server/codexAppServerClient");
const { listRoots, listDirs } = require("../../Local_Codex_appserver/server/fsApi");
const { PipelineManager } = require("./pipelineManager");
const { AntigravityConnectorClient } = require("./antigravityConnectorClient");

const ROOT_DIR = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const DATA_DIR = process.env.ANTIDEX_DATA_DIR ? path.resolve(String(process.env.ANTIDEX_DATA_DIR)) : path.join(ROOT_DIR, "data");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const ROLLOUT_INDEX_PATH = path.join(DATA_DIR, "rollout_index.json");
const CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
const SERVER_LOCK_PATH = path.join(DATA_DIR, "server.lock");

const pipeline = new PipelineManager({ dataDir: DATA_DIR, rootDir: ROOT_DIR });

const streams = new Map(); // runId -> { events: [], clients: Set<{res, roleFilter}> }

function getStream(runId) {
  const key = String(runId || "");
  let s = streams.get(key);
  if (!s) {
    s = { events: [], clients: new Set() };
    streams.set(key, s);
  }
  return s;
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

function sseSend(res, evt) {
  const name = String(evt?.event || "message");
  const data = evt?.data;
  let payload;
  if (data === undefined) payload = "";
  else if (typeof data === "string") payload = data;
  else payload = JSON.stringify(data);

  res.write(`event: ${name}\n`);
  // SSE requires splitting on newlines for multi-line data.
  for (const line of String(payload).split(/\r?\n/)) res.write(`data: ${line}\n`);
  res.write("\n");
}

function pushStreamEvent(runId, evt) {
  const s = getStream(runId);
  const enriched = { ...evt, atMs: Date.now() };
  s.events.push(enriched);
  if (s.events.length > 5000) s.events.splice(0, s.events.length - 5000);

  for (const client of s.clients) {
    const { res, roleFilter } = client;
    try {
      if (roleFilter) {
        const role = enriched?.data?.role;
        // Always send run-level events regardless of role filter.
        if (role && String(role) !== String(roleFilter)) continue;
      }
      sseSend(res, enriched);
    } catch {
      // ignore
    }
  }
}

pipeline.on("event", (evt) => {
  try {
    pushStreamEvent(evt.runId, { event: evt.event, data: evt.data });
  } catch {
    // ignore
  }
});

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

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function isPidRunning(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireServerLock({ lockPath, port, dataDir }) {
  ensureDir(dataDir);
  const payload = JSON.stringify(
    {
      pid: process.pid,
      port,
      dataDir,
      startedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  try {
    fs.writeFileSync(lockPath, payload + "\n", { encoding: "utf8", flag: "wx" });
    return;
  } catch (e) {
    if (String(e?.code || "").toUpperCase() !== "EEXIST") throw e;
  }

  let existing = null;
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    existing = JSON.parse(raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch {
    existing = null;
  }

  const existingPid = existing && typeof existing.pid === "number" ? existing.pid : null;
  const existingPort = existing && typeof existing.port === "number" ? existing.port : null;

  if (existingPid && isPidRunning(existingPid)) {
    const hint = existingPort ? `http://127.0.0.1:${existingPort}/` : "(unknown port)";
    throw new Error(
      `Another Antidex server is already running (pid=${existingPid}, port=${existingPort || "?"}). Open ${hint} or stop that process, or set ANTIDEX_DATA_DIR to run a separate instance.`,
    );
  }

  // Stale or unreadable lock: remove and retry once.
  try {
    fs.rmSync(lockPath, { force: true });
  } catch {
    // ignore
  }
  fs.writeFileSync(lockPath, payload + "\n", { encoding: "utf8", flag: "wx" });
}

function releaseServerLock({ lockPath }) {
  try {
    const raw = fs.readFileSync(lockPath, "utf8");
    const parsed = JSON.parse(raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
    if (parsed && parsed.pid === process.pid) fs.rmSync(lockPath, { force: true });
  } catch {
    // ignore
  }
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

function loadRolloutIndex() {
  try {
    if (!fs.existsSync(ROLLOUT_INDEX_PATH)) return { threads: {} };
    const raw = fs.readFileSync(ROLLOUT_INDEX_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { threads: {} };
    return { threads: parsed.threads || {} };
  } catch {
    return { threads: {} };
  }
}

function saveRolloutIndex(index) {
  try {
    ensureDir(DATA_DIR);
    fs.writeFileSync(ROLLOUT_INDEX_PATH, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function findRolloutForThread(threadId) {
  if (!threadId) return null;
  const id = String(threadId);
  const index = loadRolloutIndex();
  const cached = index.threads?.[id];
  if (cached && cached.path && fs.existsSync(cached.path)) return cached.path;

  // Best-effort scan of ~/.codex/sessions for rollout-*-<threadId>.jsonl
  if (!fs.existsSync(CODEX_SESSIONS_ROOT)) return null;

  let found = null;
  const stack = [CODEX_SESSIONS_ROOT];
  let scanned = 0;
  const MAX_SCAN = 20000;

  while (stack.length && scanned < MAX_SCAN) {
    const cur = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (scanned++ > MAX_SCAN) break;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!ent.name.startsWith("rollout-") || !ent.name.endsWith(".jsonl")) continue;
      if (!ent.name.includes(id)) continue;
      found = full;
      break;
    }
    if (found) break;
  }

  if (found) {
    index.threads = index.threads || {};
    index.threads[id] = { path: found, updatedAt: new Date().toISOString() };
    saveRolloutIndex(index);
  }
  return found;
}

function listAssistantLogsForRun(run) {
  const prefix = `run_${String(run.runId).slice(0, 8)}_`;
  if (!fs.existsSync(LOGS_DIR)) return [];
  const files = fs
    .readdirSync(LOGS_DIR)
    .filter((name) => name.startsWith(prefix) && name.endsWith("_assistant.txt"))
    .map((name) => path.join(LOGS_DIR, name));
  return files;
}

function readTextLimited(filePath, limit = 200000) {
  const raw = fs.readFileSync(filePath, "utf8");
  if (raw.length <= limit) return { text: raw, truncated: false };
  return { text: raw.slice(0, limit) + "\n[...truncated]\n", truncated: true };
}

function writeTextAtomic(filePath, text) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const payload = String(text || "");
  const normalized = payload.endsWith("\n") ? payload : payload + "\n";
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, normalized, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, normalized, "utf8");
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // ignore
      }
      void e;
    }
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

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      app: "antidex",
      pid: process.pid,
      port: PORT,
      dataDir: DATA_DIR,
      codex: getCodexStatus(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, {
      ok: true,
      app: "antidex",
      pid: process.pid,
      port: PORT,
      rootDir: ROOT_DIR,
      dataDir: DATA_DIR,
      codex: getCodexStatus(),
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fs/roots") {
    sendJson(res, 200, { ok: true, roots: listRoots() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/fs/list") {
    const p = url.searchParams.get("path");
    if (!p) {
      sendJson(res, 400, { ok: false, error: "Missing ?path=" });
      return;
    }
    try {
      sendJson(res, 200, { ok: true, ...listDirs(p) });
    } catch (e) {
      sendJson(res, 400, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/start") {
    try {
      const codex = getCodexStatus();
      if (!codex.ok) {
        sendJson(res, 500, { ok: false, error: "codex.exe not found", hint: codex.hint });
        return;
      }

      const body = await readJson(req);
      const cwd = body?.cwd ? String(body.cwd) : null;
      const userPrompt = body?.userPrompt ? String(body.userPrompt) : null;
      const managerModel = body?.managerModel ? String(body.managerModel) : null;
      const developerModel = body?.developerModel ? String(body.developerModel) : null;
      const managerPreprompt = body?.managerPreprompt ? String(body.managerPreprompt) : null;
      const developerPreprompt = body?.developerPreprompt ? String(body.developerPreprompt) : null;
      const connectorBaseUrl = body?.connectorBaseUrl ? String(body.connectorBaseUrl) : null;
      const connectorNotify = body?.connectorNotify === true ? true : false;
      const connectorDebug = body?.connectorDebug === true ? true : false;
      const enableCorrector = body?.enableCorrector !== false;
      const threadPolicy = body?.threadPolicy && typeof body.threadPolicy === "object" ? body.threadPolicy : null;
      // Backward-compatible default: false (treat cwd as the project root).
      const createProjectDir = body?.createProjectDir === true ? true : false;
      const projectDirName = body?.projectDirName ? String(body.projectDirName) : null;
      const autoRun = body?.autoRun === false ? false : true;
      const useChatGPT = body?.useChatGPT === true ? true : false;
      const useGitHub = body?.useGitHub === true ? true : false;
      const useLovable = body?.useLovable === true ? true : false;
      const agCodexRatioDefault = body?.agCodexRatioDefault !== false;
      const agCodexRatio = body?.agCodexRatio ? String(body.agCodexRatio) : null;

      if (!cwd || !userPrompt || !managerModel || !developerModel || !managerPreprompt) {
        sendJson(res, 400, { ok: false, error: "Missing required fields" });
        return;
      }
      const resolvedCwd = path.resolve(cwd);
      if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
        sendJson(res, 400, { ok: false, error: `cwd is not a directory: ${resolvedCwd}` });
        return;
      }

      const run = await pipeline.startPipeline({
        cwd: resolvedCwd,
        codexExe: codex.path,
        userPrompt,
        managerModel,
        developerModel,
        managerPreprompt,
        developerPreprompt,
        connectorBaseUrl,
        connectorNotify,
        connectorDebug,
        enableCorrector,
        threadPolicy,
        createProjectDir,
        projectDirName,
        autoRun,
        useChatGPT,
        useGitHub,
        useLovable,
        agCodexRatioDefault,
        agCodexRatio,
      });
      sendJson(res, 200, { ok: true, run });
    } catch (e) {
      const msg = safeErrorMessage(e);
      if (msg.includes("already running")) {
        sendJson(res, 409, { ok: false, error: msg });
        return;
      }
      sendJson(res, 500, { ok: false, error: msg });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/continue") {
    try {
      const codex = getCodexStatus();
      if (!codex.ok) {
        sendJson(res, 500, { ok: false, error: "codex.exe not found", hint: codex.hint });
        return;
      }

      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const cwd = body?.cwd ? String(body.cwd) : null;
      const managerModel = body?.managerModel ? String(body.managerModel) : null;
      const developerModel = body?.developerModel ? String(body.developerModel) : null;
      const managerPreprompt = body?.managerPreprompt ? String(body.managerPreprompt) : null;
      const developerPreprompt = body?.developerPreprompt ? String(body.developerPreprompt) : null;
      const connectorBaseUrl = body?.connectorBaseUrl ? String(body.connectorBaseUrl) : null;
      const connectorNotify = body?.connectorNotify === true ? true : false;
      const connectorDebug = body?.connectorDebug === true ? true : false;
      const enableCorrector = body?.enableCorrector !== false;
      const threadPolicy = body?.threadPolicy && typeof body.threadPolicy === "object" ? body.threadPolicy : null;
      const todoUpdated = body?.todoUpdated === true ? true : false;
      const newSession = body?.newSession === true ? true : false;
      const autoRun = body?.autoRun === false ? false : true;
      const useChatGPT = body?.useChatGPT === true ? true : false;
      const useGitHub = body?.useGitHub === true ? true : false;
      const useLovable = body?.useLovable === true ? true : false;
      const agCodexRatioDefault = body?.agCodexRatioDefault !== false;
      const agCodexRatio = body?.agCodexRatio ? String(body.agCodexRatio) : null;
      const userCommandMessage = body?.userCommandMessage ? String(body.userCommandMessage) : null;
      const userCommandSource = body?.userCommandSource ? String(body.userCommandSource) : null;
      const resumeSource = body?.resumeSource ? String(body.resumeSource) : null;
      const maxStepsRaw = body?.maxSteps;
      const maxSteps = Number.isFinite(Number(maxStepsRaw)) ? Number(maxStepsRaw) : null;

      const run = await pipeline.continuePipeline({
        runId,
        codexExe: codex.path,
        cwd,
        managerModel,
        developerModel,
        managerPreprompt,
        developerPreprompt,
        connectorBaseUrl,
        connectorNotify,
        connectorDebug,
        enableCorrector,
        threadPolicy,
        todoUpdated,
        newSession,
        autoRun,
        useChatGPT,
        useGitHub,
        useLovable,
        agCodexRatioDefault,
        agCodexRatio,
        ...(userCommandMessage ? { userCommandMessage, userCommandSource: userCommandSource || "ui_send" } : {}),
        ...(resumeSource ? { resumeSource } : {}),
        ...(maxSteps != null ? { maxSteps } : {}),
      });
      sendJson(res, 200, { ok: true, run });
    } catch (e) {
      console.error("[Continue Error]:", e);
      const msg = safeErrorMessage(e);
      if (msg.includes("already running")) {
        sendJson(res, 409, { ok: false, error: msg });
        return;
      }
      sendJson(res, 500, { ok: false, error: msg });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test/forceIncident") {
    if (process.env.ANTIDEX_TEST_MODE !== "1") {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      const where = body?.where ? String(body.where) : "guardrail/review_loop";
      const message = body?.message ? String(body.message) : "synthetic incident (test)";
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const run = pipeline.forceTestIncident({ runId, where, message });
      sendJson(res, 200, { ok: true, run });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/test/triggerCorrector") {
    if (process.env.ANTIDEX_TEST_MODE !== "1") {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      const where = body?.where ? String(body.where) : "guardrail/review_loop";
      const message = body?.message ? String(body.message) : "synthetic incident (test)";
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }

      pipeline.forceTestIncident({ runId, where, message });
      // Trigger incident handling directly (avoid recovery/sync logic that could clear the synthetic failure).
      const handled = await pipeline._handleIncident(runId, "api/test/triggerCorrector");
      sendJson(res, 200, { ok: true, handled });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/corrector/run_pending") {
    try {
      const out = await pipeline.runExternalCorrectorPending();
      sendJson(res, 200, { ok: true, out });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/auditor/snapshot") {
    try {
      const runId = url.searchParams.get("runId");
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const snapshot = pipeline.getExternalAuditorSnapshot(String(runId));
      sendJson(res, 200, { ok: true, snapshot });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auditor/run") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      const mode = body?.mode ? String(body.mode) : "passive";
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const out = await pipeline.runExternalAuditorPass(runId, { mode });
      sendJson(res, 200, { ok: true, out, snapshot: out?.snapshot || null });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auditor/open_incident") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const recommendation = body?.recommendation && typeof body.recommendation === "object" ? body.recommendation : null;
      const auditReportPath = body?.auditReportPath ? String(body.auditReportPath) : null;
      const mode = body?.mode ? String(body.mode) : null;
      const out = await pipeline.openAuditorRecommendationAsIncident({ runId, recommendation, auditReportPath, mode });
      sendJson(res, 200, { ok: true, out });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/stop") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      await pipeline.stopPipeline(runId);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/pause") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      await pipeline.pausePipeline(runId);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/resume") {
    try {
      const codex = getCodexStatus();
      if (!codex.ok) {
        sendJson(res, 500, { ok: false, error: "codex.exe not found", hint: codex.hint });
        return;
      }

      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const autoRun = body?.autoRun === false ? false : true;

      const run = await pipeline.resumePipeline({ runId, codexExe: codex.path, autoRun });
      sendJson(res, 200, { ok: true, run });
    } catch (e) {
      console.error("[Resume Error]:", e);
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/cancel") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      await pipeline.cancelPipeline(runId);
      sendJson(res, 200, { ok: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/state") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    // Best-effort resync from the project filesystem so the UI reflects late artifacts
    // (e.g. AG wrote ACK/RESULT/turn marker after a watchdog handoff).
    try {
      // eslint-disable-next-line no-await-in-loop
      await pipeline.syncFromProjectState(runId);
    } catch {
      // ignore (run may not exist yet)
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }
    sendJson(res, 200, { ok: true, run });
    return;
  }

  // Long jobs (background compute)
  if (req.method === "GET" && url.pathname === "/api/jobs/state") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    try {
      const st = pipeline.getLongJobState(runId);
      sendJson(res, 200, { ok: true, ...st });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/jobs/tail") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    const stream = url.searchParams.get("stream") || "stdout";
    const bytes = url.searchParams.get("bytes");
    const maxBytes = bytes != null ? Number(bytes) : null;
    try {
      const r = pipeline.tailLongJobLog(runId, { stream, maxBytes });
      sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs/stop") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const reason = body?.reason ? String(body.reason) : null;
      const r = pipeline.stopLongJob(runId, { reason });
      sendJson(res, 200, { ok: true, result: r });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs/restart") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const reason = body?.reason ? String(body.reason) : null;
      const r = pipeline.restartLongJob(runId, { reason });
      sendJson(res, 200, { ok: true, result: r });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/jobs/monitorNow") {
    try {
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const reason = body?.reason ? String(body.reason) : null;
      const r = await pipeline.forceLongJobMonitor(runId, { reason });
      sendJson(res, 200, { ok: true, result: r });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/runs") {
    const runs = pipeline.listRuns();
    sendJson(res, 200, { ok: true, runs });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/tasks") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    // Keep the task list consistent with the latest project-side pipeline_state.json.
    // (The UI polls /api/pipeline/tasks; without syncing, it can look like tasks "jump" after pause/resume or manual edits.)
    try {
      // eslint-disable-next-line no-await-in-loop
      await pipeline.syncFromProjectState(runId);
    } catch {
      // ignore (run may not exist yet)
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }

    try {
      const tasksRoot = run.projectTasksDir ? String(run.projectTasksDir) : path.join(run.cwd, "data", "tasks");
      const tasks = [];
      if (fs.existsSync(tasksRoot) && fs.statSync(tasksRoot).isDirectory()) {
        const dirs = fs
          .readdirSync(tasksRoot, { withFileTypes: true })
          .filter((d) => d.isDirectory())
          .map((d) => d.name)
          // Hide placeholder/template task dirs that can be created by older versions or by docs templates.
          .filter((name) => !/^T-xxx_slug$/i.test(String(name || "")))
          .sort((a, b) => a.localeCompare(b));

        for (const taskId of dirs) {
          const base = path.join(tasksRoot, taskId);
          const taskPath = path.join(base, "task.md");
          const managerInstructionPath = path.join(base, "manager_instruction.md");
          const devAckPath = path.join(base, "dev_ack.json");
          const devResultMd = path.join(base, "dev_result.md");
          const devResultJson = path.join(base, "dev_result.json");
          const managerReviewPath = path.join(base, "manager_review.md");
          const questionsDir = path.join(base, "questions");
          const answersDir = path.join(base, "answers");

          let assigned = null;
          try {
            if (fs.existsSync(taskPath)) {
              const head = fs.readFileSync(taskPath, "utf8").slice(0, 8000);
              const m = head.match(/assigned_developer\\s*[:=]\\s*(\\S+)/i);
              if (m) assigned = String(m[1]).trim();
            }
          } catch {
            // ignore
          }

          const questions = [];
          const answers = [];
          try {
            if (fs.existsSync(questionsDir)) {
              for (const f of fs.readdirSync(questionsDir).filter((x) => x.startsWith("Q-") && x.endsWith(".md")).sort()) {
                questions.push(path.join(questionsDir, f));
              }
            }
          } catch {
            // ignore
          }
          try {
            if (fs.existsSync(answersDir)) {
              for (const f of fs.readdirSync(answersDir).filter((x) => x.startsWith("A-") && x.endsWith(".md")).sort()) {
                answers.push(path.join(answersDir, f));
              }
            }
          } catch {
            // ignore
          }

          const devResultPath = fs.existsSync(devResultMd) ? devResultMd : fs.existsSync(devResultJson) ? devResultJson : null;

          tasks.push({
            taskId,
            assignedDeveloper: assigned,
            paths: {
              taskPath,
              managerInstructionPath,
              devAckPath,
              devResultPath,
              managerReviewPath,
            },
            exists: {
              task: fs.existsSync(taskPath),
              managerInstruction: fs.existsSync(managerInstructionPath),
              devAck: fs.existsSync(devAckPath),
              devResult: !!devResultPath,
              managerReview: fs.existsSync(managerReviewPath),
            },
            questions,
            answers,
            isCurrent: run.currentTaskId === taskId,
          });
        }
      }
      sendJson(res, 200, { ok: true, runId, tasks });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/todo") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }
    const filePath = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
    try {
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
      const st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      sendJson(res, 200, {
        ok: true,
        runId,
        path: filePath,
        exists: fs.existsSync(filePath),
        mtimeMs: st ? st.mtimeMs : null,
        size: st ? st.size : null,
        content,
      });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/todo") {
    try {
      const body = await readJson(req, { maxBytes: 5 * 1024 * 1024 });
      const runId = body?.runId ? String(body.runId) : null;
      const content = body?.content !== undefined ? String(body.content) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      if (content === null) {
        sendJson(res, 400, { ok: false, error: "Missing content" });
        return;
      }
      const run = pipeline.getRun(runId);
      if (!run) {
        sendJson(res, 404, { ok: false, error: "run not found" });
        return;
      }
      const filePath = run.projectTodoPath || path.join(run.cwd, "doc", "TODO.md");
      writeTextAtomic(filePath, content);
      const st = fs.statSync(filePath);
      sendJson(res, 200, { ok: true, runId, path: filePath, mtimeMs: st.mtimeMs, size: st.size });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/lock") {
    sendJson(res, 200, { ok: true, lock: pipeline.getLockInfo() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/connector/status") {
    const baseUrl = url.searchParams.get("baseUrl");
    if (!baseUrl) {
      sendJson(res, 400, { ok: false, error: "Missing baseUrl" });
      return;
    }
    try {
      const status = await pipeline.checkConnectorStatus(String(baseUrl));
      sendJson(res, 200, { ok: true, ...status });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/command") {
    try {
      const body = await readJson(req);
      const command = body?.command ? String(body.command) : "";
      const baseUrl = body?.baseUrl ? String(body.baseUrl) : "http://127.0.0.1:17375";

      if (command !== "workbench.action.reloadWindow") {
        sendJson(res, 400, { ok: false, error: "Unsupported command" });
        return;
      }

      const client = new AntigravityConnectorClient({ baseUrl });
      const out = await client.command({ command });
      if (!out.ok) {
        sendJson(res, 502, { ok: false, error: out?.json?.error || out.text || `HTTP ${out.status || 0}` });
        return;
      }
      sendJson(res, 200, { ok: true, status: out.status, json: out.json, text: out.text });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pipeline/unlock") {
    try {
      const result = pipeline.forceUnlock();
      sendJson(res, 200, { ok: true, result });
    } catch (e) {
      sendJson(res, 409, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs/index") {
    const runs = pipeline.listRuns();
    const threads = {};
    for (const run of runs) {
      const managerThreadId = run.managerThreadId || null;
      const developerThreadId = run.developerThreadId || null;
      if (managerThreadId) {
        threads[managerThreadId] = threads[managerThreadId] || { threadId: managerThreadId, roles: new Set(), runIds: new Set() };
        threads[managerThreadId].roles.add("manager");
        threads[managerThreadId].runIds.add(run.runId);
        if (run.managerRolloutPath) threads[managerThreadId].rolloutPath = run.managerRolloutPath;
      }
      if (developerThreadId) {
        threads[developerThreadId] = threads[developerThreadId] || { threadId: developerThreadId, roles: new Set(), runIds: new Set() };
        threads[developerThreadId].roles.add("developer");
        threads[developerThreadId].runIds.add(run.runId);
        if (run.developerRolloutPath) threads[developerThreadId].rolloutPath = run.developerRolloutPath;
      }
    }

    const threadList = Object.values(threads).map((t) => ({
      threadId: t.threadId,
      roles: Array.from(t.roles),
      runIds: Array.from(t.runIds),
      rolloutPath: t.rolloutPath || findRolloutForThread(t.threadId) || null,
    }));

    sendJson(res, 200, { ok: true, runs, threads: threadList });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs/run") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }
    sendJson(res, 200, { ok: true, run });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs/thread") {
    const threadId = url.searchParams.get("threadId");
    if (!threadId) {
      sendJson(res, 400, { ok: false, error: "Missing threadId" });
      return;
    }
    const runs = pipeline.listRuns().filter(
      (r) => String(r.managerThreadId || "") === String(threadId) || String(r.developerThreadId || "") === String(threadId),
    );
    const runIds = runs.map((r) => r.runId);
    const rolloutPath =
      runs.find((r) => String(r.managerThreadId || "") === String(threadId))?.managerRolloutPath ||
      runs.find((r) => String(r.developerThreadId || "") === String(threadId))?.developerRolloutPath ||
      findRolloutForThread(threadId);
    sendJson(res, 200, { ok: true, threadId, runIds, rolloutPath: rolloutPath || null });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs/conversation") {
    const runId = url.searchParams.get("runId");
    if (!runId) {
      sendJson(res, 400, { ok: false, error: "Missing runId" });
      return;
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }

    const files = Array.isArray(run.logFiles) && run.logFiles.length ? run.logFiles : null;
    const assistantFiles = files
      ? files.map((f) => f.assistantLogPath).filter(Boolean)
      : listAssistantLogsForRun(run);

    const items = [];
    for (const filePath of assistantFiles) {
      try {
        if (!fs.existsSync(filePath)) continue;
        const stat = fs.statSync(filePath);
        const role = filePath.includes("_manager_") ? "manager" : filePath.includes("_developer_") ? "developer" : "unknown";
        const stepMatch = filePath.match(/_(planning|implementing|reviewing)_/);
        const step = stepMatch ? stepMatch[1] : null;
        const content = readTextLimited(filePath);
        items.push({
          role,
          step,
          filePath,
          mtimeMs: stat.mtimeMs,
          truncated: content.truncated,
          text: content.text,
        });
      } catch {
        // ignore
      }
    }

    items.sort((a, b) => Number(a.mtimeMs) - Number(b.mtimeMs));
    sendJson(res, 200, { ok: true, runId, items });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs/file") {
    const filePathRaw = url.searchParams.get("path");
    if (!filePathRaw) {
      sendJson(res, 400, { ok: false, error: "Missing path" });
      return;
    }
    const filePath = path.resolve(filePathRaw);
    const runs = pipeline.listRuns();
    const allowedRoots = [
      LOGS_DIR,
      CODEX_SESSIONS_ROOT,
      ...runs.map((r) => path.join(r.cwd, "data")),
      ...runs.map((r) => path.join(r.cwd, "doc")),
    ];

    const allowed = allowedRoots.some((root) => root && isPathWithin(root, filePath));
    if (!allowed) {
      sendJson(res, 403, { ok: false, error: "Path not allowed" });
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      sendJson(res, 404, { ok: false, error: "File not found" });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      sendJson(res, 200, { ok: true, path: filePath, content });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/pipeline/file") {
    const runId = url.searchParams.get("runId");
    const name = url.searchParams.get("name");
    if (!runId || !name) {
      sendJson(res, 400, { ok: false, error: "Missing runId or name" });
      return;
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendJson(res, 404, { ok: false, error: "run not found" });
      return;
    }

    let filePath = null;
    let isJson = false;
    switch (String(name)) {
      case "spec":
        filePath = run.projectSpecPath;
        break;
      case "todo":
        filePath = run.projectTodoPath;
        isJson = !!filePath && String(filePath).toLowerCase().endsWith(".json");
        break;
      case "testing":
        filePath = run.projectTestingPlanPath;
        break;
      case "projectState":
        filePath = run.projectPipelineStatePath;
        isJson = true;
        break;
      case "task":
      case "taskResult":
      case "taskReview": {
        const taskId = run.currentTaskId ? String(run.currentTaskId) : null;
        const taskRoot = run.projectTasksDir ? String(run.projectTasksDir) : null;
        if (!taskId || !taskRoot) {
          sendJson(res, 200, { ok: true, exists: false, path: null, isJson: false });
          return;
        }
        const base = path.join(taskRoot, taskId);
        if (name === "task") filePath = path.join(base, "task.md");
        if (name === "taskReview") filePath = path.join(base, "manager_review.md");
        if (name === "taskResult") {
          const mdPath = path.join(base, "dev_result.md");
          const jsonPath = path.join(base, "dev_result.json");
          if (fs.existsSync(mdPath)) filePath = mdPath;
          else if (fs.existsSync(jsonPath)) {
            filePath = jsonPath;
            isJson = true;
          } else {
            filePath = mdPath;
          }
        }
        break;
      }
      case "agAck":
      case "agResult": {
        const taskId = run.currentTaskId ? String(run.currentTaskId) : null;
        const taskRoot = run.projectTasksDir ? String(run.projectTasksDir) : null;
        if (!taskId || !taskRoot) {
          sendJson(res, 200, { ok: true, exists: false, path: null, isJson: true });
          return;
        }
        const pointerPath = path.join(taskRoot, taskId, "dev_result.json");
        if (!fs.existsSync(pointerPath)) {
          sendJson(res, 200, { ok: true, exists: false, path: pointerPath, isJson: true });
          return;
        }
        let pointer = null;
        try {
          const raw = fs.readFileSync(pointerPath, "utf8");
          const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
          pointer = JSON.parse(cleaned);
        } catch {
          pointer = null;
        }

        const key = name === "agAck" ? "ack_path" : "result_path";
        const p = pointer && typeof pointer[key] === "string" ? String(pointer[key]) : null;
        if (!p) {
          sendJson(res, 200, { ok: true, exists: false, path: null, isJson: true });
          return;
        }
        filePath = path.isAbsolute(p) ? p : path.join(run.cwd, p);
        isJson = true;
        break;
      }
      default:
        sendJson(res, 400, { ok: false, error: "Unknown name" });
        return;
    }

    const exists = filePath && fs.existsSync(filePath);
    if (!exists) {
      sendJson(res, 200, { ok: true, exists: false, path: filePath, isJson });
      return;
    }
    try {
      const content = fs.readFileSync(filePath, "utf8");
      sendJson(res, 200, { ok: true, exists: true, path: filePath, isJson, content });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: safeErrorMessage(e) });
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/pipeline/stream/")) {
    const runId = url.pathname.split("/").pop();
    if (!runId) {
      sendText(res, 404, "run not found");
      return;
    }
    const run = pipeline.getRun(runId);
    if (!run) {
      sendText(res, 404, "run not found");
      return;
    }

    const roleFilter = url.searchParams.get("role");
    const s = getStream(runId);

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": ok\n\n");

    for (const evt of s.events) {
      if (roleFilter) {
        const role = evt?.data?.role;
        if (role && String(role) !== String(roleFilter)) continue;
      }
      sseSend(res, evt);
    }

    const client = { res, roleFilter: roleFilter ? String(roleFilter) : null };
    s.clients.add(client);

    // Keep the SSE connection alive, but avoid visible UI "tab throbber" flicker on some browsers.
    // (15s was unnecessarily frequent for a local app.)
    const ping = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        // ignore
      }
    }, 60_000);
    ping.unref?.();

    req.on("close", () => {
      clearInterval(ping);
      s.clients.delete(client);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

const PORT = Number(process.env.PORT || 3220);

try {
  acquireServerLock({ lockPath: SERVER_LOCK_PATH, port: PORT, dataDir: DATA_DIR });
} catch (e) {
  console.error(`[antidex] ${safeErrorMessage(e)}`);
  process.exitCode = 1;
  // Avoid starting the server if lock acquisition failed.
  process.exit(1);
}

process.on("exit", () => releaseServerLock({ lockPath: SERVER_LOCK_PATH }));
process.on("SIGINT", () => {
  releaseServerLock({ lockPath: SERVER_LOCK_PATH });
  process.exit(0);
});
process.on("SIGTERM", () => {
  releaseServerLock({ lockPath: SERVER_LOCK_PATH });
  process.exit(0);
});

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
  console.log(`[antidex] listening on http://127.0.0.1:${PORT}/ (pid=${process.pid})`);
  console.log(`[antidex] dataDir=${DATA_DIR}`);

  // Auto-Resume logic
  setTimeout(() => {
    try {
      const pendingPath = path.join(DATA_DIR, "auto_resume", "pending.json");
      if (fs.existsSync(pendingPath)) {
        const raw = fs.readFileSync(pendingPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.runId) {
          console.log(`[antidex] Auto-resume pending for run ${parsed.runId}. Resuming pipeline...`);
          fs.rmSync(pendingPath, { force: true });
          const codex = getCodexStatus();
          pipeline.continuePipeline({
            runId: parsed.runId,
            codexExe: codex.path,
            autoRun: true,
            resumeSource: parsed?.source ? String(parsed.source) : "auto_resume",
          }).catch(err => {
            console.error(`[antidex] Auto-resume failed for run ${parsed.runId}:`, err);
          });
        }
      }
    } catch (e) {
      console.error("[antidex] Error checking auto-resume:", e);
    }
  }, 500);
});

server.on("error", (err) => {
  const msg = safeErrorMessage(err);
  if (String(err?.code || "").toUpperCase() === "EADDRINUSE") {
    console.error(`[antidex] Port ${PORT} already in use. Set PORT or stop the other process.`);
  }
  console.error(`[antidex] Server error: ${msg}`);
  process.exitCode = 1;
});
