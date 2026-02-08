const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (4200 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;

const smokeDir = path.join(root, "data", "smoke_project");

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

  const rootsRes = await fetch(`${baseUrl}/api/fs/roots`);
    if (!rootsRes.ok) throw new Error("fs/roots failed");
    const roots = await rootsRes.json();
    if (!Array.isArray(roots.roots)) throw new Error("fs/roots invalid payload");

  const startRes = await fetch(`${baseUrl}/api/pipeline/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      cwd: smokeDir,
      userPrompt: "Smoke test: create planning files only.",
      managerModel: "gpt-5.1",
      developerModel: "gpt-5.2-codex",
      managerPreprompt: "Create doc/SPEC.md, doc/TODO.md, doc/TESTING_PLAN.md and data/pipeline_state.json. Do not implement.",
      developerPreprompt: "",
      autoRun: false,
    }),
  });
    const start = await startRes.json().catch(() => null);
    if (!startRes.ok || !start?.ok) throw new Error(start?.error || `HTTP ${startRes.status}`);

    const runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");

    // Bootstrap should create documentation skeleton immediately on start.
    const docsRulesPath = path.join(smokeDir, "doc", "DOCS_RULES.md");
    const docsIndexPath = path.join(smokeDir, "doc", "INDEX.md");
    const specPath = path.join(smokeDir, "doc", "SPEC.md");
    const todoPath = path.join(smokeDir, "doc", "TODO.md");
    const testingPath = path.join(smokeDir, "doc", "TESTING_PLAN.md");
    const decisionsPath = path.join(smokeDir, "doc", "DECISIONS.md");
    const walkthroughReadmePath = path.join(smokeDir, "doc", "walkthrough", "README.md");
    const agentsPath = path.join(smokeDir, "AGENTS.md");
    if (!fs.existsSync(docsRulesPath)) throw new Error("doc/DOCS_RULES.md missing");
    if (!fs.existsSync(docsIndexPath)) throw new Error("doc/INDEX.md missing");
    if (!fs.existsSync(specPath)) throw new Error("doc/SPEC.md missing");
    if (!fs.existsSync(todoPath)) throw new Error("doc/TODO.md missing");
    if (!fs.existsSync(testingPath)) throw new Error("doc/TESTING_PLAN.md missing");
    if (!fs.existsSync(decisionsPath)) throw new Error("doc/DECISIONS.md missing");
    if (!fs.existsSync(walkthroughReadmePath)) throw new Error("doc/walkthrough/README.md missing");
    if (!fs.existsSync(agentsPath)) throw new Error("AGENTS.md missing");

    const contRes = await fetch(`${baseUrl}/api/pipeline/continue`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    const cont = await contRes.json().catch(() => null);
    if (!contRes.ok || !cont?.ok) throw new Error(cont?.error || `HTTP ${contRes.status}`);

    const stateRes = await fetch(`${baseUrl}/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    if (!stateRes.ok) throw new Error("pipeline/state failed");
    const state = await stateRes.json();
    if (!state?.run?.runId) throw new Error("pipeline/state invalid payload");

    const runsRes = await fetch(`${baseUrl}/api/pipeline/runs`);
    if (!runsRes.ok) throw new Error("pipeline/runs failed");
    const runs = await runsRes.json();
    if (!Array.isArray(runs.runs)) throw new Error("pipeline/runs invalid payload");

    const pipelineStatePath = path.join(smokeDir, "data", "pipeline_state.json");

    if (!fs.existsSync(pipelineStatePath)) throw new Error("pipeline_state.json missing");

    try {
      const raw = fs.readFileSync(pipelineStatePath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.run_id !== runId) throw new Error("pipeline_state.json run_id mismatch");
    } catch (e) {
      throw new Error(`pipeline_state.json invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

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
