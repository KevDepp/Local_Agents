const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ANTIDEX_FAKE_CODEX = "1";
process.env.ANTIDEX_FAKE_CONNECTOR = "1";
process.env.ANTIDEX_FAKE_RESUME_NO_ROLLOUT_THREAD_ID = "thread-rollout-missing";

const { PipelineManager } = require("../server/pipelineManager");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const rootDir = path.resolve(__dirname, "..");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-corrector-data-"));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-corrector-project-"));

  const pipeline = new PipelineManager({ dataDir, rootDir });

  const start = await pipeline.startPipeline({
    codexExe: null,
    cwd: projectDir,
    userPrompt: "Corrector smoke test: bootstrap only.",
    managerModel: "gpt-5.4",
    developerModel: "gpt-5.4",
    managerPreprompt: "Bootstrap only.",
    developerPreprompt: "",
    enableCorrector: true,
    autoRun: false,
  });

  const runId = start?.runId || start?.run?.runId || start?.run?.run_id || start?.run?.id || start?.runId;
  assert(runId, "Missing runId from startPipeline result");

  const run = pipeline._state.getRun(runId);
  assert(run, "Run missing from state store");
  // Force the Corrector path to attempt a resume first (which will fail with a simulated -32600 error),
  // so we validate the fallback to starting a new Corrector thread.
  run.correctorThreadId = "thread-rollout-missing";
  pipeline._state.setRun(runId, run);

  run.status = "failed";
  run.developerStatus = "blocked";
  run.lastError = { message: "synthetic incident for corrector smoke test", at: new Date().toISOString(), where: "guardrail/review_loop" };
  pipeline._state.setRun(runId, run);

  const handled = await pipeline._handleIncident(runId, "smoke-test");
  assert(handled === true, "Expected incident to be handled by Corrector");

  const incidentsDir = path.join(dataDir, "incidents");
  assert(fs.existsSync(incidentsDir), "Missing data/incidents directory");
  const incFiles = fs
    .readdirSync(incidentsDir)
    .filter((f) => f.startsWith("INC-") && f.endsWith(".json") && !f.includes("_result") && !f.includes("_bundle"));
  assert(incFiles.length >= 1, "Expected at least one INC-*.json");
  const incPath = path.join(incidentsDir, incFiles.sort().slice(-1)[0]);
  const resPath = incPath.replace(/\.json$/i, "_result.json");
  assert(fs.existsSync(resPath), "Missing INC-..._result.json");

  const autoResumePath = path.join(dataDir, "auto_resume", "pending.json");
  assert(fs.existsSync(autoResumePath), "Missing data/auto_resume/pending.json");

  const runDir = path.join(dataDir, "runs", String(runId).replace(/[^a-zA-Z0-9_-]/g, "_"));
  const timelinePath = path.join(runDir, "timeline.jsonl");
  const summaryPath = path.join(runDir, "summary.md");
  assert(fs.existsSync(timelinePath), "Missing runs/<runId>/timeline.jsonl");
  assert(fs.existsSync(summaryPath), "Missing runs/<runId>/summary.md");
  const timelineText = fs.readFileSync(timelinePath, "utf8");
  assert(timelineText.includes("\"incident_created\"") || timelineText.includes("incident_created"), "timeline.jsonl missing incident_created event");

  console.log("OK");

  if (process.env.KEEP_TEST_FIXTURE === "1") {
    console.log(`Keeping dataDir=${dataDir}`);
    console.log(`Keeping projectDir=${projectDir}`);
    return;
  }
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  try {
    fs.rmSync(projectDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
