const { spawn, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const { EventEmitter } = require("node:events");

function appendLog(logPath, line) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line + os.EOL, { encoding: "utf8" });
  } catch {
    // best-effort
  }
}

function findCodexExeFromEnv() {
  if (process.env.CODEX_EXE && fs.existsSync(process.env.CODEX_EXE)) return process.env.CODEX_EXE;
  return null;
}

function findCodexExeInPath() {
  const tool = process.platform === "win32" ? "where" : "which";
  try {
    const r = spawnSync(tool, ["codex"], { encoding: "utf8", windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && fs.existsSync(first)) return first;
    }
  } catch {
    // ignore
  }
  return null;
}

function findCodexExeFallback() {
  if (process.platform !== "win32") return null;
  try {
    const extRoot = path.join(os.homedir(), ".vscode", "extensions");
    if (!fs.existsSync(extRoot)) return null;
    const dirs = fs
      .readdirSync(extRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith("openai.chatgpt-"))
      .map((d) => path.join(extRoot, d.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

    for (const d of dirs) {
      const binDir = path.join(d, "bin");
      if (!fs.existsSync(binDir)) continue;

      const stack = [binDir];
      while (stack.length) {
        const cur = stack.pop();
        for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, ent.name);
          if (ent.isDirectory()) stack.push(full);
          else if (ent.isFile() && ent.name.toLowerCase() === "codex.exe") return full;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

function resolveCodexCandidates() {
  const envPath = findCodexExeFromEnv();
  const extPath = findCodexExeFallback();
  const pathPath = findCodexExeInPath();
  return {
    envPath,
    extPath,
    pathPath,
  };
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function shouldPassOpenAiApiKey(env) {
  const raw = String(env.CODEX_PASS_OPENAI_API_KEY || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function buildCodexEnv(baseEnv) {
  const env = {
    ...baseEnv,
    RUST_LOG: "warn",
    CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex_vscode",
  };

  // Safety: if the user has OPENAI_API_KEY in their shell, we do NOT want to
  // accidentally bill the OpenAI API. By default, strip it and rely on Codex's
  // ChatGPT login. Set CODEX_PASS_OPENAI_API_KEY=1 to opt-in to passing it.
  if (!shouldPassOpenAiApiKey(env)) {
    delete env.OPENAI_API_KEY;
  }

  return env;
}

class CodexAppServerClient extends EventEmitter {
  constructor(opts = {}) {
    super();
    this._trace = Boolean(opts.trace);
    this._proc = null;
    this._rlOut = null;
    this._rlErr = null;
    this._pending = new Map();
    this._nextId = 2; // id=1 reserved for initialize
    this._initialized = false;
    this._exited = false;
    this._logPath = null;
  }

  isRunning() {
    return Boolean(this._proc && !this._proc.killed && !this._exited);
  }

  setLogPath(logPath) {
    this._logPath = logPath;
  }

  _log(line) {
    appendLog(this._logPath, line);
  }

  async start({ cwd }) {
    if (this.isRunning()) return;

    const { envPath, extPath, pathPath } = resolveCodexCandidates();
    const codexCandidates = [envPath, pathPath, "codex", extPath].filter(Boolean);

    const spawnArgs = ["app-server", "--analytics-default-enabled"];
    const spawnOpts = {
      cwd: cwd || process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
      env: buildCodexEnv(process.env),
      windowsHide: true,
    };

    let proc = null;
    let lastSpawnErr = null;
    for (const exe of codexCandidates) {
      if (this._trace) console.error(`[trace] trying codexExe=${exe}`);
      const child = spawn(exe, spawnArgs, spawnOpts);
      const outcome = await Promise.race([
        once(child, "spawn").then(() => ({ ok: true, child })),
        once(child, "error").then(([err]) => ({ ok: false, err })),
      ]);
      if (outcome.ok) {
        proc = child;
        lastSpawnErr = null;
        break;
      }
      lastSpawnErr = outcome.err;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }

    if (!proc) {
      throw new Error(
        `Failed to spawn codex app-server: ${lastSpawnErr?.message ?? String(lastSpawnErr)}`,
      );
    }

    this._proc = proc;
    this._exited = false;
    this._initialized = false;
    this._nextId = 2;

    proc.on("exit", (code, signal) => {
      this._exited = true;
      this._log(`[exit] code=${code ?? ""} signal=${signal ?? ""}`);
      this.emit("exit", { code, signal });
    });

    this._rlOut = readline.createInterface({ input: proc.stdout });
    this._rlOut.on("line", (line) => this._handleStdoutLine(line));

    this._rlErr = readline.createInterface({ input: proc.stderr });
    this._rlErr.on("line", (line) => {
      const s = String(line);
      this._log(`[stderr] ${s}`);
      if (this._trace) console.error(`[stderr] ${s}`);
    });
  }

  async stop() {
    this._initialized = false;
    this._exited = true;

    try {
      this._rlOut?.close();
      this._rlErr?.close();
    } catch {
      // ignore
    }

    try {
      if (this._proc && !this._proc.killed) this._proc.kill();
    } catch {
      // ignore
    } finally {
      this._proc = null;
    }
  }

  _handleStdoutLine(line) {
    const s = String(line).trim();
    if (!s) return;
    this._log(`<-${s}`);

    let msg;
    try {
      msg = JSON.parse(s);
    } catch (e) {
      this.emit("fatal", { message: `Failed to parse stdout JSON: ${e?.message ?? String(e)}` });
      return;
    }

    if (msg && typeof msg === "object" && "id" in msg && ("result" in msg || "error" in msg)) {
      const waiter = this._pending.get(String(msg.id));
      if (!waiter) return;
      this._pending.delete(String(msg.id));
      if ("error" in msg && msg.error) waiter.reject(msg.error);
      else waiter.resolve(msg.result);
      return;
    }

    if (msg && typeof msg === "object" && msg.method && msg.params) {
      this.emit("notification", msg);
      return;
    }
  }

  _sendRequest(id, method, params) {
    if (!this._proc || this._exited) throw new Error("codex app-server is not running");
    const msg = { id: String(id), method, params };
    const json = JSON.stringify(msg);
    this._log(`->${json}`);
    this._proc.stdin.write(json + "\n");
    return String(id);
  }

  _send(method, params) {
    const id = this._nextId++;
    return this._sendRequest(id, method, params);
  }

  _waitForResponse(id) {
    return new Promise((resolve, reject) => {
      this._pending.set(String(id), { resolve, reject });
    });
  }

  async initialize({ timeoutMs = 30_000 } = {}) {
    if (this._initialized) return;
    const initId = this._sendRequest(1, "initialize", {
      clientInfo: {
        name: "local-codex-appserver",
        title: "Local Codex app-server",
        version: "0.0.0",
      },
    });
    await withTimeout(this._waitForResponse(initId), timeoutMs, "initialize timeout");
    this._initialized = true;
  }

  async request(method, params, { timeoutMs = 120_000 } = {}) {
    const id = this._send(method, params);
    return await withTimeout(this._waitForResponse(id), timeoutMs, `${method} timeout`);
  }

  async threadStart({ cwd, sandbox, approvalPolicy, model }) {
    const params = {
      cwd,
      approvalPolicy,
      sandbox,
      ...(model ? { model } : {}),
    };
    return await this.request("thread/start", params);
  }

  async threadResume({ threadId, cwd, sandbox, approvalPolicy, model }) {
    const params = {
      threadId,
      cwd,
      approvalPolicy,
      sandbox,
      ...(model ? { model } : {}),
    };
    return await this.request("thread/resume", params);
  }

  async turnStart({ threadId, prompt, approvalPolicy, model, effort }) {
    const requestedEffort = typeof effort === "string" ? effort.trim().toLowerCase() : "";
    const tryEfforts = [];
    if (requestedEffort) tryEfforts.push(requestedEffort);
    else tryEfforts.push("high");

    // Allow at most one automatic retry when Codex rejects an effort value.
    for (let attempt = 0; attempt < 2; attempt++) {
      const effortValue = tryEfforts[tryEfforts.length - 1];
      const params = {
        threadId,
        input: [{ type: "text", text: prompt }],
        approvalPolicy,
        ...(model ? { model } : {}),
        ...(effortValue ? { effort: effortValue } : {}),
      };
      try {
        return await this.request("turn/start", params);
      } catch (err) {
        const msg = extractRpcErrorMessage(err);
        const supported = parseSupportedEffortsFromError(msg);
        if (!supported.length) throw err;
        const clamped = pickMaxEffort(supported);
        if (!clamped || clamped === effortValue) throw err;
        this._log(
          `[effort] retry: requested=${effortValue} supported=[${supported.join(",")}] using=${clamped}`,
        );
        tryEfforts.push(clamped);
      }
    }

    // Should never reach here.
    return await this.request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt }],
      approvalPolicy,
      ...(model ? { model } : {}),
    });
  }

  async turnInterrupt({ threadId, turnId }) {
    return await this.request("turn/interrupt", { threadId, turnId }, { timeoutMs: 15_000 });
  }

  async modelList() {
    return await this.request("model/list", {}, { timeoutMs: 30_000 });
  }
}

module.exports = { CodexAppServerClient };

module.exports.resolveCodexCandidates = resolveCodexCandidates;

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
