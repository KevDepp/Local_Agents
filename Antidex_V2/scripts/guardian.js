const { spawn } = require("child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
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

function readJsonBestEffort(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson({ method, baseUrl, urlPath, body, timeoutMs = 30_000 }) {
  return new Promise((resolve) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json; charset=utf-8", "content-length": String(payload.length) }
          : { "content-type": "application/json; charset=utf-8" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += Buffer.isBuffer(c) ? c.toString("utf8") : String(c);
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed, raw: data });
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, json: null, raw: String(e?.message || e) }));
    req.on("timeout", () => {
      try {
        req.destroy(new Error("timeout"));
      } catch {
        // ignore
      }
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealthy({ baseUrl, deadlineMs }) {
  const deadlineAt = Date.now() + deadlineMs;
  while (Date.now() < deadlineAt) {
    const r = await httpJson({ method: "GET", baseUrl, urlPath: "/health", timeoutMs: 5_000 });
    if (r.ok) return true;
    await sleep(500);
  }
  return false;
}

function startServerWithRestart({ rootDir, dataDir, env }) {
  const serverPath = path.join(rootDir, "server", "index.js");
  const restartReqPath = path.join(dataDir, "auto_resume", "restart_request.json");

  function spawnOnce() {
    console.log("[GUARDIAN] Starting Antidex server...");
    const child = spawn("node", [serverPath], { stdio: "inherit", env });

    child.on("exit", (code) => {
      if (code === 42) {
        const restartReq = readJsonBestEffort(restartReqPath);
        const at = new Date().toISOString();
        const runId = restartReq && restartReq.runId ? String(restartReq.runId) : null;
        const entry = {
          ts: at,
          reason: restartReq && restartReq.reason ? String(restartReq.reason) : "exit_42",
          runId,
          incident: restartReq && restartReq.incident ? String(restartReq.incident) : null,
          mode: restartReq && restartReq.mode ? String(restartReq.mode) : null,
          prev_pid: child.pid || null,
        };
        appendJsonlLine(path.join(dataDir, "restarts.jsonl"), entry);
        if (runId) {
          const runDir = path.join(dataDir, "runs", runId.replace(/[^a-zA-Z0-9_-]/g, "_"));
          appendJsonlLine(path.join(runDir, "restarts.jsonl"), entry);
        }
        try {
          if (fs.existsSync(restartReqPath)) fs.unlinkSync(restartReqPath);
        } catch {
          // ignore
        }
        console.log("[GUARDIAN] Server requested restart (exit code 42). Respawning...");
        setTimeout(spawnOnce, 1000);
        return;
      }

      console.log(`[GUARDIAN] Server exited with code ${code}. Terminating guardian.`);
      process.exit(code || 0);
    });

    child.on("error", (err) => {
      console.error("[GUARDIAN] Failed to spawn server:", err);
      process.exit(1);
    });

    return child;
  }

  const child = spawnOnce();
  return { child };
}

async function main() {
  const rootDir = path.join(__dirname, "..");
  const dataDir = process.env.ANTIDEX_DATA_DIR ? path.resolve(String(process.env.ANTIDEX_DATA_DIR)) : path.join(rootDir, "data");
  const port = Number(process.env.PORT || 3220);
  const baseUrl = process.env.ANTIDEX_BASE_URL ? String(process.env.ANTIDEX_BASE_URL) : `http://127.0.0.1:${port}`;
  const pollMs = (() => {
    const n = Number(process.env.ANTIDEX_GUARDIAN_POLL_MS || 1500);
    if (!Number.isFinite(n) || n < 250) return 1500;
    return Math.min(10_000, Math.floor(n));
  })();

  const pendingPath = path.join(dataDir, "external_corrector", "pending.json");
  ensureDir(path.dirname(pendingPath));

  const env = {
    ...process.env,
    ANTIDEX_SUPERVISOR: "1",
    ANTIDEX_EXTERNAL_CORRECTOR: "1",
  };

  const { child } = startServerWithRestart({ rootDir, dataDir, env });

  const shutdown = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  let handling = false;
  let lastAttemptKey = null;
  let lastAttemptAtMs = 0;

  while (true) {
    try {
      if (!fs.existsSync(pendingPath)) {
        lastAttemptKey = null;
        lastAttemptAtMs = 0;
        await sleep(pollMs);
        continue;
      }

      if (handling) {
        await sleep(pollMs);
        continue;
      }

      const pending = readJsonBestEffort(pendingPath);
      const runId = pending && pending.runId ? String(pending.runId) : null;
      const sig = pending && pending.sig ? String(pending.sig) : null;
      const incidentPath = pending && pending.incidentPath ? String(pending.incidentPath) : null;
      const key = `${runId || "?"}:${sig || "?"}:${incidentPath || "?"}`;

      // Avoid hammering: allow retries, but not on every tick for the same pending marker.
      if (lastAttemptKey === key && Date.now() - lastAttemptAtMs < Math.max(5000, pollMs * 3)) {
        await sleep(pollMs);
        continue;
      }
      lastAttemptKey = key;
      lastAttemptAtMs = Date.now();

      handling = true;
      console.log(`[GUARDIAN] External corrector pending detected (runId=${runId || "?"}, where=${pending?.where || "?"}).`);

      const healthy = await waitForHealthy({ baseUrl, deadlineMs: 30_000 });
      if (!healthy) {
        console.warn("[GUARDIAN] Server not healthy; will retry pending later.");
        handling = false;
        await sleep(pollMs);
        continue;
      }

      const out = await httpJson({ method: "POST", baseUrl, urlPath: "/api/corrector/run_pending", body: {} });
      if (!out.ok) {
        const msg = out?.json?.error || out.raw || `HTTP ${out.status}`;
        if (/No external corrector pending marker found/i.test(String(msg || ""))) {
          console.log("[GUARDIAN] Pending marker already handled.");
          handling = false;
          await sleep(pollMs);
          continue;
        }
        // If the server restarted/crashed mid-request, it may still have renamed the pending marker.
        // In that case, treat this as handled to avoid repeated spam.
        try {
          if (!fs.existsSync(pendingPath)) {
            console.log("[GUARDIAN] Pending marker missing after failed run_pending call; assuming handled/restart in progress.");
            handling = false;
            await sleep(pollMs);
            continue;
          }
        } catch {
          // ignore
        }
        console.warn(`[GUARDIAN] run_pending failed: ${msg}. Will retry later.`);
        handling = false;
        await sleep(pollMs);
        continue;
      }

      console.log("[GUARDIAN] Corrector triggered for pending incident.");

      // Best-effort: resume the run if it remains stopped/paused/failed (Corrector may have only applied a fix).
      if (runId) {
        const runs = await httpJson({ method: "GET", baseUrl, urlPath: "/api/pipeline/runs" });
        const r =
          runs.ok && runs.json && runs.json.runs
            ? runs.json.runs.find((x) => String(x?.runId || x?.id || "") === runId)
            : null;
        const status = r?.status ? String(r.status) : null;
        // Respect explicit user pause: do not auto-continue paused runs.
        if (status === "stopped" || status === "failed") {
          console.log(`[GUARDIAN] Run is ${status}; calling Continue pipeline (autoRun=true).`);
          await httpJson({ method: "POST", baseUrl, urlPath: "/api/pipeline/continue", body: { runId, autoRun: true } });
        }
      }

      handling = false;
      await sleep(pollMs);
    } catch (e) {
      handling = false;
      console.warn("[GUARDIAN] Loop error:", e);
      await sleep(Math.max(1000, pollMs));
    }
  }
}

main().catch((e) => {
  console.error("[GUARDIAN] Fatal:", e);
  process.exit(1);
});
