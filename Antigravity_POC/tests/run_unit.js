const path = require("node:path");

const testFiles = [
  path.join(__dirname, "unit", "runProtocol.test.js"),
  path.join(__dirname, "unit", "waitForResult.test.js"),
];

async function run() {
  for (const file of testFiles) {
    const mod = require(file);
    if (typeof mod.run !== "function") {
      throw new Error(`No run() export in ${file}`);
    }
    await mod.run();
  }
  console.log("OK");
}

run().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});

