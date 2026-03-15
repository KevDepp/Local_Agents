const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Use a high-ish port range to reduce collisions with other local dev servers.
const port = Number(process.env.PORT || (6000 + Math.floor(Math.random() * 200)));
const baseUrl = `http://127.0.0.1:${port}`;
const workspaceDir = path.join(root, "data", `phase1_workspace_${new Date().toISOString().replace(/[:.]/g, "-")}`);
const projectDirName = `phase1-project-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));
// This e2e covers 3 tasks with manager verification between tasks; it can take several minutes.
const TIMEOUT_MS = Number(process.env.PHASE1_TIMEOUT_MS || 18 * 60 * 1000);
const STALL_MS = Number(process.env.PHASE1_STALL_MS || 20 * 1000);
const POLL_MS = Number(process.env.PHASE1_POLL_MS || 1200);
const TURN_TIMEOUT_MS = Number(process.env.ANTIDEX_TURN_TIMEOUT_MS || 10 * 60 * 1000);
const LAST_RUN_PATH = path.join(root, "data", "phase1_last_run.json");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 1500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), Math.max(1, Number(timeoutMs) || 1500));
  try {
    return await fetch(url, { ...(opts || {}), signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function waitHealthy() {
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetchWithTimeout(`${baseUrl}/health`, {}, 800);
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  return false;
}

async function apiGet(pathname) {
  const r = await fetchWithTimeout(`${baseUrl}${pathname}`, { headers: { "cache-control": "no-store" } }, 5000);
  if (!r.ok) throw new Error(`GET ${pathname} -> ${r.status}`);
  return await r.json();
}

async function apiPost(pathname, body) {
  const r = await fetchWithTimeout(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, 10_000);
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
    const projectCwd = run?.cwd || workspaceDir;

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
      workspaceCwd: workspaceDir,
      projectCwd,
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
        const pipelinePath = path.join(projectCwd, "data", "pipeline_state.json");
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
          const taskDir = path.join(projectCwd, "data", "tasks", taskId);
          const taskFiles = ["task.md", "manager_instruction.md", "dev_ack.json", "dev_result.md", "dev_result.json", "manager_review.md"];
          for (const f of taskFiles) {
            const p = path.join(taskDir, f);
            if (!fs.existsSync(p)) continue;
            const raw = fs.readFileSync(p, "utf8");
            console.log(`[diag] ${path.relative(projectCwd, p)}:\n` + raw.slice(0, 2000));
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
  fs.mkdirSync(workspaceDir, { recursive: true });

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      ANTIDEX_TURN_TIMEOUT_MS: String(TURN_TIMEOUT_MS),
      ANTIDEX_DATA_DIR: dataDir,
      // Make this e2e deterministic and fast by default (no real Codex backend).
      // Override with ANTIDEX_FAKE_CODEX=0 to run "for real".
      ANTIDEX_FAKE_CODEX: process.env.ANTIDEX_FAKE_CODEX || "1",
    },
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
      cwd: workspaceDir,
      userPrompt,
      managerModel: "gpt-5.4",
      developerModel: "gpt-5.4",
      managerPreprompt,
      developerPreprompt: "",
      createProjectDir: true,
      projectDirName,
      autoRun: true,
    });

    const runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");
    const projectCwd = start.run?.cwd;
    console.log(`[run] runId=${runId} workspace=${workspaceDir}`);
    if (projectCwd) console.log(`[run] project_cwd=${projectCwd}`);
    console.log(`[run] baseUrl=${baseUrl}`);
    console.log(`[run] lastRunFile=${LAST_RUN_PATH}`);
    console.log(`[run] inspect: node scripts/inspect-run.js ${runId}`);
    console.log(`[run] inspect(live): node scripts/inspect-run.js ${runId} --live`);

    writeLastRun({
      runId,
      port,
      baseUrl,
      workspaceCwd: workspaceDir,
      projectCwd: projectCwd || null,
      createdAt: new Date().toISOString(),
      run: start.run,
    });

    const run = await waitForCompletion(runId, TIMEOUT_MS);
    if (run.status !== "completed") throw new Error(`run ended with status=${run.status}`);

    const finalProjectCwd = run.cwd;
    if (!finalProjectCwd) throw new Error("run.cwd missing");
    if (run.workspaceCwd !== workspaceDir) throw new Error("run.workspaceCwd mismatch");

    const workspaceDocDir = path.join(workspaceDir, "doc");
    if (fs.existsSync(workspaceDocDir)) throw new Error("doc/ was created at workspace root (expected inside project dir)");

    const helloPath = path.join(finalProjectCwd, "hello.txt");
    const worldPath = path.join(finalProjectCwd, "world.txt");
    const filesPath = path.join(finalProjectCwd, "files.md");
    if (!fs.existsSync(helloPath)) throw new Error("hello.txt missing");
    if (!fs.existsSync(worldPath)) throw new Error("world.txt missing");
    if (!fs.existsSync(filesPath)) throw new Error("files.md missing");

    const manifestPath = path.join(finalProjectCwd, "data", "antidex", "manifest.json");
    if (!fs.existsSync(manifestPath)) throw new Error("data/antidex/manifest.json missing");
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const json = JSON.parse(raw);
      if (json?.marker !== "antidex_project") throw new Error("marker mismatch");
      if (!json?.project_id) throw new Error("project_id missing");
      if (json?.layout_version !== 1) throw new Error("layout_version mismatch");
    } catch (e) {
      throw new Error(`manifest invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

    const migrationsPath = path.join(finalProjectCwd, "data", "antidex", "migrations.jsonl");
    if (!fs.existsSync(migrationsPath)) throw new Error("data/antidex/migrations.jsonl missing");

    console.log(`OK (workspace: ${workspaceDir})`);
  } finally {
    try {
      child.kill();
    } catch {
      // ignore
    }
    if (process.env.KEEP_TEST_FIXTURE !== "1") {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
