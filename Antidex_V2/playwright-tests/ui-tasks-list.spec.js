const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
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
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  return false;
}

function pickPort() {
  return 7300 + Math.floor(Math.random() * 200);
}

test.describe("Antidex UI (Playwright) — tasks list", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let baseUrl = null;
  let workspaceDir = null;
  let dataDir = null;

  test.beforeEach(async () => {
    const port = pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-tasks-pw-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));

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
    baseUrl = null;
    workspaceDir = null;
    dataDir = null;
  });

  test("Tasks list renders and opens task.md", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright tasks list test: minimal run.");

    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });
    // Wait for tasks to appear (manager planning creates them).
    await expect(page.locator(".taskRow").first()).toBeVisible({ timeout: 20_000 });

    // Click the first task.md button and ensure artifact content is populated.
    await page.locator(".taskRow button", { hasText: "task.md" }).first().click();
    await expect(page.locator("#artifactContent")).not.toHaveText("", { timeout: 20_000 });
  });
});
