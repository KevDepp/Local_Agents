const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveCodexCandidates } = require("../../Local_Codex_appserver/server/codexAppServerClient");
const { listRoots, listDirs } = require("../../Local_Codex_appserver/server/fsApi");
const { PipelineManager } = require("./pipelineManager");

const ROOT_DIR = path.resolve(__dirname, "..");
const WEB_DIR = path.join(ROOT_DIR, "web");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LOGS_DIR = path.join(DATA_DIR, "logs");
const ROLLOUT_INDEX_PATH = path.join(DATA_DIR, "rollout_index.json");
const CODEX_SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

const pipeline = new PipelineManager({ dataDir: DATA_DIR });

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
    sendJson(res, 200, { ok: true, codex: getCodexStatus() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/status") {
    sendJson(res, 200, { ok: true, codex: getCodexStatus() });
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
      const autoRun = body?.autoRun === false ? false : true;

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
        userPrompt,
        managerModel,
        developerModel,
        managerPreprompt,
        developerPreprompt,
        autoRun,
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
      const body = await readJson(req);
      const runId = body?.runId ? String(body.runId) : null;
      if (!runId) {
        sendJson(res, 400, { ok: false, error: "Missing runId" });
        return;
      }
      const run = await pipeline.continuePipeline(runId);
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

  if (req.method === "GET" && url.pathname === "/api/pipeline/state") {
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

  if (req.method === "GET" && url.pathname === "/api/pipeline/runs") {
    const runs = pipeline.listRuns();
    sendJson(res, 200, { ok: true, runs });
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
      s.clients.delete(client);
    });
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" });
}

const PORT = Number(process.env.PORT || 3220);

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
  console.log(`[local-codex-dual-pipeline] listening on http://127.0.0.1:${PORT}/`);
});

server.on("error", (err) => {
  const msg = safeErrorMessage(err);
  if (String(err?.code || "").toUpperCase() === "EADDRINUSE") {
    console.error(`[local-codex-dual-pipeline] Port ${PORT} already in use. Set PORT or stop the other process.`);
  }
  console.error(`[local-codex-dual-pipeline] Server error: ${msg}`);
  process.exitCode = 1;
});
