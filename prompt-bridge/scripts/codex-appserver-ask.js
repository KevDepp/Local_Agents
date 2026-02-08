/* eslint-disable no-console */
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

function parseArgs(argv) {
  const args = {
    prompt: null,
    cwd: process.cwd(),
    sandbox: "read-only",
    approvalPolicy: "never",
    model: null,
    threadId: null,
    timeoutSeconds: 120,
    logPath: null,
    trace: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prompt") args.prompt = argv[++i];
    else if (a === "--cwd") args.cwd = argv[++i];
    else if (a === "--sandbox") args.sandbox = argv[++i];
    else if (a === "--approval-policy") args.approvalPolicy = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--thread-id") args.threadId = argv[++i];
    else if (a === "--timeout") args.timeoutSeconds = Number(argv[++i]);
    else if (a === "--log") args.logPath = argv[++i];
    else if (a === "--trace") args.trace = true;
    else throw new Error(`Unknown arg: ${a}`);
  }

  if (!args.prompt) throw new Error("--prompt is required");
  return args;
}

function appendLog(logPath, line) {
  if (!logPath) return;
  try {
    fs.appendFileSync(logPath, line + os.EOL, { encoding: "utf8" });
  } catch {
    // best-effort
  }
}

function findCodexExe() {
  if (process.env.CODEX_EXE && fs.existsSync(process.env.CODEX_EXE)) return process.env.CODEX_EXE;
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

async function main() {
  const args = parseArgs(process.argv);
  const preferred = findCodexExe();
  const fallback = findCodexExeFallback();
  const codexCandidates = [preferred, "codex", fallback].filter(Boolean);

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = args.logPath || path.join(os.tmpdir(), `codex-appserver-ask_${ts}.log`);

  const spawnArgs = ["app-server", "--analytics-default-enabled"];
  const spawnOpts = {
    cwd: args.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      RUST_LOG: "warn",
      CODEX_INTERNAL_ORIGINATOR_OVERRIDE: "codex_vscode",
    },
    windowsHide: true,
  };

  let proc = null;
  let lastSpawnErr = null;
  for (const exe of codexCandidates) {
    if (args.trace) console.error(`[trace] trying codexExe=${exe}`);
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
    throw new Error(`Failed to spawn codex app-server: ${lastSpawnErr?.message ?? String(lastSpawnErr)}`);
  }

  if (args.trace) {
    console.error(`[trace] cwd=${args.cwd}`);
    console.error(`[trace] logPath=${logPath}`);
  }

  let exited = false;
  proc.on("exit", (code, signal) => {
    exited = true;
    appendLog(logPath, `[exit] code=${code ?? ""} signal=${signal ?? ""}`);
  });

  const pending = new Map();
  let nextId = 2; // id=1 reserved for initialize

  let threadId = null;
  let turnId = null;
  let completed = false;
  let fatalError = null;
  let assistantText = "";

  function sendRequest(id, method, params) {
    const msg = { id: String(id), method, params };
    const json = JSON.stringify(msg);
    appendLog(logPath, `-> ${json}`);
    proc.stdin.write(json + "\n");
    return String(id);
  }

  function send(method, params) {
    const id = nextId++;
    return sendRequest(id, method, params);
  }

  function waitForResponse(id) {
    return new Promise((resolve, reject) => {
      pending.set(String(id), { resolve, reject });
    });
  }

  function resolveResponse(id, payload, isError) {
    const waiter = pending.get(String(id));
    if (!waiter) return;
    pending.delete(String(id));
    if (isError) waiter.reject(payload);
    else waiter.resolve(payload);
  }

  const rlOut = readline.createInterface({ input: proc.stdout });
  rlOut.on("line", (line) => {
    const s = String(line).trim();
    if (!s) return;
    appendLog(logPath, `<- ${s}`);

    let msg;
    try {
      msg = JSON.parse(s);
    } catch (e) {
      fatalError = `Failed to parse stdout JSON: ${e?.message ?? String(e)}`;
      return;
    }

    if (msg && typeof msg === "object" && "id" in msg && ("result" in msg || "error" in msg)) {
      if ("error" in msg && msg.error) resolveResponse(msg.id, msg.error, true);
      else resolveResponse(msg.id, msg.result, false);
      return;
    }

    if (msg && typeof msg === "object" && msg.method && msg.params) {
      const method = String(msg.method);
      if (method === "error") {
        fatalError = JSON.stringify(msg.params);
        return;
      }
      if (method === "turn/started") {
        try {
          threadId = String(msg.params.threadId);
          turnId = String(msg.params.turn?.id ?? turnId ?? "");
        } catch {
          // ignore
        }
        return;
      }
      if (method === "item/agentMessage/delta") {
        try {
          const tid = String(msg.params.threadId);
          const tId = String(msg.params.turnId);
          if (threadId && turnId && (tid !== threadId || tId !== turnId)) return;
          assistantText += String(msg.params.delta ?? "");
        } catch {
          // ignore
        }
        return;
      }
      if (method === "turn/completed") {
        try {
          const tid = String(msg.params.threadId);
          const tId = String(msg.params.turn?.id ?? "");
          if (threadId && turnId && (tid !== threadId || tId !== turnId)) return;
        } catch {
          // ignore
        }
        completed = true;
      }
    }
  });

  const rlErr = readline.createInterface({ input: proc.stderr });
  rlErr.on("line", (line) => {
    const s = String(line);
    appendLog(logPath, `[stderr] ${s}`);
    if (args.trace) console.error(`[stderr] ${s}`);
  });

  const timeoutAt = Date.now() + Math.max(5, args.timeoutSeconds) * 1000;
  const tick = setInterval(() => {
    if (fatalError) return;
    if (exited) fatalError = "codex app-server exited unexpectedly";
    else if (Date.now() > timeoutAt) fatalError = "Timed out";
  }, 50);

  try {
    const initId = sendRequest(1, "initialize", {
      clientInfo: { name: "prompt-bridge-script", title: "Prompt Bridge Script", version: "0.0.0" },
    });
    const initResult = await withTimeout(
      waitForResponse(initId),
      Math.max(5, args.timeoutSeconds) * 1000,
      "initialize timeout",
    );
    if (args.trace) console.error(`[trace] initialized (userAgent=${initResult?.userAgent ?? ""})`);

    const threadMethod = args.threadId ? "thread/resume" : "thread/start";
    const threadParams = {
      cwd: args.cwd,
      approvalPolicy: args.approvalPolicy,
      sandbox: args.sandbox,
      ...(args.model ? { model: args.model } : {}),
      ...(args.threadId ? { threadId: args.threadId } : {}),
    };
    const threadResp = await waitForResponse(send(threadMethod, threadParams));
    threadId = String(threadResp?.thread?.id ?? threadId ?? "");
    if (!threadId) throw new Error(`${threadMethod} did not return thread.id`);

    const turnParams = {
      threadId,
      input: [{ type: "text", text: args.prompt }],
      approvalPolicy: args.approvalPolicy,
      ...(args.model ? { model: args.model } : {}),
    };
    const turnResp = await waitForResponse(send("turn/start", turnParams));
    turnId = String(turnResp?.turn?.id ?? turnId ?? "");
    if (args.trace) console.error(`[trace] turn started (threadId=${threadId} turnId=${turnId})`);

    while (!completed) {
      if (fatalError) throw new Error(fatalError);
      await new Promise((r) => setTimeout(r, 50));
    }

    const out = { ok: true, threadId, turnId, assistantText, logPath };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } finally {
    clearInterval(tick);
    rlOut.close();
    rlErr.close();
    try {
      if (!proc.killed) proc.kill();
    } catch {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
