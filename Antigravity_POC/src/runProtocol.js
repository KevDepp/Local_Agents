const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function createRunId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function makeRunPaths({ cwd, runsRoot = "data/antigravity_runs", runId }) {
  const root = path.resolve(cwd, runsRoot);
  const runDir = path.join(root, String(runId));
  return {
    root,
    runDir,
    requestPath: path.join(runDir, "request.md"),
    ackPath: path.join(runDir, "ack.json"),
    resultPath: path.join(runDir, "result.json"),
    resultTmpPath: path.join(runDir, "result.tmp"),
    artifactsDir: path.join(runDir, "artifacts"),
  };
}

function initRun({ cwd, runsRoot, runId, taskText }) {
  const id = runId || createRunId();
  const paths = makeRunPaths({ cwd, runsRoot, runId: id });
  ensureDir(paths.runDir);
  ensureDir(paths.artifactsDir);
  fs.writeFileSync(paths.requestPath, String(taskText || ""), "utf8");
  return { runId: id, paths };
}

function buildPromptWithFileOutput({ task, resultPath, resultTmpPath, ackPath }) {
  const lines = [];
  lines.push("Task:");
  lines.push(String(task || "").trim());
  lines.push("");
  lines.push("Output protocol (MUST):");
  if (ackPath) {
    lines.push(`1) Immediately write ack JSON to: ${ackPath}`);
    lines.push('   Example: {"status":"ack","started_at":"<ISO>"}');
  }
  lines.push(`2) Write final result as JSON to temp file: ${resultTmpPath}`);
  lines.push(`3) When finished, rename temp file to: ${resultPath}`);
  lines.push("");
  lines.push("Result JSON schema (minimum):");
  lines.push("{");
  lines.push('  "run_id": "<runId>",');
  lines.push('  "status": "done|error",');
  lines.push('  "started_at": "<ISO>",');
  lines.push('  "finished_at": "<ISO>",');
  lines.push('  "summary": "<short>",');
  lines.push('  "output": "<long or structured>",');
  lines.push('  "error": { "message": "<error>" }');
  lines.push("}");
  lines.push("");
  lines.push("Important: do not write partial JSON to result.json directly.");
  return lines.join("\n");
}

module.exports = {
  createRunId,
  makeRunPaths,
  initRun,
  buildPromptWithFileOutput,
};

