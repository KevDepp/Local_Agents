const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function fetchJson(url, opts = {}) {
  const timeoutMs = Number.isFinite(Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 8_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  timeoutId.unref?.();

  const res = await fetch(url, {
    ...opts,
    signal: controller.signal,
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
  }).finally(() => clearTimeout(timeoutId));
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json && (json.error || json.message)) || text || `HTTP ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

async function waitForHealth(baseUrl, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadline) throw new Error(`timeout waiting for /health (${lastErr || "no response"})`);
    try {
      const j = await fetchJson(`${baseUrl}health`, { method: "GET" });
      if (j && j.ok) return j;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await sleep(250);
  }
}

function findLatestIncident(dataDir) {
  const incidentsDir = path.join(dataDir, "incidents");
  const files = fs.existsSync(incidentsDir)
    ? fs
        .readdirSync(incidentsDir)
        .filter((f) => f.startsWith("INC-") && f.endsWith(".json") && !f.includes("_result") && !f.includes("_bundle"))
    : [];
  if (!files.length) return null;
  files.sort((a, b) => a.localeCompare(b));
  const incPath = path.join(incidentsDir, files[files.length - 1]);
  return { incPath, resPath: incPath.replace(/\.json$/i, "_result.json") };
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const supervisorPath = path.join(rootDir, "scripts", "supervisor.js");

  const port = 40_000 + Math.floor(Math.random() * 10_000);
  const baseUrl = `http://127.0.0.1:${port}/`;

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-corrector-e2e-data-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-corrector-e2e-project-"));
  let child = null;

  console.log(`[e2e] port=${port}`);
  console.log(`[e2e] dataDir=${dataDir}`);
  console.log(`[e2e] projectDir=${projectDir}`);

  try {
    child = spawn(process.execPath, [supervisorPath], {
      cwd: rootDir,
      stdio: "inherit",
      env: {
        ...process.env,
        PORT: String(port),
        ANTIDEX_DATA_DIR: dataDir,
        ANTIDEX_TEST_MODE: "1",
        ANTIDEX_TEST_FAKE_CORRECTOR: "1",
        ANTIDEX_FAKE_CODEX: "1",
        ANTIDEX_FAKE_CONNECTOR: "1",
      },
      windowsHide: true,
    });

    const health1 = await waitForHealth(baseUrl, { timeoutMs: 30_000 });
    const pid1 = health1.pid;
    console.log(`[e2e] server up pid=${pid1}`);

    const startResp = await fetchJson(`${baseUrl}api/pipeline/start`, {
      method: "POST",
      body: JSON.stringify({
        cwd: projectDir,
        userPrompt: "Corrector e2e supervised test (bootstrap only).",
        managerModel: "gpt-5.4",
        developerModel: "gpt-5.4",
        managerPreprompt: "Bootstrap only (test).",
        developerPreprompt: "",
        enableCorrector: true,
        autoRun: false,
      }),
    });

    const runId = startResp?.run?.runId || startResp?.run?.run_id || startResp?.runId;
    assert(runId, "Missing runId from /api/pipeline/start");
    console.log(`[e2e] runId=${runId}`);

    await fetchJson(`${baseUrl}api/test/forceIncident`, {
      method: "POST",
      body: JSON.stringify({
        runId,
        where: "guardrail/review_loop",
        message: "synthetic incident for supervised e2e test",
      }),
    });
    console.log("[e2e] incident forced; triggering corrector…");

    // Trigger incident handling directly (avoid "recovery" logic that can clear synthetic failures).
    // The Corrector may exit(42) quickly after this.
    try {
      await fetchJson(`${baseUrl}api/test/triggerCorrector`, {
        method: "POST",
        body: JSON.stringify({ runId }),
        timeoutMs: 10_000,
      });
    } catch {
      // Request may be interrupted by exit(42); proceed to restart detection regardless.
    }
    console.log("[e2e] corrector triggered; waiting for restart…");

    // Wait for PID change (restart)
    const deadline = Date.now() + 30_000;
    let pid2 = null;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (Date.now() > deadline) throw new Error("timeout waiting for server restart (pid change)");
      const h = await waitForHealth(baseUrl, { timeoutMs: 5_000 });
      if (h.pid && h.pid !== pid1) {
        pid2 = h.pid;
        break;
      }
      await sleep(250);
    }
    console.log(`[e2e] server restarted pid=${pid2}`);

    // Verify artifacts were written in Antidex dataDir
    const inc = findLatestIncident(dataDir);
    assert(inc && fs.existsSync(inc.incPath), "Missing incident artifact in data/incidents");
    assert(fs.existsSync(inc.resPath), "Missing incident result artifact INC-..._result.json");

    const correctorTestDir = path.join(dataDir, "corrector_test");
    assert(fs.existsSync(correctorTestDir), "Missing data/corrector_test directory");
    const fixes = fs.readdirSync(correctorTestDir).filter((f) => f.startsWith("fix_") && f.endsWith(".json"));
    assert(fixes.length >= 1, "Missing fix_*.json marker under data/corrector_test");

    const safeRunId = String(runId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const runDir = path.join(dataDir, "runs", safeRunId);
    assert(fs.existsSync(path.join(runDir, "timeline.jsonl")), "Missing runs/<runId>/timeline.jsonl");
    assert(fs.existsSync(path.join(runDir, "summary.md")), "Missing runs/<runId>/summary.md");
    assert(fs.existsSync(path.join(runDir, "restarts.jsonl")), "Missing runs/<runId>/restarts.jsonl");
    assert(fs.existsSync(path.join(dataDir, "restarts.jsonl")), "Missing data/restarts.jsonl");

    // Auto-resume should consume the pending marker shortly after restart.
    const pendingPath = path.join(dataDir, "auto_resume", "pending.json");
    const pendingDeadline = Date.now() + 15_000;
    while (fs.existsSync(pendingPath) && Date.now() < pendingDeadline) {
      await sleep(200);
    }
    assert(!fs.existsSync(pendingPath), "auto_resume/pending.json was not consumed (auto-resume did not run)");

    // Ensure the run is not stuck in a hard failed state right after restart.
    const state = await fetchJson(`${baseUrl}api/pipeline/state?runId=${encodeURIComponent(runId)}`, { method: "GET" });
    const status = state?.run?.status || null;
    assert(status && status !== "failed", `Run still failed after auto-resume (status=${status})`);

    console.log("OK");
  } finally {
    // Cleanup: stop supervisor + remove temp dirs (best-effort).
    try {
      if (child) child.kill("SIGTERM");
    } catch {
      // ignore
    }
    if (process.env.KEEP_TEST_FIXTURE === "1") {
      console.log(`[e2e] keeping dataDir=${dataDir}`);
      console.log(`[e2e] keeping projectDir=${projectDir}`);
    } else {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
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
