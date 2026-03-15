const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || (5600 + Math.floor(Math.random() * 400)));
const baseUrl = `http://127.0.0.1:${port}`;
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-injection-check-"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-data-"));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitHealthy() {
  for (let i = 0; i < 90; i++) {
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

async function apiPost(pathname, body) {
  const r = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error || `POST ${pathname} -> ${r.status}`);
  return json;
}

async function apiGet(pathname) {
  const r = await fetch(`${baseUrl}${pathname}`, { headers: { "cache-control": "no-store" } });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) throw new Error(json?.error || `GET ${pathname} -> ${r.status}`);
  return json;
}

function readTextBestEffort(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function findAnyLogFile(run, kind) {
  const list = Array.isArray(run?.logFiles) ? run.logFiles : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    const p = kind === "rpc" ? entry?.rpcLogPath : entry?.assistantLogPath;
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ANTIDEX_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (d) => process.stdout.write(d.toString()));
  child.stderr.on("data", (d) => process.stderr.write(d.toString()));

  let runId = null;
  try {
    const ok = await waitHealthy();
    if (!ok) throw new Error("server not healthy");

    const start = await apiPost("/api/pipeline/start", {
      cwd: projectDir,
      userPrompt: "Instruction-injection check: create hello.txt with content 'ok'. Use developer_codex only.",
      managerModel: "gpt-5.4",
      developerModel: "gpt-5.4",
      managerPreprompt: "Follow the Antidex file protocol. Keep prompts short.",
      developerPreprompt: "",
      createProjectDir: false,
      autoRun: true,
    });

    runId = start.run?.runId;
    if (!runId) throw new Error("start did not return runId");

    const startAt = Date.now();
    const timeoutMs = Number(process.env.INJECTION_CHECK_TIMEOUT_MS || 60_000);
    let rpcLogPath = null;

    while (Date.now() - startAt < timeoutMs) {
      const state = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
      const run = state?.run;
      rpcLogPath = findAnyLogFile(run, "rpc");
      if (rpcLogPath) break;
      await sleep(400);
    }

    if (!rpcLogPath) throw new Error("no rpc log file observed within timeout");

    const rpcText = readTextBestEffort(rpcLogPath) || "";
    const hasSkillsBlock = /skill-creator|skill-installer/i.test(rpcText);

    console.log(`rpcLogPath: ${rpcLogPath}`);
    console.log(`skills_block_detected: ${hasSkillsBlock ? "YES" : "NO"}`);

    if (hasSkillsBlock) {
      console.log("note: detected 'skill-*' strings in the RPC log; project-local AGENTS.md may not be taking effect.");
    } else {
      console.log("note: no 'skill-*' strings detected in RPC log.");
    }
  } finally {
    if (runId) {
      try {
        await apiPost("/api/pipeline/stop", { runId });
      } catch {
        // ignore
      }
    }

    if (process.env.KEEP_TEST_FIXTURE !== "1") {
      try {
        fs.rmSync(projectDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    } else {
      console.log(`Keeping fixture at ${projectDir}`);
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
