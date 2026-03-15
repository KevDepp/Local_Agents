const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (4200 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;

const smokeDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-smoke-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));

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
    env: { ...process.env, PORT: String(port), ANTIDEX_DATA_DIR: dataDir },
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
        userPrompt: "Smoke test: bootstrap only (no agent turns).",
        managerModel: "gpt-5.4",
        developerModel: "gpt-5.4",
        managerPreprompt: "Bootstrap only.",
        developerPreprompt: "",
        useChatGPT: true,
        useGitHub: true,
        useLovable: true,
        agCodexRatioDefault: true,
        agCodexRatio: "3x AG vs Codex (heuristic)",
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
    const agentsMdPath = path.join(smokeDir, "AGENTS.md");
    const specPath = path.join(smokeDir, "doc", "SPEC.md");
    const todoPath = path.join(smokeDir, "doc", "TODO.md");
    const testingPath = path.join(smokeDir, "doc", "TESTING_PLAN.md");
    const decisionsPath = path.join(smokeDir, "doc", "DECISIONS.md");
    const gitWorkflowPath = path.join(smokeDir, "doc", "GIT_WORKFLOW.md");
    const agentsDir = path.join(smokeDir, "agents");
    const managerAgentPath = path.join(agentsDir, "manager.md");
    const devCodexPath = path.join(agentsDir, "developer_codex.md");
    const devAgPath = path.join(agentsDir, "developer_antigravity.md");
    const agCursorRulesPath = path.join(agentsDir, "AG_cursorrules.md");
    const mailboxDir = path.join(smokeDir, "data", "mailbox");
    const recoveryLogPath = path.join(smokeDir, "data", "recovery_log.jsonl");
    const turnMarkersDir = path.join(smokeDir, "data", "turn_markers");
    const manifestPath = path.join(smokeDir, "data", "antidex", "manifest.json");
    const migrationsPath = path.join(smokeDir, "data", "antidex", "migrations.jsonl");
    if (!fs.existsSync(docsRulesPath)) throw new Error("doc/DOCS_RULES.md missing");
    if (!fs.existsSync(docsIndexPath)) throw new Error("doc/INDEX.md missing");
    if (!fs.existsSync(agentsMdPath)) throw new Error("AGENTS.md missing");
    if (!fs.existsSync(specPath)) throw new Error("doc/SPEC.md missing");
    if (!fs.existsSync(todoPath)) throw new Error("doc/TODO.md missing");
    if (!fs.existsSync(testingPath)) throw new Error("doc/TESTING_PLAN.md missing");
    if (!fs.existsSync(decisionsPath)) throw new Error("doc/DECISIONS.md missing");
    if (!fs.existsSync(gitWorkflowPath)) throw new Error("doc/GIT_WORKFLOW.md missing");
    if (!fs.existsSync(managerAgentPath)) throw new Error("agents/manager.md missing");
    if (!fs.existsSync(devCodexPath)) throw new Error("agents/developer_codex.md missing");
    if (!fs.existsSync(devAgPath)) throw new Error("agents/developer_antigravity.md missing");
    if (!fs.existsSync(agCursorRulesPath)) throw new Error("agents/AG_cursorrules.md missing");
    if (!fs.existsSync(mailboxDir)) throw new Error("data/mailbox missing");
    if (!fs.existsSync(recoveryLogPath)) throw new Error("data/recovery_log.jsonl missing");
    if (!fs.existsSync(turnMarkersDir)) throw new Error("data/turn_markers missing");
    if (!fs.existsSync(manifestPath)) throw new Error("data/antidex/manifest.json missing");
    if (!fs.existsSync(migrationsPath)) throw new Error("data/antidex/migrations.jsonl missing");

    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.marker !== "antidex_project") throw new Error("marker mismatch");
      if (!parsed.project_id) throw new Error("project_id missing");
      if (parsed.layout_version !== 1) throw new Error("layout_version mismatch");
    } catch (e) {
      throw new Error(`manifest invalid: ${e instanceof Error ? e.message : String(e)}`);
    }

    const stateRes = await fetch(`${baseUrl}/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    if (!stateRes.ok) throw new Error("pipeline/state failed");
    const state = await stateRes.json();
    if (!state?.run?.runId) throw new Error("pipeline/state invalid payload");
    if (state.run.useChatGPT !== true) throw new Error("pipeline/state missing useChatGPT=true");
    if (state.run.useGitHub !== true) throw new Error("pipeline/state missing useGitHub=true");
    if (state.run.useLovable !== true) throw new Error("pipeline/state missing useLovable=true");
    if (state.run.agCodexRatioDefault !== true) throw new Error("pipeline/state missing agCodexRatioDefault=true");
    if (!String(state.run.agCodexRatio || "").includes("3x")) throw new Error("pipeline/state missing agCodexRatio");

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
    if (process.env.KEEP_TEST_FIXTURE === "1") {
      console.log(`Keeping fixture at ${smokeDir}`);
    } else {
      try {
        fs.rmSync(smokeDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
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
