const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const { waitForResult, waitForAck } = require("../../src/waitForResult");

async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ag-poc-"));
  const resultPath = path.join(tmpRoot, "result.json");

  setTimeout(() => {
    fs.writeFileSync(resultPath, JSON.stringify({ status: "done", output: "ok" }), "utf8");
  }, 200);

  const res = await waitForResult({ resultPath, timeoutMs: 2000, pollMs: 100, stableChecks: 1 });
  assert.equal(res.status, "done");
  assert.equal(res.output, "ok");

  // Invalid JSON then fix
  const resultPath2 = path.join(tmpRoot, "result2.json");
  setTimeout(() => {
    fs.writeFileSync(resultPath2, "{", "utf8");
    setTimeout(() => {
      fs.writeFileSync(resultPath2, JSON.stringify({ status: "done", output: "ok2" }), "utf8");
    }, 200);
  }, 200);

  const res2 = await waitForResult({ resultPath: resultPath2, timeoutMs: 4000, pollMs: 100, stableChecks: 1 });
  assert.equal(res2.output, "ok2");

  // Ack path quick test
  const ackPath = path.join(tmpRoot, "ack.json");
  setTimeout(() => {
    fs.writeFileSync(ackPath, JSON.stringify({ status: "ack" }), "utf8");
  }, 150);
  const ack = await waitForAck({ ackPath, timeoutMs: 2000, pollMs: 100 });
  assert.equal(ack.status, "ack");
}

module.exports = { run };

if (require.main === module) {
  run().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
}
