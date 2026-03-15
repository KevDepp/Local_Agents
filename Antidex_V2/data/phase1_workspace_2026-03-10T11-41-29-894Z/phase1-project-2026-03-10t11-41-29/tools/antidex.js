/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

function ensureDir(p) {
  if (!p) return;
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function nowIso() {
  return new Date().toISOString();
}

function nowIsoForFile() {
  return nowIso().replace(/[:.]/g, "-");
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    try { fs.rmSync(filePath, { force: true }); } catch { /* ignore */ }
    fs.renameSync(tmpPath, filePath);
  }
}

function usage() {
  console.log([
    "Antidex project helper (local).",
    "",
    "Usage:",
    "  tools\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 --script .\\scripts\\bench.cmd",
    "  tools\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 -- node .\\scripts\\bench.js --seed 1",
    "  tools\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 --command \"node scripts/bench.js\"",
    "",
    "Notes:",
    "- Writes a request JSON to data/jobs/requests/*.json for the orchestrator.",
    "- The orchestrator spawns the background process and monitors it.",
    "- Prefer --script or the argv form after `--` on Windows; both avoid nested shell quoting bugs.",
    "- --command remains supported for simple shell commands but is less robust on Windows.",
  ].join("\n"));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--") {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (a && a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v && !v.startsWith("--")) {
        out[k] = v;
        i += 1;
      } else {
        out[k] = true;
      }
      continue;
    }
    out._.push(a);
  }
  return out;
}

function parseJsonArray(value, label) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!Array.isArray(parsed) || !parsed.length) throw new Error("must be a non-empty JSON array");
    return parsed.map((item) => String(item));
  } catch (e) {
    throw new Error(`${label} must be a JSON array of strings (${e instanceof Error ? e.message : String(e)})`);
  }
}

function quoteArgForDisplay(value) {
  const s = String(value ?? "");
  if (!s) return '\"\"';
  if (!/[\s"]/u.test(s)) return s;
  return `\"${s.replace(/([\"\\\\])/g, "\\$1")}\"`;
}

function formatArgvForDisplay(argv) {
  return argv.map((item) => quoteArgForDisplay(item)).join(" ");
}

function inferScriptArgv(scriptPath) {
  const p = String(scriptPath || "").trim();
  if (!p) throw new Error("Missing --script path");
  const ext = path.extname(p).toLowerCase();
  if (ext === ".ps1") return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", p];
  if (ext === ".js" || ext === ".cjs" || ext === ".mjs") return ["node", p];
  if (ext === ".cmd" || ext === ".bat") return ["cmd.exe", "/d", "/c", p];
  return os.platform() === "win32" ? ["cmd.exe", "/d", "/c", p] : [p];
}

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length) return usage();

  const cmd = argv[0];
  const sub = argv[1];
  const args = parseArgs(argv.slice(2));

  if (cmd !== "job" || sub !== "start") {
    return usage();
  }

  const runId = args["run-id"] ? String(args["run-id"]).trim() : "";
  const taskId = args["task-id"] ? String(args["task-id"]).trim() : "";
  const expectedMinutes = args["expected-minutes"] ? Number(args["expected-minutes"]) : null;
  const monitorEveryMinutes = args["monitor-every-minutes"] ? Number(args["monitor-every-minutes"]) : null;
  const monitorGraceMinutes = args["monitor-grace-minutes"] ? Number(args["monitor-grace-minutes"]) : null;
  const jobId = args["job-id"] ? String(args["job-id"]).trim() : "";
  const scriptPath = args.script ? String(args.script).trim() : "";
  const argvFromJson = args["command-argv-json"] ? parseJsonArray(args["command-argv-json"], "--command-argv-json") : [];
  const argvFromRemainder = Array.isArray(args._) && args._.length ? args._.map((item) => String(item)) : [];
  const commandArgv = scriptPath ? inferScriptArgv(scriptPath) : (argvFromJson.length ? argvFromJson : argvFromRemainder);
  const rawCommand = args.command ? String(args.command) : "";

  if (scriptPath && (rawCommand.trim() || argvFromJson.length || argvFromRemainder.length)) {
    console.error("Use either --script, --command-argv-json, argv after --, or --command, but not several forms at once.");
    process.exitCode = 2;
    return;
  }
  if (argvFromJson.length && argvFromRemainder.length) {
    console.error("Use either --command-argv-json or argv after --, but not both.");
    process.exitCode = 2;
    return;
  }

  const command = commandArgv.length ? formatArgvForDisplay(commandArgv) : rawCommand.trim();
  if (!command) {
    console.error("Missing launch command. Use --script, argv after --, --command-argv-json, or --command.");
    process.exitCode = 2;
    return;
  }

  const cwd = process.cwd();
  const requestsDir = path.join(cwd, "data", "jobs", "requests");
  ensureDir(requestsDir);

  const ts = nowIsoForFile().slice(0, 19);
  const safeTask = (taskId || "task").replace(/[^A-Za-z0-9_-]/g, "-");
  const safeRun = (runId || "run").replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 12);
  const file = `REQ-${ts}-${safeRun}-${safeTask}.json`;
  const outPath = path.join(requestsDir, file);

  const payload = {
    schema: "antidex.long_job.request.v1",
    created_at: nowIso(),
    run_id: runId || null,
    task_id: taskId || null,
    job_id: jobId || null,
    expected_minutes: Number.isFinite(expectedMinutes) ? expectedMinutes : null,
    monitor_every_minutes: Number.isFinite(monitorEveryMinutes) ? monitorEveryMinutes : null,
    monitor_grace_minutes: Number.isFinite(monitorGraceMinutes) ? monitorGraceMinutes : null,
    command,
    command_argv: commandArgv.length ? commandArgv : null,
  };
  writeJsonAtomic(outPath, payload);
  console.log(`Wrote job request: ${path.relative(cwd, outPath)}`);
}

try {
  main();
} catch (e) {
  console.error(e && e.stack ? e.stack : String(e));
  process.exitCode = 1;
}
