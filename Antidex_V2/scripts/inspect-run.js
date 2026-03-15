const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const statePath = path.join(root, "data", "pipeline_state.json");
const lastRunPath = path.join(root, "data", "phase1_last_run.json");

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("-")));
  const positional = args.filter((a) => a && !a.startsWith("-"));
  return { flags, positional };
}

function readJson(p) {
  const raw = fs.readFileSync(p, "utf8");
  const cleaned = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  return JSON.parse(cleaned);
}

function safeReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return readJson(p);
  } catch {
    return null;
  }
}

function tailText(p, maxChars = 2000) {
  try {
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf8");
    if (raw.length <= maxChars) return raw;
    return raw.slice(-maxChars);
  } catch {
    return null;
  }
}

function pickLatestByStartedAt(files, role, key) {
  const list = (files || []).filter((f) => f && f.role === role && f[key]);
  if (!list.length) return null;
  return list
    .slice()
    .sort((a, b) => Number(a.startedAtMs || 0) - Number(b.startedAtMs || 0))
    .at(-1);
}

async function fetchJson(url, timeoutMs = 1200) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { "cache-control": "no-store" } });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function main() {
  const { flags, positional } = parseArgs(process.argv);
  const runIdArg = positional[0] || null;
  const last = safeReadJson(lastRunPath);
  const runId = runIdArg || last?.runId || null;
  if (!runId) {
    console.error("Missing runId. Usage: node scripts/inspect-run.js <runId>");
    if (fs.existsSync(lastRunPath)) console.error(`Tip: last run file exists at ${lastRunPath}`);
    process.exitCode = 2;
    return;
  }

  const baseUrl = typeof last?.baseUrl === "string" ? last.baseUrl : null;
  const liveWanted = flags.has("--live") || flags.has("-l");

  let run = null;
  let source = "unknown";

  if (baseUrl && (liveWanted || !flags.has("--no-live"))) {
    // Best-effort: if server isn't running, this returns null quickly.
    const live = await fetchJson(`${baseUrl}/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    if (live?.run) {
      run = live.run;
      source = `live:${baseUrl}`;
    }
  }

  if (!run) {
    const state = safeReadJson(statePath);
    run = state?.runs?.[runId] || null;
    if (run) source = `state:${statePath}`;
  }

  if (!run && last?.run?.runId === runId) {
    run = last.run;
    source = `lastRun:${lastRunPath}`;
  }

  if (!run) {
    console.error(`Run not found in orchestrator state: ${runId}`);
    console.error(`State file: ${statePath}`);
    if (last?.runId === runId) console.error(`Last run pointer: ${lastRunPath}`);
    process.exitCode = 3;
    return;
  }

  console.log(`runId: ${run.runId}`);
  console.log(`status: ${run.status}`);
  console.log(`iteration: ${run.iteration}`);
  console.log(`source: ${source}`);
  if (run.projectPhase) console.log(`phase: ${run.projectPhase}`);
  if (run.currentTaskId) console.log(`currentTaskId: ${run.currentTaskId}`);
  if (run.assignedDeveloper) console.log(`assignedDeveloper: ${run.assignedDeveloper}`);
  if (run.activeTurn?.role) console.log(`activeTurn: ${run.activeTurn.role}/${run.activeTurn.step} (turnId=${run.activeTurn.turnId || "-"})`);
  if (run.lastError?.message) console.log(`lastError: ${run.lastError.message}`);
  if (last?.port) console.log(`port: ${last.port}`);
  if (last?.cwd) console.log(`cwd(test): ${last.cwd}`);
  if (baseUrl) console.log(`baseUrl: ${baseUrl}`);

  console.log("");
  console.log("Paths:");
  const paths = [
    run.projectPipelineStatePath,
    run.projectTasksDir ? path.join(run.projectTasksDir, String(run.currentTaskId || "")) : null,
    run.projectTurnMarkersDir,
    run.cwd,
  ].filter(Boolean);
  for (const p of paths) console.log(`- ${p}`);

  if (run.projectTasksDir && run.currentTaskId) {
    const taskDir = path.join(run.projectTasksDir, run.currentTaskId);
    const taskFiles = ["task.md", "manager_instruction.md", "dev_ack.json", "dev_result.md", "dev_result.json", "manager_review.md"];
    console.log("");
    console.log("Task files:");
    for (const f of taskFiles) {
      const p = path.join(taskDir, f);
      if (fs.existsSync(p)) console.log(`- ${p}`);
    }
  }

  const latestManagerAssistant = pickLatestByStartedAt(run.logFiles, "manager", "assistantLogPath");
  const latestManagerRpc = pickLatestByStartedAt(run.logFiles, "manager", "rpcLogPath");
  const latestDeveloperAssistant = pickLatestByStartedAt(run.logFiles, "developer", "assistantLogPath");
  const latestDeveloperRpc = pickLatestByStartedAt(run.logFiles, "developer", "rpcLogPath");

  if (latestManagerAssistant?.assistantLogPath) {
    console.log("");
    console.log(`manager assistant tail: ${latestManagerAssistant.assistantLogPath}`);
    const t = tailText(latestManagerAssistant.assistantLogPath, 3000);
    if (t) console.log(t);
  }

  if (latestManagerRpc?.rpcLogPath) {
    console.log("");
    console.log(`manager rpc tail: ${latestManagerRpc.rpcLogPath}`);
    const t = tailText(latestManagerRpc.rpcLogPath, 3000);
    if (t) console.log(t);
  }

  if (latestDeveloperAssistant?.assistantLogPath) {
    console.log("");
    console.log(`developer assistant tail: ${latestDeveloperAssistant.assistantLogPath}`);
    const t = tailText(latestDeveloperAssistant.assistantLogPath, 3000);
    if (t) console.log(t);
  }

  if (latestDeveloperRpc?.rpcLogPath) {
    console.log("");
    console.log(`developer rpc tail: ${latestDeveloperRpc.rpcLogPath}`);
    const t = tailText(latestDeveloperRpc.rpcLogPath, 3000);
    if (t) console.log(t);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
