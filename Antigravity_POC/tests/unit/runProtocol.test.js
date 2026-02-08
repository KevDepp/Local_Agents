const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { initRun, buildPromptWithFileOutput } = require("../../src/runProtocol");

async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ag-poc-"));
  const cwd = path.join(tmpRoot, "project");
  fs.mkdirSync(cwd, { recursive: true });

  const task = "Test task";
  const { runId, paths } = initRun({ cwd, taskText: task });

  assert.ok(runId);
  assert.ok(fs.existsSync(paths.runDir));
  assert.ok(fs.existsSync(paths.requestPath));
  const req = fs.readFileSync(paths.requestPath, "utf8");
  assert.ok(req.includes(task));

  const prompt = buildPromptWithFileOutput({
    task,
    resultPath: paths.resultPath,
    resultTmpPath: paths.resultTmpPath,
    ackPath: paths.ackPath,
  });
  assert.ok(prompt.includes(paths.resultPath));
  assert.ok(prompt.includes(paths.resultTmpPath));
  assert.ok(prompt.includes(paths.ackPath));
}

module.exports = { run };

if (require.main === module) {
  run().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}

