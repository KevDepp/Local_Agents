const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function ensureDir(p) {
  try {
    if (!p) return;
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  } catch {
    // ignore
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowIsoForFile() {
  return nowIso().replace(/[:.]/g, "-");
}

function readJsonBestEffort(p) {
  try {
    if (!p || !fs.existsSync(p)) return { ok: true, value: null };
    let raw = fs.readFileSync(p, "utf8");
    if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const json = JSON.stringify(value, null, 2) + "\n";
  fs.writeFileSync(tmpPath, json, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // ignore
    }
    fs.renameSync(tmpPath, filePath);
  }
}

function safeStat(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
}

function killProcessTreeBestEffort(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: "invalid_pid" };
  try {
    // Windows-friendly kill tree.
    const r = spawnSync("taskkill", ["/PID", String(n), "/T", "/F"], { windowsHide: true });
    if (r.status === 0) return { ok: true };
  } catch {
    // ignore
  }
  try {
    process.kill(n);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function jobsRootAbs(cwd) {
  return path.join(String(cwd || ""), "data", "jobs");
}

function jobRequestsDirAbs(cwd) {
  return path.join(jobsRootAbs(cwd), "requests");
}

function jobDirAbs(cwd, jobId) {
  return path.join(jobsRootAbs(cwd), String(jobId || ""));
}

function ensureJobsLayout(cwd) {
  ensureDir(jobsRootAbs(cwd));
  ensureDir(jobRequestsDirAbs(cwd));
}

function listJobRequestFiles(cwd) {
  const dir = jobRequestsDirAbs(cwd);
  try {
    if (!fs.existsSync(dir)) return [];
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    const files = [];
    for (const e of ents) {
      if (!e.isFile()) continue;
      if (!/\.json$/i.test(e.name)) continue;
      files.push(path.join(dir, e.name));
    }
    files.sort((a, b) => (safeStat(a)?.mtimeMs ?? 0) - (safeStat(b)?.mtimeMs ?? 0));
    return files;
  } catch {
    return [];
  }
}

function listJobIds(cwd) {
  const root = jobsRootAbs(cwd);
  try {
    if (!fs.existsSync(root)) return [];
    const ents = fs.readdirSync(root, { withFileTypes: true });
    const out = [];
    for (const e of ents) {
      if (!e.isDirectory()) continue;
      if (e.name === "requests") continue;
      out.push(e.name);
    }
    out.sort();
    return out;
  } catch {
    return [];
  }
}

function tailTextFile(p, maxBytes = 200_000) {
  try {
    if (!p || !fs.existsSync(p)) return "";
    const st = fs.statSync(p);
    const size = Number(st.size || 0);
    const start = Math.max(0, size - Math.max(0, maxBytes | 0));
    const fd = fs.openSync(p, "r");
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  } catch {
    return "";
  }
}

module.exports = {
  ensureDir,
  nowIso,
  nowIsoForFile,
  readJsonBestEffort,
  writeJsonAtomic,
  safeStat,
  isPidAlive,
  killProcessTreeBestEffort,
  jobsRootAbs,
  jobRequestsDirAbs,
  jobDirAbs,
  ensureJobsLayout,
  listJobRequestFiles,
  listJobIds,
  tailTextFile,
};

