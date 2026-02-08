const path = require("node:path");
const { spawn } = require("node:child_process");

function run() {
  const cwd = process.env.POC_CWD;
  if (!cwd) {
    console.error("Set POC_CWD to a writable project directory.");
    process.exitCode = 2;
    return;
  }

  const task =
    "Compute 123*456 and write result.json using the protocol. Output must be 56088.";

  const child = spawn(process.execPath, ["src/cli.js", "--cwd", cwd, "--task", task], {
    cwd: path.resolve(__dirname, "../.."),
    stdio: "inherit",
  });

  child.on("exit", (code) => {
    process.exitCode = code === 0 ? 0 : 1;
  });
}

run();

