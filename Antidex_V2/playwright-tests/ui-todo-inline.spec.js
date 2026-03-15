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
  return 7100 + Math.floor(Math.random() * 200);
}

test.describe("Antidex UI (Playwright) — inline TODO editor", () => {
  test.describe.configure({ mode: "serial" });
  /** @type {import('node:child_process').ChildProcess | null} */
  let child = null;
  let baseUrl = null;
  let workspaceDir = null;
  let dataDir = null;

  test.beforeEach(async () => {
    const port = pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-todo-inline-pw-"));
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

  test("Inline TODO: reload, edit, diff, save+continue", async ({ page }) => {
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });

    await page.locator("#cwd").fill(workspaceDir);
    await page.locator("#createProjectDir").uncheck();
    await page.locator("#userPrompt").fill("Playwright inline TODO test: complete a minimal run, then continue via TODO update.");

    await page.locator("#start").click();

    await expect(page.locator("#runIdOut")).not.toHaveText("(none)", { timeout: 20_000 });
    const runId = await page.locator("#runIdOut").innerText();

    await expect(page.locator("#badgeStatus")).toContainText("completed", { timeout: 20_000 });

    // Ensure TODO content was loaded in the inline editor.
    await expect(page.locator("#todoMeta")).toContainText("path:", { timeout: 20_000 });
    const current = await page.locator("#todoEditor").inputValue();
    expect(current.length).toBeGreaterThan(0);

    // Ensure TODO progress parsing supports numbered checkbox lists (1. [ ] ...).
    const numbered = `# TODO\n\n## Progress test\n1. [x] done\n2. [ ] pending\n`;
    await page.locator("#todoEditor").fill(numbered);
    await page.locator("#todoSave").click();
    await expect(page.locator("#todoMeta")).toContainText("saved:", { timeout: 20_000 });
    await page.evaluate(() => refreshTodoProgress());
    await expect(page.locator("#todoProgressText")).toContainText("TODO: 1/2", { timeout: 20_000 });

    const extra = `- [ ] P0 extra item (inline)\n`;
    await page.locator("#todoEditor").fill(`${current}\n${extra}`);
    await expect(page.locator("#todoDiff")).toContainText(`+${extra.trim()}`, { timeout: 20_000 });

    await page.locator("#todoSaveContinue").click();

    // Ensure backend moved away from completed (Continue triggers a planning step).
    await page.waitForFunction(
      async (rid) => {
        const r = await fetch(`/api/pipeline/state?runId=${encodeURIComponent(rid)}`, {
          headers: { "cache-control": "no-store" },
        });
        const j = await r.json().catch(() => null);
        return j?.ok && j?.run?.status && j.run.status !== "completed" && j.run.status !== "failed";
      },
      runId,
      { timeout: 20_000 },
    );

    await expect(page.locator("#badgeStatus")).toContainText("implementing", { timeout: 20_000 });
  });
});
