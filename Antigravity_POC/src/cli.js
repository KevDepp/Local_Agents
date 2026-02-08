const fs = require("node:fs");
const path = require("node:path");
const { ConnectorClient } = require("./connectorClient");
const { initRun, buildPromptWithFileOutput } = require("./runProtocol");
const { waitForResult, waitForAck } = require("./waitForResult");

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      args._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const cwd = args.cwd ? String(args.cwd) : null;
  const task = args.task ? String(args.task) : null;
  const connectorUrl = args.connector ? String(args.connector) : "http://localhost:17375";
  const timeoutMs = args.timeout ? Number(args.timeout) : 5 * 60 * 1000;
  const pollMs = args.poll ? Number(args.poll) : 500;
  const ack = args["no-ack"] ? false : true;
  const ackTimeoutMs = args["ack-timeout"] ? Number(args["ack-timeout"]) : 10_000;
  const dryRun = !!args["dry-run"];

  if (!cwd || !task) {
    console.error(
      "Usage: node src/cli.js --cwd <path> --task <text> [--connector URL] [--timeout ms] [--poll ms] [--no-ack] [--ack-timeout ms] [--dry-run]",
    );
    process.exitCode = 2;
    return;
  }
  const resolvedCwd = path.resolve(cwd);
  if (!fs.existsSync(resolvedCwd) || !fs.statSync(resolvedCwd).isDirectory()) {
    console.error(`cwd is not a directory: ${resolvedCwd}`);
    process.exitCode = 2;
    return;
  }

  const { runId, paths } = initRun({ cwd: resolvedCwd, taskText: task });
  const prompt = buildPromptWithFileOutput({
    task,
    resultPath: paths.resultPath,
    resultTmpPath: paths.resultTmpPath,
    ackPath: ack ? paths.ackPath : null,
  });

  if (dryRun) {
    console.log(`[dry-run] runId=${runId}`);
    console.log(prompt);
    return;
  }

  const client = new ConnectorClient({ baseUrl: connectorUrl });
  const health = await client.health();
  if (!health.ok) {
    console.error(`Connector /health failed: ${health.status} ${health.text || ""}`);
    process.exitCode = 2;
    return;
  }

  const diagRes = await client.diagnostics();
  if (!diagRes.ok) {
    console.error(`Connector /diagnostics failed: ${diagRes.status} ${diagRes.text || ""}`);
    process.exitCode = 2;
    return;
  }
  const diagCommands = Array.isArray(diagRes.json && diagRes.json.commands) ? diagRes.json.commands : [];
  const antigravityCommands = diagCommands.filter(
    (c) => typeof c === "string" && c.startsWith("antigravity."),
  );
  if (antigravityCommands.length === 0) {
    const app = (health.json && health.json.app) || (diagRes.json && diagRes.json.app) || "unknown";
    let extra = "";
    try {
      const extRes = await client.extensions();
      const ids = Array.isArray(extRes.json && extRes.json.ids) ? extRes.json.ids : [];
      const likely = ids
        .filter((id) => typeof id === "string")
        .filter((id) => id.toLowerCase().includes("antigravity"))
        .filter((id) => !id.toLowerCase().includes("antigravity-connector"))
        .slice(0, 20);
      extra = likely.length ? `\nInstalled VS Code extensions matching 'antigravity':\n- ${likely.join("\n- ")}` : "";
    } catch {
      // ignore
    }

    console.error(
      [
        "No Antigravity commands detected in the VS Code instance hosting the connector.",
        `Connector app: ${app}`,
        `Connector URL: ${connectorUrl}`,
        "This means the connector cannot reliably send a prompt to Antigravity (it would fall back to blind typing).",
        "Fix: ensure this connector is running inside Antigravity (and not plain VS Code), and that Antigravity is active in that window.",
        "Tip: the Antigravity connector is usually on http://127.0.0.1:17375, while a VS Code instance may use 17374.",
        extra,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    process.exitCode = 2;
    return;
  }
  if (!antigravityCommands.includes("antigravity.sendTextToChat")) {
    console.error(
      [
        "Warning: 'antigravity.sendTextToChat' not found.",
        "The connector may fall back to UI typing, which can miss focus and cause ACK timeouts.",
      ].join("\n"),
    );
  }

  const sendRes = await client.send(prompt);
  const sendOk = !!(sendRes.json && sendRes.json.ok === true);
  if (!sendRes.ok || !sendOk) {
    const detail = sendRes.text ? ` ${sendRes.text}` : "";
    console.error(`Connector /send failed: ${sendRes.status}${detail}`);
    process.exitCode = 2;
    return;
  }

  if (ack) {
    try {
      await waitForAck({ ackPath: paths.ackPath, timeoutMs: ackTimeoutMs, pollMs });
    } catch (e) {
      console.error(
        [
          "ACK timeout. Antigravity did not confirm receipt.",
          "Possible cause: auto-accept extension not active or tool approvals blocked.",
          `ackPath: ${paths.ackPath}`,
        ].join("\n"),
      );
      process.exitCode = 2;
      return;
    }
  }

  const result = await waitForResult({ resultPath: paths.resultPath, timeoutMs, pollMs });
  console.log(JSON.stringify({ runId, result }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
