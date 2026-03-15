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
    await sleep(200);
  }
  return false;
}

function pickPort() {
  return 6300 + Math.floor(Math.random() * 200);
}

test.describe("Antidex UI (Playwright) — dispatch manager prompt", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let baseUrl = null;
  let workspaceDir = null;
  let dataDir = null;

  test.beforeEach(async () => {
    const port = pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-pw-"));
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

  test("Start pipeline sends prompt to Manager (manager meta/log + active badge)", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await expect(page.locator("#runSummary")).toBeVisible();
    await expect(page.locator("#modifyTodo")).toBeVisible();
    await expect(page.locator("#editTodo")).toBeVisible();
    await expect(page.locator("#badgeStatus")).toContainText("status:");
    await expect(page.locator("#badgePhase")).toContainText("phase:");
    await expect(page.locator("#badgeIteration")).toContainText("iteration:");

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright UI test: create one task and run it.");

    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });

    // The manager should receive a turn (fake codex emits meta).
    await expect(page.locator("#logManager")).toContainText("[meta]", { timeout: 20_000 });
    await expect(page.locator("#logManager")).toContainText("manager/planning", { timeout: 20_000 });

    // Active badge should reflect a real agent (the pipeline can progress quickly past Manager).
    await expect(page.locator("#badgeActiveAgent")).not.toContainText("active: -", { timeout: 20_000 });

    // Progress text should be visible (even if 0%).
    await expect(page.locator("#todoProgressText")).toContainText("TODO:", { timeout: 20_000 });
  });

  test("UI shows iteration/phase and agent switches to Dev Codex", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright UI test: run full fake loop.");
    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });

    await expect(page.locator("#logManager")).toContainText("manager/planning", { timeout: 20_000 });
    await expect(page.locator("#badgeIteration")).not.toContainText("-", { timeout: 20_000 });
    await expect(page.locator("#badgePhase")).not.toContainText("phase: -", { timeout: 20_000 });

    // Developer should also run (fake codex).
    await expect(page.locator("#logDeveloper")).toContainText("developer/implementing", { timeout: 20_000 });
    await expect(page.locator("#badgeActiveAgent")).toContainText("Dev Codex", { timeout: 20_000 });
  });
});
