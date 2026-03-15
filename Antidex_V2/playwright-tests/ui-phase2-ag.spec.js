const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const http = require("node:http");
const path = require("node:path");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(baseUrl) {
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`, { headers: { "cache-control": "no-store" } });
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  return false;
}

function pickPort(base) {
  return base + Math.floor(Math.random() * 200);
}

function writeJson(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n", "utf8");
}

async function startFakeConnector({ port }) {
  let lastSend = null;
  const server = http.createServer((req, res) => {
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
      req.on("end", () => {
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = null;
        }
        lastSend = body;
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
              output: { ok: true, newThreadReceived: body?.newThread === true || body?.newConversation === true },
            });
            fs.renameSync(meta.resultTmpPath, meta.resultPath);
          }
          if (meta?.pointerPath) {
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
          if (meta?.projectCwd) {
            const hb = path.join(meta.projectCwd, "data", "AG_internal_reports", "heartbeat.json");
            writeJson(hb, { updated_at: new Date().toISOString(), task_id: meta.taskId || "unknown", note: "fake heartbeat" });
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

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        try {
          server.close(() => resolve());
        } catch {
          resolve();
        }
      }),
    getLastSend: () => lastSend,
  };
}

test.describe("Antidex UI Phase 2 — AG task via connector", () => {
  let child = null;
  let baseUrl = null;
  let workspaceDir = null;
  let dataDir = null;
  let connector = null;

  test.beforeEach(async () => {
    const port = pickPort(6600);
    const connectorPort = pickPort(17450);
    baseUrl = `http://127.0.0.1:${port}`;
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-pw2-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));
    connector = await startFakeConnector({ port: connectorPort });

    child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        ANTIDEX_FAKE_CODEX: "1",
        ANTIDEX_TURN_TIMEOUT_MS: "20000",
        ANTIDEX_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (d) => process.stdout.write(d.toString()));
    child.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ok = await waitHealthy(baseUrl);
    if (!ok) throw new Error("Antidex server not healthy");
  });

  test.afterEach(async () => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
    try {
      await connector?.close();
    } catch {
      // ignore
    }
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
    child = null;
    connector = null;
    baseUrl = null;
    workspaceDir = null;
    dataDir = null;
  });

  test("Start pipeline triggers AG dispatch and first AG request uses new thread", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    // Connector inputs are inside a <details>, open it first.
    await page.locator("summary").filter({ hasText: "Antigravity connector (Phase 2)" }).click();
    await page.locator("#connectorBaseUrl").fill(connector.baseUrl);

    // The fake manager will assign AG if userPrompt mentions developer_antigravity/antigravity.
    await page.locator("#userPrompt").fill("Phase 2 UI test: assign to developer_antigravity (antigravity).");

    await page.locator("#start").click();
    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });

    // AG log should show a send attempt.
    await expect(page.locator("#logAg")).toContainText("[sending]", { timeout: 20_000 });
    await expect(page.locator("#badgeActiveAgent")).toContainText("Dev AG", { timeout: 20_000 });

    // Load AG result.json and confirm the connector observed newThread=true (first dispatch special rule).
    await page.locator("#loadAgResult").click();
    await expect(page.locator("#artifactContent")).toContainText("newThreadReceived", { timeout: 20_000 });
    await expect(page.locator("#artifactContent")).toContainText("true", { timeout: 20_000 });

    // Also assert at the transport layer (fake connector saw newThread flag).
    const last = connector.getLastSend();
    expect(last).toBeTruthy();
    expect(last.newThread).toBe(true);
  });
});
