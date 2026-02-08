const { ConnectorClient } = require("../../src/connectorClient");

async function run() {
  const client = new ConnectorClient({});
  const health = await client.health();
  if (!health.ok) {
    console.error("Connector /health failed. Is antigravity-connector running on :17375?");
    process.exitCode = 2;
    return;
  }
  const diag = await client.diagnostics();
  if (!diag.ok) {
    console.error("Connector /diagnostics failed.");
    process.exitCode = 2;
    return;
  }

  const commands = Array.isArray(diag.json && diag.json.commands) ? diag.json.commands : [];
  const ag = commands.filter((c) => typeof c === "string" && c.startsWith("antigravity."));
  if (ag.length === 0) {
    const app = (health.json && health.json.app) || (diag.json && diag.json.app) || "unknown";
    console.error(`Connector is reachable but exposes no antigravity.* commands (app=${app}).`);
    process.exitCode = 2;
    return;
  }
  console.log("OK");
}

run().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
