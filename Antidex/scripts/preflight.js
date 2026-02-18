const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  CodexAppServerClient,
  resolveCodexCandidates,
} = require("../../Local_Codex_appserver/server/codexAppServerClient");
const { requestJson } = require("../../Antigravity_POC/src/connectorClient");

function nowIso() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readUtf8(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function writeUtf8(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJson(filePath, value) {
  writeUtf8(filePath, JSON.stringify(value, null, 2) + os.EOL);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function randomId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function safeErrorMessage(e) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message || String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function waitForFile({ filePath, timeoutMs, pollMs }) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fs.existsSync(filePath)) return { ok: true };
    if (Date.now() - start > timeoutMs) return { ok: false, error: `Timeout waiting for ${filePath}` };
    await sleep(pollMs);
  }
}

function patchUpdatedAtIfPresent(content, iso) {
  if (!content.includes("updated_at:")) return content;
  return content.replace(/^updated_at:\s*<ISO>\s*$/m, `updated_at: ${iso}`);
}

function copyTemplateIfMissing({ srcPath, dstPath, iso }) {
  if (fs.existsSync(dstPath)) return { ok: true, created: false };
  const raw = readUtf8(srcPath);
  const patched = patchUpdatedAtIfPresent(raw, iso);
  writeUtf8(dstPath, patched.endsWith(os.EOL) ? patched : patched + os.EOL);
  return { ok: true, created: true };
}

function bootstrapCwdForPreflight({ cwd, iso }) {
  const antidexRoot = path.resolve(__dirname, "..");
  const templatesDir = path.join(antidexRoot, "doc", "agent_instruction_templates");

  ensureDir(path.join(cwd, "doc"));
  ensureDir(path.join(cwd, "agents"));
  ensureDir(path.join(cwd, "data"));
  ensureDir(path.join(cwd, "data", "antigravity_runs"));
  ensureDir(path.join(cwd, "data", "AG_internal_reports"));

  // Copy doc/GIT_WORKFLOW.md into the target cwd (non-destructive).
  const gitWorkflowSrc = path.join(antidexRoot, "doc", "GIT_WORKFLOW.md");
  const gitWorkflowDst = path.join(cwd, "doc", "GIT_WORKFLOW.md");
  if (fs.existsSync(gitWorkflowSrc)) {
    if (!fs.existsSync(gitWorkflowDst)) fs.copyFileSync(gitWorkflowSrc, gitWorkflowDst);
  }

  const templateFiles = fs
    .readdirSync(templatesDir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".md"))
    .map((e) => e.name);

  const copied = [];
  for (const name of templateFiles) {
    const srcPath = path.join(templatesDir, name);
    const dstPath = path.join(cwd, "agents", name);
    const r = copyTemplateIfMissing({ srcPath, dstPath, iso });
    copied.push({ name, ...r });
  }

  return { ok: true, copied };
}

async function checkCodexAppServer({ cwdForCodex }) {
  const candidates = resolveCodexCandidates();
  const hasCandidate = Boolean(candidates.envPath || candidates.extPath || candidates.pathPath);
  const status = {
    ok: false,
    candidates,
    started: false,
    initialized: false,
    error: null,
  };

  if (!hasCandidate) {
    status.error = "codex.exe not found (set CODEX_EXE, install VS Code Codex extension, or add codex to PATH)";
    return status;
  }

  const client = new CodexAppServerClient({ trace: false });
  try {
    await client.start({ cwd: cwdForCodex });
    status.started = true;
    await client.initialize({});
    status.initialized = true;
    status.ok = true;
  } catch (e) {
    status.error = safeErrorMessage(e);
  } finally {
    try {
      await client.stop();
    } catch {
      // ignore
    }
  }
  return status;
}

async function checkAntigravityConnector({ baseUrl }) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  const r = { ok: false, baseUrl: clean, health: null, diagnostics: null, error: null };
  try {
    const health = await requestJson({ url: `${clean}/health` });
    r.health = health;
    if (!health.ok) {
      r.error = `health failed (HTTP ${health.status})`;
      return r;
    }
    const diag = await requestJson({ url: `${clean}/diagnostics` });
    r.diagnostics = diag;
    if (!diag.ok) {
      r.error = `diagnostics failed (HTTP ${diag.status})`;
      return r;
    }
    r.ok = true;
    return r;
  } catch (e) {
    r.error = safeErrorMessage(e);
    return r;
  }
}

function buildAgPreflightPrompt({ cwd, runId }) {
  const runDir = path.join(cwd, "data", "antigravity_runs", runId);
  const ackPath = path.join(runDir, "ack.json");
  const tmpPath = path.join(runDir, "result.tmp");
  const resultPath = path.join(runDir, "result.json");
  const artifactsDir = path.join(runDir, "artifacts");
  const reportsDir = path.join(cwd, "data", "AG_internal_reports");
  const heartbeatPath = path.join(reportsDir, "heartbeat.json");

  const n = (p) => String(p).replace(/\\/g, "/");

  return [
    "Antidex preflight (AG): prove filesystem write to the target project (CWD).",
    "",
    `TARGET_CWD_ABS: ${n(cwd)}`,
    "Rule: write ONLY under TARGET_CWD_ABS. Do not assume your current working directory is the target CWD.",
    "",
    "Read:",
    `- ${n(path.join(cwd, "agents", "AG_cursorrules.md"))}`,
    `- ${n(path.join(cwd, "agents", "developer_antigravity.md"))}`,
    "",
    "Paths to write (ABS):",
    `- ACK_PATH: ${n(ackPath)}`,
    `- RESULT_TMP_PATH: ${n(tmpPath)}`,
    `- RESULT_PATH: ${n(resultPath)}`,
    `- HEARTBEAT_PATH: ${n(heartbeatPath)}`,
    `- ARTIFACTS_DIR (optional): ${n(artifactsDir)}`,
    "",
    `RUN_ID (exact): ${runId}`,
    "",
    "Protocol:",
    "1) Write ACK immediately.",
    "2) Write HEARTBEAT once (progress proof).",
    "3) Write RESULT atomically: write RESULT_TMP_PATH, then rename to RESULT_PATH.",
    "4) If blocked: write RESULT_PATH with status:error and a short reason.",
    "",
    "JSON templates:",
    `- ACK: {"status":"ack","run_id":"${runId}","started_at":"<ISO>"}`,
    `- RESULT: {"run_id":"${runId}","status":"done|error","started_at":"<ISO>","finished_at":"<ISO>","summary":"..."}`,
  ].join("\n");
}

async function checkAgSendAndFilesystem({ baseUrl, cwd, newConversation }) {
  const runId = `preflight-${randomId()}`;
  const runDir = path.join(cwd, "data", "antigravity_runs", runId);
  ensureDir(path.join(runDir, "artifacts"));

  const prompt = buildAgPreflightPrompt({ cwd, runId });
  const sendRes = await requestJson({
    url: `${String(baseUrl).replace(/\/+$/, "")}/send`,
    method: "POST",
    body: { prompt, newConversation: Boolean(newConversation), notify: false, debug: false },
    timeoutMs: 30_000,
  });

  const ackPath = path.join(runDir, "ack.json");
  const resultPath = path.join(runDir, "result.json");
  const antidexRoot = path.resolve(__dirname, "..");
  const wrongAckPath = path.join(antidexRoot, "data", "antigravity_runs", runId, "ack.json");
  const wrongResultPath = path.join(antidexRoot, "data", "antigravity_runs", runId, "result.json");

  const ackWait = await waitForFile({ filePath: ackPath, timeoutMs: 2 * 60_000, pollMs: 2_000 });
  if (!ackWait.ok) {
    const wroteWrong = fs.existsSync(wrongAckPath) || fs.existsSync(wrongResultPath);
    const hint = wroteWrong
      ? `AG may have written to the wrong base directory (found under ${wrongAckPath.replace(/\\/g, "/")}). Ensure prompts use absolute paths under the target CWD.`
      : null;
    return { ok: false, runId, sendRes, error: ackWait.error, ackPath, resultPath, hint, wrongAckPath, wrongResultPath };
  }

  const resultWait = await waitForFile({ filePath: resultPath, timeoutMs: 7 * 60_000, pollMs: 2_000 });
  if (!resultWait.ok) {
    return { ok: false, runId, sendRes, error: resultWait.error, ackPath, resultPath };
  }

  let ackJson = null;
  let resultJson = null;
  try {
    ackJson = JSON.parse(readUtf8(ackPath));
  } catch (e) {
    return { ok: false, runId, sendRes, error: `Invalid ack.json: ${safeErrorMessage(e)}`, ackPath, resultPath };
  }
  try {
    resultJson = JSON.parse(readUtf8(resultPath));
  } catch (e) {
    return { ok: false, runId, sendRes, error: `Invalid result.json: ${safeErrorMessage(e)}`, ackPath, resultPath };
  }

  const ok = String(resultJson?.status || "").toLowerCase() === "done";
  return { ok, runId, sendRes, ackJson, resultJson, ackPath, resultPath, error: ok ? null : "AG result status not done" };
}

async function main() {
  const args = parseArgs(process.argv);
  const connectorBaseUrl = String(args.connectorBaseUrl || "http://127.0.0.1:17375");
  const skipCodex = Boolean(args.skipCodex);
  const skipConnector = Boolean(args.skipConnector);
  const skipAg = Boolean(args.skipAg || args.skipAgSend);

  const antidexRoot = path.resolve(__dirname, "..");
  const reportsRoot = path.join(antidexRoot, "data", "preflight_reports");
  ensureDir(reportsRoot);

  const iso = nowIso();
  const defaultCwd = path.join(antidexRoot, "data", "preflight_cwds", iso.replace(/[:.]/g, "-"));
  const cwd = path.resolve(String(args.cwd || defaultCwd));
  ensureDir(cwd);

  const report = {
    ok: false,
    at: iso,
    cwd,
    connectorBaseUrl,
    checks: {},
  };

  // 0) Bootstrap minimal skeleton in the cwd (non-destructive) + copy templates.
  report.checks.bootstrap = bootstrapCwdForPreflight({ cwd, iso });

  // 1) Codex app-server can start + initialize.
  if (skipCodex) report.checks.codex = { ok: false, skipped: true };
  else report.checks.codex = await checkCodexAppServer({ cwdForCodex: path.join(antidexRoot, "data") });

  // 2) Antigravity connector health + diagnostics.
  if (skipConnector) report.checks.connector = { ok: false, skipped: true };
  else report.checks.connector = await checkAntigravityConnector({ baseUrl: connectorBaseUrl });

  // 3) Antigravity /send + filesystem write protocol.
  if (skipAg) {
    report.checks.ag_send = { ok: false, skipped: true };
  } else if (report.checks.connector.ok) {
    report.checks.ag_send = await checkAgSendAndFilesystem({
      baseUrl: connectorBaseUrl,
      cwd,
      newConversation: true,
    });
  } else {
    report.checks.ag_send = { ok: false, skipped: true, reason: "connector not healthy" };
  }

  report.ok = Boolean(
    (skipCodex || report.checks.codex.ok) &&
      (skipConnector || report.checks.connector.ok) &&
      (skipAg || report.checks.ag_send.ok),
  );

  const outPath = path.join(reportsRoot, `${iso.replace(/[:.]/g, "-")}_preflight.json`);
  writeJson(outPath, report);

  if (!report.ok) {
    console.error("PRECHECK FAILED");
    console.error(`Report: ${outPath}`);
    process.exitCode = 1;
    return;
  }

  console.log("OK");
  console.log(`Report: ${outPath}`);
  console.log(`CWD: ${cwd}`);
}

main().catch((e) => {
  console.error(safeErrorMessage(e));
  process.exitCode = 1;
});
