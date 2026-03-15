const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (6000 + Math.floor(Math.random() * 200)));
const connectorPort = Number(process.env.CONNECTOR_PORT || (17390 + Math.floor(Math.random() * 50)));
const baseUrl = `http://127.0.0.1:${port}`;
const connectorBaseUrl = `http://127.0.0.1:${connectorPort}`;
const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-phase2-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(url) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(url, { headers: { "cache-control": "no-store" } });
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  return false;
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

async function apiGet(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`, { headers: { "cache-control": "no-store" } });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error || `GET ${pathname} -> ${r.status}`);
  return json;
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function startFakeConnector() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, name: "fake-antigravity-connector" }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/diagnostics") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, methods: ["antigravity.sendTextToChat"] }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/send") {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", async () => {
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        const meta = body?.antidex || null;
        try {
          if (meta?.ackPath) {
            writeJson(meta.ackPath, {
              status: "ack",
              run_id: body?.runId || body?.requestId || "fake",
              started_at: new Date().toISOString(),
              task_id: meta.taskId || null,
              agent: "developer_antigravity",
            });
          }
          if (meta?.resultTmpPath && meta?.resultPath) {
            writeJson(meta.resultTmpPath, {
              run_id: body?.runId || body?.requestId || "fake",
              status: "done",
              started_at: new Date().toISOString(),
              finished_at: new Date().toISOString(),
              summary: "fake connector wrote result",
              output: { ok: true },
            });
            fs.renameSync(meta.resultTmpPath, meta.resultPath);
          }
          if (meta?.pointerPath) {
            // Use relative paths to match the expected schema.
            const pointerDir = path.dirname(meta.pointerPath);
            const projectCwd = meta.projectCwd || path.resolve(pointerDir, "..", "..");
            const rel = (p) => (path.isAbsolute(p) ? path.relative(projectCwd, p).replace(/\\/g, "/") : String(p));
            writeJson(meta.pointerPath, {
              task_id: meta.taskId || null,
              agent: "developer_antigravity",
              run_id: body?.runId || "fake",
              ack_path: meta.ackPath ? rel(meta.ackPath) : null,
              result_path: meta.resultPath ? rel(meta.resultPath) : null,
              artifacts_dir: null,
              summary: "pointer written by fake connector",
            });
          }
          if (meta?.markerDonePath) {
            fs.mkdirSync(path.dirname(meta.markerDonePath), { recursive: true });
            fs.writeFileSync(meta.markerDonePath, "ok\n", "utf8");
          }
        } catch {
          // ignore
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, method: "fake" }));
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "not found" }));
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(connectorPort, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const fake = await startFakeConnector();

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    // This e2e is meant to be deterministic and should not require a real Codex backend.
    // Allow overriding via env ANTIDEX_FAKE_CODEX=0 if someone explicitly wants to run it "for real".
    env: { ...process.env, PORT: String(port), ANTIDEX_FAKE_CODEX: process.env.ANTIDEX_FAKE_CODEX || "1", ANTIDEX_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(d.toString()));

  try {
    const ok = await waitHealthy(`${baseUrl}/health`);
    if (!ok) throw new Error("antidex server not healthy");

    const statusOk = await waitHealthy(`${connectorBaseUrl}/health`);
    if (!statusOk) throw new Error("fake connector not healthy");

    const start = await apiPost("/api/pipeline/start", {
      cwd: workspaceDir,
      userPrompt: [
        "PHASE 2 E2E (connector) test.",
        "Create EXACTLY ONE task (T-001_ag-preflight) assigned to developer_antigravity.",
        "Definition of Done: the AG run must create ack.json + result.json (atomic) under data/antigravity_runs/<runId>/ and write data/tasks/<task>/dev_result.json pointer + turn marker.",
        "Do not assign any task to developer_codex in this test.",
      ].join("\n"),
      managerModel: "gpt-5.4",
      developerModel: "gpt-5.4",
      managerPreprompt: "This is a phase 2 integration test. You MUST set assigned_developer=developer_antigravity for the first task and keep the task minimal (file protocol only).",
      developerPreprompt: "",
      connectorBaseUrl,
      connectorNotify: false,
      connectorDebug: false,
      createProjectDir: false,
      autoRun: false,
    });

    const runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");

    // 1) Planning step (Manager).
    await apiPost("/api/pipeline/continue", { runId, autoRun: false });

    const s1 = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    const run = s1.run;
    if (run.status !== "implementing") throw new Error(`expected implementing after planning, got ${run.status}`);
    if (run.assignedDeveloper !== "developer_antigravity") {
      throw new Error(`expected assignedDeveloper=developer_antigravity, got ${run.assignedDeveloper || "(none)"}`);
    }

    // 2) Dispatch AG step (no review).
    await apiPost("/api/pipeline/continue", { runId, autoRun: false });

    const s2 = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    if (s2.run.developerStatus !== "ready_for_review") {
      throw new Error(`expected developerStatus=ready_for_review, got ${s2.run.developerStatus || "(none)"}`);
    }

    // Basic filesystem checks.
    const taskId = s2.run.currentTaskId;
    const taskDir = path.join(workspaceDir, "data", "tasks", taskId);
    const pointerPath = path.join(taskDir, "dev_result.json");
    if (!fs.existsSync(pointerPath)) throw new Error("missing task pointer dev_result.json");
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    const ackPath = pointer.ack_path ? path.join(workspaceDir, pointer.ack_path) : null;
    const resultPath = pointer.result_path ? path.join(workspaceDir, pointer.result_path) : null;
    if (!ackPath || !fs.existsSync(ackPath)) throw new Error("missing ack.json");
    if (!resultPath || !fs.existsSync(resultPath)) throw new Error("missing result.json");

    console.log("OK");
  } finally {
    try {
      fake.close();
    } catch {
      // ignore
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
    if (process.env.KEEP_TEST_FIXTURE !== "1") {
      try {
        fs.rmSync(workspaceDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    } else {
      console.log(`Keeping fixture at ${workspaceDir}`);
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
