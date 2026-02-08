const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function pathExists(p) {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function listWindowsDrives() {
  const roots = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const drive = `${letter}:\\`;
    if (pathExists(drive)) roots.push(drive);
  }
  return roots;
}

function listRoots({ preferredRoots = [], includeSystemRoots = true } = {}) {
  const roots = [];

  for (const r of preferredRoots) {
    if (typeof r !== "string") continue;
    const full = path.resolve(r);
    if (pathExists(full)) roots.push(full);
  }

  if (includeSystemRoots && process.platform === "win32") roots.push(...listWindowsDrives());

  if (includeSystemRoots) {
    const home = os.homedir();
    if (pathExists(home)) roots.push(home);
  }

  // de-dup while preserving order
  const seen = new Set();
  const uniq = [];
  for (const r of roots) {
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(r);
  }

  return uniq.map((p) => ({ path: p, label: p }));
}

function listDirs(dirPath) {
  const resolved = path.resolve(dirPath);
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => {
      const fullPath = path.join(resolved, e.name);
      return { name: e.name, path: fullPath };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { path: resolved, dirs };
}

module.exports = { listRoots, listDirs };
