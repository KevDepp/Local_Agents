const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (5200 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;
const testDir = path.join(root, "data", `phase1_cwd_${new Date().toISOString().replace(/[:.]/g, "-")}`);
// This e2e covers 3 tasks with manager verification between tasks; it can take several minutes.
const TIMEOUT_MS = Number(process.env.PHASE1_TIMEOUT_MS || 18 * 60 * 1000);
const STALL_MS = Number(process.env.PHASE1_STALL_MS || 20 * 1000);
const POLL_MS = Number(process.env.PHASE1_POLL_MS || 1200);
const TURN_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_TIMEOUT_MS || 180000);
const LAST_RUN_PATH = path.join(root, "data", "phase1_last_run.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  return false;
}

async function apiGet(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`, { headers: { "cache-control": "no-store" } });
  if (!r.ok) throw new Error(`GET ${pathname} -> ${r.status}`);
  return await r.json();
}

async function apiPost(pathname, body) {
  const r = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error || `POST ${pathname} -> ${r.status}`);
  return json;
}

function writeLastRun(payload) {
  try {
    fs.mkdirSync(path.dirname(LAST_RUN_PATH), { recursive: true });
    fs.writeFileSync(LAST_RUN_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
}

function latestLogFiles(run) {
  const files = Array.isArray(run?.logFiles) ? run.logFiles : [];
  if (!files.length) return null;
  const last = files[files.length - 1];
  if (!last) return null;
  return {
    role: last.role || "?",
    step: last.step || "?",
    assistantLogPath: last.assistantLogPath || null,
    rpcLogPath: last.rpcLogPath || null,
  };
}

async function waitForCompletion(runId, timeoutMs) {
  const start = Date.now();
  let lastSnapshot = "";
  let lastChangeAt = Date.now();
  let lastDiagAt = 0;
  let lastStillAt = 0;

  while (Date.now() - start < timeoutMs) {
    const state = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    const run = state?.run;
    const status = run?.status;

    const snapshot = [
      run?.status,
      run?.projectPhase,
      run?.currentTaskId,
      run?.assignedDeveloper,
      run?.developerStatus,
      run?.managerDecision,
      run?.lastError?.message,
    ]
      .map((v) => (v == null ? "" : String(v)))
      .join("|");

    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      lastChangeAt = Date.now();
      const active = run?.activeTurn;
      const activeText = active ? `${active.role}/${active.step}` : "-";
      console.log(
        `[state] status=${run?.status} phase=${run?.projectPhase || "-"} task=${run?.currentTaskId || "-"} dev=${run?.assignedDeveloper || "-"} dev_status=${run?.developerStatus || "-"} manager=${run?.managerDecision || "-"} active=${activeText}`
      );
      if (run?.lastError?.message) console.log(`[state] lastError=${run.lastError.message}`);
      const lf = latestLogFiles(run);
      if (lf?.assistantLogPath || lf?.rpcLogPath) {
        if (lf.assistantLogPath) console.log(`[logs] ${lf.role}/${lf.step} assistant=${lf.assistantLogPath}`);
        if (lf.rpcLogPath) console.log(`[logs] ${lf.role}/${lf.step} rpc=${lf.rpcLogPath}`);
      }
    }

    writeLastRun({
      runId,
      port,
      baseUrl,
      cwd: testDir,
      updatedAt: new Date().toISOString(),
      run,
    });

    if (status === "completed" || status === "failed") return run;

    const now = Date.now();
    if (now - lastStillAt > 15000) {
      lastStillAt = now;
      const active = run?.activeTurn;
      const activeText = active ? `${active.role}/${active.step}` : "-";
      console.log(`[still] ${Math.round((now - start) / 1000)}s active=${activeText}`);
    }
    if (now - lastChangeAt > STALL_MS && now - lastDiagAt > STALL_MS) {
      lastDiagAt = now;
      console.log(`[diag] no state change > ${Math.round(STALL_MS / 1000)}s, dumping diagnostics...`);
      try {
        const pipelinePath = path.join(testDir, "data", "pipeline_state.json");
        if (fs.existsSync(pipelinePath)) {
          const raw = fs.readFileSync(pipelinePath, "utf8");
          console.log("[diag] pipeline_state.json:\n" + raw.slice(0, 4000));
        } else {
          console.log("[diag] pipeline_state.json missing");
        }
      } catch (e) {
        console.log(`[diag] failed to read pipeline_state.json: ${e.message}`);
      }
      try {
        const taskId = run?.currentTaskId;
        if (taskId) {
          const taskDir = path.join(testDir, "data", "tasks", taskId);
          const taskFiles = ["task.md", "manager_instruction.md", "dev_ack.json", "dev_result.md", "dev_result.json", "manager_review.md"];
          for (const f of taskFiles) {
            const p = path.join(taskDir, f);
            if (!fs.existsSync(p)) continue;
            const raw = fs.readFileSync(p, "utf8");
            console.log(`[diag] ${path.relative(testDir, p)}:\n` + raw.slice(0, 2000));
          }
        } else {
          console.log("[diag] no current_task_id yet");
        }
      } catch (e) {
        console.log(`[diag] failed to read task files: ${e.message}`);
      }
      try {
        const logs = await apiGet(`/api/logs/conversation?runId=${encodeURIComponent(runId)}`);
        const items = Array.isArray(logs?.items) ? logs.items : [];
        const last = items[items.length - 1];
        if (last?.text) {
          const tail = last.text.slice(-1200);
          console.log(`[diag] last assistant log tail (${last.role}/${last.step}):\n${tail}`);
        } else {
          console.log("[diag] no assistant logs yet");
        }
      } catch (e) {
        console.log(`[diag] failed to fetch conversation logs: ${e.message}`);
      }

      console.log(`[diag] inspect helper: node scripts/inspect-run.js ${runId}`);
      console.log(`[diag] inspect helper (live): node scripts/inspect-run.js ${runId} --live`);
    }

    await sleep(POLL_MS);
  }
  throw new Error("timeout waiting for completion");
}

async function main() {
  fs.mkdirSync(testDir, { recursive: true });

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ANTIDEX_TURN_TIMEOUT_MS: String(TURN_TIMEOUT_MS) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(d.toString()));

  try {
    const ok = await waitHealthy();
    if (!ok) throw new Error("server not healthy");

    const userPrompt = [
      "Crée hello.txt, puis world.txt, puis liste-les dans files.md.",
      "Chaque étape doit être une tâche séparée.",
    ].join("\n");

    const managerPreprompt = [
      "Tu es Manager. Ne code pas.",
      "Crée les tâches séquentielles:",
      "- T-001_hello : créer hello.txt",
      "- T-002_world : créer world.txt",
      "- T-003_files : créer files.md listant hello.txt et world.txt",
      "Écris task.md + manager_instruction.md par tâche.",
      "Mets à jour data/pipeline_state.json avec current_task_id et assigned_developer=developer_codex.",
      "Assure un ordre d'exécution 1,2,3 dans TODO.",
    ].join("\n");

    const start = await apiPost("/api/pipeline/start", {
      cwd: testDir,
      userPrompt,
      managerModel: "gpt-5.1",
      developerModel: "gpt-5.2-codex",
      managerPreprompt,
      developerPreprompt: "",
      autoRun: true,
    });

    const runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");
    console.log(`[run] runId=${runId} cwd=${testDir}`);
    console.log(`[run] baseUrl=${baseUrl}`);
    console.log(`[run] lastRunFile=${LAST_RUN_PATH}`);
    console.log(`[run] inspect: node scripts/inspect-run.js ${runId}`);
    console.log(`[run] inspect(live): node scripts/inspect-run.js ${runId} --live`);

    writeLastRun({
      runId,
      port,
      baseUrl,
      cwd: testDir,
      createdAt: new Date().toISOString(),
      run: start.run,
    });

    const run = await waitForCompletion(runId, TIMEOUT_MS);
    if (run.status !== "completed") throw new Error(`run ended with status=${run.status}`);

    const helloPath = path.join(testDir, "hello.txt");
    const worldPath = path.join(testDir, "world.txt");
    const filesPath = path.join(testDir, "files.md");
    if (!fs.existsSync(helloPath)) throw new Error("hello.txt missing");
    if (!fs.existsSync(worldPath)) throw new Error("world.txt missing");
    if (!fs.existsSync(filesPath)) throw new Error("files.md missing");

    console.log(`OK (cwd: ${testDir})`);
  } finally {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
