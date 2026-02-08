const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (4600 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;

const smokeDir = path.join(root, "data", "smoke_project_logs");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
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

async function main() {
  fs.mkdirSync(smokeDir, { recursive: true });

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(d.toString()));

  try {
    const ok = await waitHealthy();
    if (!ok) throw new Error("server not healthy");

    const startRes = await fetch(`${baseUrl}/api/pipeline/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cwd: smokeDir,
        userPrompt: "Logs smoke test: plan only.",
        managerModel: "gpt-5.1",
        developerModel: "gpt-5.2-codex",
        managerPreprompt:
          "Create doc/SPEC.md, doc/TODO.md, doc/TESTING_PLAN.md and data/pipeline_state.json. Do not implement.",
        developerPreprompt: "",
        autoRun: false,
      }),
    });
    const start = await startRes.json().catch(() => null);
    if (!startRes.ok || !start?.ok) throw new Error(start?.error || `HTTP ${startRes.status}`);

    const runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");

    // Bootstrap should create documentation skeleton immediately on start.
    const docsIndexPath = path.join(smokeDir, "doc", "INDEX.md");
    const specPath = path.join(smokeDir, "doc", "SPEC.md");
    const todoPath = path.join(smokeDir, "doc", "TODO.md");
    const testingPath = path.join(smokeDir, "doc", "TESTING_PLAN.md");
    const walkthroughReadmePath = path.join(smokeDir, "doc", "walkthrough", "README.md");
    if (!fs.existsSync(docsIndexPath)) throw new Error("doc/INDEX.md missing");
    if (!fs.existsSync(specPath)) throw new Error("doc/SPEC.md missing");
    if (!fs.existsSync(todoPath)) throw new Error("doc/TODO.md missing");
    if (!fs.existsSync(testingPath)) throw new Error("doc/TESTING_PLAN.md missing");
    if (!fs.existsSync(walkthroughReadmePath)) throw new Error("doc/walkthrough/README.md missing");

    const contRes = await fetch(`${baseUrl}/api/pipeline/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const cont = await contRes.json().catch(() => null);
    if (!contRes.ok || !cont?.ok) throw new Error(cont?.error || `HTTP ${contRes.status}`);

    const stateRes = await fetch(`${baseUrl}/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    const state = await stateRes.json().catch(() => null);
    if (!stateRes.ok || !state?.run) throw new Error("pipeline/state failed");

    const pipelineStatePath = path.join(smokeDir, "data", "pipeline_state.json");
    if (!fs.existsSync(pipelineStatePath)) throw new Error("pipeline_state.json missing");
    try {
      const raw = fs.readFileSync(pipelineStatePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.run_id !== runId) throw new Error("pipeline_state.json run_id mismatch");
    } catch (e) {
      throw new Error(`pipeline_state.json invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

    const indexRes = await fetch(`${baseUrl}/api/logs/index`);
    const index = await indexRes.json().catch(() => null);
    if (!indexRes.ok || !index?.ok) throw new Error("logs/index failed");

    const threadId = state.run.managerThreadId || state.run.developerThreadId;
    if (!threadId) throw new Error("missing threadId");

    const threadRes = await fetch(`${baseUrl}/api/logs/thread?threadId=${encodeURIComponent(threadId)}`);
    const thread = await threadRes.json().catch(() => null);
    if (!threadRes.ok || !thread?.ok) throw new Error("logs/thread failed");

    const convRes = await fetch(`${baseUrl}/api/logs/conversation?runId=${encodeURIComponent(runId)}`);
    const conv = await convRes.json().catch(() => null);
    if (!convRes.ok || !conv?.ok) throw new Error("logs/conversation failed");
    if (!Array.isArray(conv.items) || conv.items.length < 1) throw new Error("conversation empty");

    const filePath = conv.items[0]?.filePath;
    if (!filePath) throw new Error("missing filePath in conversation");
    const fileRes = await fetch(`${baseUrl}/api/logs/file?path=${encodeURIComponent(filePath)}`);
    const file = await fileRes.json().catch(() => null);
    if (!fileRes.ok || !file?.ok) throw new Error("logs/file failed");

    console.log("OK");
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
