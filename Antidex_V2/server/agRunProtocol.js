const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function createAgRunId({ taskId } = {}) {
  const nonce = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString("hex");
  const safeTask = String(taskId || "task").replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 50);
  return `ag-${safeTask}-${nonce.replace(/-/g, "").slice(0, 16)}`;
}

function makeAgRunPaths({ projectCwd, runId, runsRoot = path.join("data", "antigravity_runs") }) {
  const root = path.resolve(projectCwd, runsRoot);
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

function initAgRun({ projectCwd, runId, taskId, requestText }) {
  const id = runId || createAgRunId({ taskId });
  const paths = makeAgRunPaths({ projectCwd, runId: id });
  ensureDir(paths.runDir);
  ensureDir(paths.artifactsDir);
  if (typeof requestText === "string") fs.writeFileSync(paths.requestPath, requestText, "utf8");
  return { runId: id, paths };
}

module.exports = { createAgRunId, makeAgRunPaths, initAgRun };

