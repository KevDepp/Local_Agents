const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (4600 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-smoke-logs-"));

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
        userPrompt: "Logs smoke test: bootstrap only (no agent turns).",
        managerModel: "gpt-5.1",
        developerModel: "gpt-5.2-codex",
        managerPreprompt:
          "Bootstrap only.",
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
    const gitWorkflowPath = path.join(smokeDir, "doc", "GIT_WORKFLOW.md");
    const agentsDir = path.join(smokeDir, "agents");
    const managerAgentPath = path.join(agentsDir, "manager.md");
    const devCodexPath = path.join(agentsDir, "developer_codex.md");
    const devAgPath = path.join(agentsDir, "developer_antigravity.md");
    const agCursorRulesPath = path.join(agentsDir, "AG_cursorrules.md");
    const turnMarkersDir = path.join(smokeDir, "data", "turn_markers");
    if (!fs.existsSync(docsIndexPath)) throw new Error("doc/INDEX.md missing");
    if (!fs.existsSync(specPath)) throw new Error("doc/SPEC.md missing");
    if (!fs.existsSync(todoPath)) throw new Error("doc/TODO.md missing");
    if (!fs.existsSync(testingPath)) throw new Error("doc/TESTING_PLAN.md missing");
    if (!fs.existsSync(gitWorkflowPath)) throw new Error("doc/GIT_WORKFLOW.md missing");
    if (!fs.existsSync(managerAgentPath)) throw new Error("agents/manager.md missing");
    if (!fs.existsSync(devCodexPath)) throw new Error("agents/developer_codex.md missing");
    if (!fs.existsSync(devAgPath)) throw new Error("agents/developer_antigravity.md missing");
    if (!fs.existsSync(agCursorRulesPath)) throw new Error("agents/AG_cursorrules.md missing");
    if (!fs.existsSync(turnMarkersDir)) throw new Error("data/turn_markers missing");

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

    console.log("OK");
  } finally {
    if (process.env.KEEP_TEST_FIXTURE === "1") {
      console.log(`Keeping fixture at ${smokeDir}`);
    } else {
      try {
        fs.rmSync(smokeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
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
