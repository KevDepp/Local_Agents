/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function writeTextAtomic(p, text) {
  ensureDir(path.dirname(p));
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, p);
}

function writeJsonAtomic(p, obj) {
  writeTextAtomic(p, JSON.stringify(obj, null, 2) + "\n");
}

function readJsonBestEffort(p) {
  try {
    if (!fs.existsSync(p)) return { ok: true, value: null };
    const raw = fs.readFileSync(p, "utf8");
    const cleaned = raw && raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
    return { ok: true, value: JSON.parse(cleaned) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function httpJson({ url, method = "GET", body = null, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForFile(p, { timeoutMs = 60_000, pollMs = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(p)) return true;
    await sleep(pollMs);
  }
  return false;
}

function relTo(root, p) {
  return path.relative(root, p).replace(/\\/g, "/");
}

function newId(prefix) {
  const nonce = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
  return `${prefix}-${nonce.replace(/-/g, "").slice(0, 16)}`;
}

async function main() {
  const connectorBaseUrl = process.env.CONNECTOR_BASE_URL || "http://127.0.0.1:17375";
  const projectRoot =
    process.env.DEBUG_CWD ||
    path.resolve(__dirname, "..", "data", "_ag_link_debug_projects", nowIso().replace(/[:.]/g, "-"));
  ensureDir(projectRoot);

  const debugDir = path.join(projectRoot, "ag_link_debug");
  const inboxDir = path.join(debugDir, "inbox");
  const outboxDir = path.join(debugDir, "outbox");
  ensureDir(inboxDir);
  ensureDir(outboxDir);

  const runId = process.env.AG_RUN_ID || newId("ag-link-debug");
  console.log(`[debug] connector=${connectorBaseUrl}`);
  console.log(`[debug] projectRoot=${projectRoot}`);
  console.log(`[debug] runId=${runId}`);

  const health = await httpJson({ url: `${connectorBaseUrl}/health` });
  console.log(`[health] ok=${health.ok} status=${health.status} body=${health.text.slice(0, 500)}`);
  if (!health.ok) process.exitCode = 2;

  async function sendMsg({ msgNo, newThread, purpose }) {
    const msgId = `MSG-${String(msgNo).padStart(4, "0")}`;
    const needle = `${runId}:${msgId}:${newId("needle")}`;

    const inboxPath = path.join(inboxDir, `${msgId}.md`);
    const ackPath = path.join(outboxDir, `${msgId}_ack.json`);
    const progressPath = path.join(outboxDir, `${msgId}_progress.jsonl`);
    const donePath = path.join(outboxDir, `${msgId}_done.json`);

    const inboxText = [
      `# ${msgId}`,
      "",
      `purpose: ${purpose}`,
      `needle: ${needle}`,
      `thread_mode_expected: ${newThread ? "new" : "reuse"}`,
      "",
      "Required actions:",
      `1) Write ACK quickly to: ${relTo(projectRoot, ackPath)} (include msg_id + needle).`,
      `2) Append at least 2 progress lines to: ${relTo(projectRoot, progressPath)} (JSONL).`,
      `3) Write DONE to: ${relTo(projectRoot, donePath)} (include msg_id + needle + summary).`,
      "",
      "If you will do long browser work, write progress with stage=\"browser\" and include expected_silence_ms.",
      "",
    ].join("\n");

    writeTextAtomic(inboxPath, inboxText);

    const prompt = [
      "Hi! I am the Codex-side orchestrator running an experiment to validate whether the connector response reliably means you received the message.",
      "You are Antigravity (AG). We will keep the SAME conversation thread across messages so you remember this protocol.",
      "",
      `Experiment run_id: ${runId}`,
      `Message: ${msgId}`,
      `Needle: ${needle}`,
      `Thread: ${newThread ? "START NEW thread (first message of this experiment)" : "REUSE the same thread (continue)"}`,
      "",
      `Project root (absolute): ${projectRoot}`,
      "",
      "Your ONLY goal: prove delivery + progress via files.",
      "Do NOT write anywhere else outside ag_link_debug/.",
      "",
      "Step 0 (read):",
      `- Read this message file: ${relTo(projectRoot, inboxPath)}`,
      "",
      "Step 1 (delivery ACK within 30s):",
      `- Write JSON (atomic) to: ${relTo(projectRoot, ackPath)}`,
      '  - minimum: { "msg_id":"...", "needle":"...", "status":"received", "received_at":"<ISO>", "thread_mode":"new|reuse" }',
      "",
      "Step 2 (progress / heartbeat):",
      `- Append JSONL lines to: ${relTo(projectRoot, progressPath)}`,
      '  - minimum: { "at":"<ISO>", "msg_id":"...", "stage":"reading|planning|browser|writing|done", "note":"..." }',
      "",
      "Step 3 (done):",
      `- Write JSON (atomic) to: ${relTo(projectRoot, donePath)}`,
      '  - minimum: { "msg_id":"...", "needle":"...", "status":"done", "finished_at":"<ISO>", "summary":"..." }',
      "",
      "If you have suggestions to make this protocol more robust (especially during long browser use), include them in the DONE JSON under a field 'suggestions'.",
    ].join("\n");

    const sendRes = await httpJson({
      url: `${connectorBaseUrl}/send`,
      method: "POST",
      body: {
        prompt,
        requestId: `ag-link-debug:${runId}:${msgId}`,
        runId,
        newThread: newThread === true,
        notify: true,
        debug: true,
        verifyNeedle: needle,
      },
      timeoutMs: 60_000,
    });

    console.log(`[send] ${msgId} http=${sendRes.status} ok=${sendRes.ok} json_ok=${sendRes.json?.ok} err=${sendRes.json?.error || ""}`);
    if (sendRes.json) console.log(`[send] ${msgId} json=${JSON.stringify(sendRes.json).slice(0, 500)}`);

    const ackOk = await waitForFile(ackPath, { timeoutMs: 90_000 });
    console.log(`[ack] ${msgId} exists=${ackOk} path=${ackPath}`);
    if (ackOk) {
      const ack = readJsonBestEffort(ackPath);
      console.log(`[ack] ${msgId} json_ok=${ack.ok} value=${ack.ok ? JSON.stringify(ack.value) : ack.error}`);
    }

    const doneOk = await waitForFile(donePath, { timeoutMs: 5 * 60_000 });
    console.log(`[done] ${msgId} exists=${doneOk} path=${donePath}`);
    if (doneOk) {
      const done = readJsonBestEffort(donePath);
      console.log(`[done] ${msgId} json_ok=${done.ok} value_head=${done.ok ? JSON.stringify(done.value).slice(0, 800) : done.error}`);
    }

    return { msgId, needle, sendRes, ackOk, doneOk, paths: { inboxPath, ackPath, progressPath, donePath } };
  }

  // 1) Start a new AG thread for this experiment.
  const r1 = await sendMsg({ msgNo: 1, newThread: true, purpose: "Handshake: prove you can ack/progress/done quickly." });
  // 2) Reuse the same thread.
  const r2 = await sendMsg({ msgNo: 2, newThread: false, purpose: "Thread continuity: confirm you remember the protocol and can ack again." });
  // 3) Ask for protocol improvements for long browser work.
  const r3 = await sendMsg({ msgNo: 3, newThread: false, purpose: "Design: propose improvements for long browser periods and false connector diagnostics." });

  console.log("\n=== Summary ===");
  for (const r of [r1, r2, r3]) {
    console.log(
      `${r.msgId}: send_http=${r.sendRes.status} connector_ok=${r.sendRes.ok} json_ok=${r.sendRes.json?.ok} ack=${r.ackOk} done=${r.doneOk}`,
    );
  }
  console.log(`[paths] projectRoot=${projectRoot}`);
  console.log(`[paths] inbox=${path.join(projectRoot, "ag_link_debug", "inbox")}`);
  console.log(`[paths] outbox=${path.join(projectRoot, "ag_link_debug", "outbox")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

