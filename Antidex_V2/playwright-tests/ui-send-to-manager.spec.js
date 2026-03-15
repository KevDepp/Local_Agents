const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy(baseUrl, { child, timeoutMs = 30_000 } = {}) {
  const startedAt = Date.now();
  for (let i = 0; i < 120; i++) {
    if (child && child.exitCode != null) return false;
    if (Date.now() - startedAt > timeoutMs) return false;
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

async function waitForUserCommandFiles({ cwd, timeoutMs = 20_000 } = {}) {
  const startedAt = Date.now();
  const dir = path.join(cwd, "data", "user_commands");
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
      const cmd = files.find((n) => /^CMD-.*\.md$/i.test(n));
      const resp = files.find((n) => /^CMD-.*_response\.md$/i.test(n));
      if (cmd && resp) return { ok: true, cmd, resp, dir };
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  return { ok: false, dir };
}

async function waitForUserCommandSnapshot({ cwd, minCmd = 1, minResp = 1, timeoutMs = 20_000 } = {}) {
  const startedAt = Date.now();
  const dir = path.join(cwd, "data", "user_commands");
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const files = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name).sort();
      const cmds = files.filter((n) => /^CMD-.*\.md$/i.test(n) && !/_response\.md$/i.test(n));
      const resps = files.filter((n) => /^CMD-.*_response\.md$/i.test(n));
      if (cmds.length >= minCmd && resps.length >= minResp) return { ok: true, dir, cmds, resps };
    } catch {
      // ignore
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  return { ok: false, dir, cmds: [], resps: [] };
}

async function pickFreePort() {
  const srv = net.createServer();
  await new Promise((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = srv.address();
  const port = typeof addr === "object" && addr && typeof addr.port === "number" ? addr.port : null;
  await new Promise((resolve) => srv.close(() => resolve()));
  if (!port) throw new Error("Failed to pick a free port");
  return port;
}

test.describe("Antidex UI (Playwright) — Send to manager button", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let baseUrl = null;
  let workspaceDir = null;
  let dataDir = null;

  test.beforeEach(async () => {
    const port = await pickFreePort();
    baseUrl = `http://127.0.0.1:${port}`;
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-pw-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));

    child = spawn(process.execPath, ["server/index.js"], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        PORT: String(port),
        ANTIDEX_FAKE_CODEX: "1",
        ANTIDEX_FAKE_USER_COMMAND_DELAY_MS: "600",
        ANTIDEX_TURN_TIMEOUT_MS: "20000",
        ANTIDEX_DATA_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdout.on("data", (d) => process.stdout.write(d.toString()));
    child.stderr.on("data", (d) => process.stderr.write(d.toString()));

    const ok = await waitHealthy(baseUrl, { child, timeoutMs: 30_000 });
    if (!ok) throw new Error("Antidex server not healthy");
  });

  test.afterEach(async () => {
    try {
      child?.kill();
    } catch {
      // ignore
    }
    try {
      if (workspaceDir) fs.rmSync(workspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    child = null;
    baseUrl = null;
    workspaceDir = null;
    dataDir = null;
  });

  test("Send to manager queues a user command and triggers manager/user_command step", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright UI test: create one task and run it.");
    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });
    await expect(page.locator("#logManager")).toContainText("manager/planning", { timeout: 20_000 });

    await page.locator("#userPrompt").fill("Override: please reconcile TODO and continue.");
    await page.locator("#sendToManager").click();

    await expect(page.locator("#meta")).toContainText("Sent to Manager", { timeout: 20_000 });
    await expect(page.locator("#userPrompt")).toHaveValue("", { timeout: 20_000 });

    await expect(page.locator("#logManager")).toContainText("manager/user_command", { timeout: 20_000 });

    const files = await waitForUserCommandFiles({ cwd: workspaceDir, timeoutMs: 20_000 });
    expect(files.ok, `Expected CMD + response files in ${files.dir}`).toBeTruthy();
  });

  test("Send to manager keeps one active override and merges later follow-ups into one queued bundle", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright UI test: create one task and run it.");
    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });

    await page.locator("#userPrompt").fill("Override 1: inspect reports.");
    await page.locator("#sendToManager").click();
    await expect(page.locator("#userPrompt")).toHaveValue("", { timeout: 20_000 });

    await page.locator("#userPrompt").fill("Override 2: keep this as the queued follow-up.");
    await page.locator("#sendToManager").click();
    await expect(page.locator("#userPrompt")).toHaveValue("", { timeout: 20_000 });

    await page.locator("#userPrompt").fill("Override 3: merge this into the queued follow-up.");
    await page.locator("#sendToManager").click();
    await expect(page.locator("#userPrompt")).toHaveValue("", { timeout: 20_000 });

    const snapshot = await waitForUserCommandSnapshot({ cwd: workspaceDir, minCmd: 2, minResp: 2, timeoutMs: 30_000 });
    expect(snapshot.ok, `Expected 2 CMD + 2 response files in ${snapshot.dir}`).toBeTruthy();
    expect(snapshot.cmds).toHaveLength(2);
    expect(snapshot.resps).toHaveLength(2);

    const bundleName = snapshot.cmds[1];
    const bundleText = fs.readFileSync(path.join(snapshot.dir, bundleName), "utf8");
    const countMatch = bundleText.match(/message_count:\s*(\d+)/i);
    expect(countMatch).toBeTruthy();
    expect(Number(countMatch[1])).toBeGreaterThanOrEqual(2);
    expect(bundleText).toContain("Override 2: keep this as the queued follow-up.");
    expect(bundleText).toContain("Override 3: merge this into the queued follow-up.");
  });
});
