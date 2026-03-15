#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { AntigravityConnectorClient } = require("../server/antigravityConnectorClient");

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--session" && argv[i + 1]) out.session = String(argv[++i]);
    else if (a === "--sessionDir" && argv[i + 1]) out.sessionDir = String(argv[++i]);
    else if (a === "--file" && argv[i + 1]) out.file = String(argv[++i]);
    else if (a === "--baseUrl" && argv[i + 1]) out.baseUrl = String(argv[++i]);
    else if (a === "--newThread") out.newThread = true;
    else if (a === "--notify") out.notify = true;
    else if (a === "--debug") out.debug = true;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.baseUrl || "http://127.0.0.1:17375";
  const sessionId = args.session || null;
  const sessionDir = args.sessionDir
    ? path.resolve(args.sessionDir)
    : sessionId
      ? path.resolve(__dirname, "..", "..", "ag_coordination", "sessions", sessionId)
      : null;

  if (!sessionDir) {
    throw new Error("Missing --session <id> or --sessionDir <path>");
  }

  const requestPath = args.file ? path.resolve(sessionDir, String(args.file)) : path.join(sessionDir, "request.md");
  if (!fs.existsSync(requestPath)) {
    throw new Error(`Missing request file: ${requestPath}`);
  }
  const prompt = fs.readFileSync(requestPath, "utf8");

  const client = new AntigravityConnectorClient({ baseUrl, timeoutMs: 10_000 });
  const requestId = `ag-oob-${sessionId || path.basename(sessionDir)}-${Date.now()}`;

  const resp = await client.send({
    prompt,
    requestId,
    runId: sessionId || path.basename(sessionDir),
    newThread: args.newThread === true,
    notify: args.notify === true,
    debug: args.debug === true,
    meta: { kind: "ag_coordination_oob", sessionDir },
  });

  const outPath = path.join(sessionDir, "connector_send_response.json");
  try {
    fs.writeFileSync(outPath, JSON.stringify({ at: nowIso(), requestId, baseUrl, ...resp }, null, 2) + "\n", "utf8");
  } catch {
    // ignore
  }
  process.stdout.write(JSON.stringify(resp, null, 2) + "\n");
}

main().catch((e) => {
  process.stderr.write(String(e && e.stack ? e.stack : e) + "\n");
  process.exit(1);
});
