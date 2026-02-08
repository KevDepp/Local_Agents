const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (3200 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;

const smokeDir = path.join(root, "data", "smoke_ws");
const smokeFile = path.join(smokeDir, "smoke_test.txt");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  return false;
}

function parseSseBlock(block) {
  let event = null;
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}

async function waitForCompletion(runId) {
  const ac = new AbortController();
  const res = await fetch(`${baseUrl}/api/stream/${encodeURIComponent(runId)}`, {
    signal: ac.signal,
  });
  let buffer = "";
  let lastCompleted = null;
  try {
    for await (const chunk of res.body) {
      buffer += Buffer.from(chunk).toString("utf8");
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx < 0) break;
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseBlock(block);
        if (evt.event === "completed") {
          ac.abort();
          lastCompleted = JSON.parse(evt.data);
          return lastCompleted;
        }
        if (evt.event === "error") {
          ac.abort();
          throw new Error(evt.data || "stream error");
        }
      }
    }
  } catch (e) {
    if (!String(e && e.message).includes("aborted")) throw e;
  }
  if (buffer.trim()) {
    const evt = parseSseBlock(buffer);
    if (evt.event === "completed") return JSON.parse(evt.data);
  }
  if (lastCompleted) return lastCompleted;
  throw new Error("stream ended without completion");
}

async function runPrompt({ prompt, cwd, threadMode, threadId }) {
  const runRes = await fetch(`${baseUrl}/api/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, cwd, model: null, threadMode, threadId }),
  });
  const run = await runRes.json().catch(() => null);
  if (!runRes.ok || !run?.ok) throw new Error(run?.error || `HTTP ${runRes.status}`);
  const completed = await waitForCompletion(run.runId);
  return { run, completed };
}

async function main() {
  fs.mkdirSync(smokeDir, { recursive: true });
  if (fs.existsSync(smokeFile)) fs.unlinkSync(smokeFile);

  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(d.toString()));

  try {
    const ok = await waitHealthy();
    if (!ok) throw new Error("server not healthy");

    const prompt1 =
      'Create a file named "smoke_test.txt" in the current working directory containing exactly the text: smoke\\nThen reply with DONE.';
    await runPrompt({ prompt: prompt1, cwd: smokeDir, threadMode: "new", threadId: null });

    if (!fs.existsSync(smokeFile)) throw new Error("smoke_test.txt was not created");
    const content = fs.readFileSync(smokeFile, "utf8");
    const normalized = content.replace(/\r?\n$/, "");
    if (normalized !== "smoke") {
      throw new Error(`unexpected file content: ${JSON.stringify(content)}`);
    }

    const expected = "cafe\\u00e9 na\\u00efve - emoji \\u2705";
    const expectedText = expected.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
    const prompt2 = `Reply with exactly: ${expectedText}`;
    const r2 = await runPrompt({ prompt: prompt2, cwd: smokeDir, threadMode: "new", threadId: null });
    const assistantText = String(r2.completed?.assistantText || "");
    if (!assistantText.includes(expectedText)) {
      throw new Error(`encoding check failed. got: ${JSON.stringify(assistantText)}`);
    }

    console.log("OK");
  } finally {
    try {
      if (fs.existsSync(smokeFile)) fs.unlinkSync(smokeFile);
    } catch {
      // ignore
    }
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
