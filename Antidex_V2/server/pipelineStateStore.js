const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STATE = {
  runs: {},
};

function mojibakeMarkerCount(s) {
  // Common UTF-8-as-latin1 mojibake markers for Western European text.
  // Examples: "UniversitÃ©", "dÃ©veloppeur", "â€”", "Â ".
  const m = String(s || "").match(/[ÃÂâ€�œ]/g);
  return m ? m.length : 0;
}

function tryRepairUtf8AsLatin1(s) {
  try {
    return Buffer.from(String(s), "latin1").toString("utf8");
  } catch {
    return String(s);
  }
}

function repairMojibakeDeep(value) {
  if (typeof value === "string") {
    const before = value;
    const beforeScore = mojibakeMarkerCount(before);
    if (beforeScore <= 0) return { changed: false, value };
    const repaired = tryRepairUtf8AsLatin1(before);
    const afterScore = mojibakeMarkerCount(repaired);
    if (repaired !== before && afterScore < beforeScore) return { changed: true, value: repaired };
    return { changed: false, value };
  }
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map((v) => {
      const r = repairMojibakeDeep(v);
      if (r.changed) changed = true;
      return r.value;
    });
    return { changed, value: changed ? out : value };
  }
  if (value && typeof value === "object") {
    let changed = false;
    const out = { ...value };
    for (const [k, v] of Object.entries(out)) {
      const r = repairMojibakeDeep(v);
      if (r.changed) {
        changed = true;
        out[k] = r.value;
      }
    }
    return { changed, value: changed ? out : value };
  }
  return { changed: false, value };
}

function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, Math.max(0, ms | 0));
}

function isBusyFsError(e) {
  const code = e && typeof e === "object" ? e.code : null;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

function withBusyRetry(fn, { attempts = 8, baseDelayMs = 15, maxDelayMs = 200 } = {}) {
  let delay = baseDelayMs;
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      if (!isBusyFsError(e) || i === attempts - 1) throw e;
      sleepSync(delay);
      delay = Math.min(maxDelayMs, Math.floor(delay * 1.7) + 1);
    }
  }
  throw lastErr;
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, value: null };
    let raw = withBusyRetry(() => fs.readFileSync(filePath, "utf8"));
    if (raw && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function writeJsonFile(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const json = JSON.stringify(value, null, 2) + "\n";
  withBusyRetry(() => fs.writeFileSync(tmpPath, json, "utf8"));
  try {
    withBusyRetry(() => fs.renameSync(tmpPath, filePath));
  } catch (e) {
    // Windows can be finicky if the target exists; fall back to replace.
    try {
      withBusyRetry(() => fs.rmSync(filePath, { force: true }));
      withBusyRetry(() => fs.renameSync(tmpPath, filePath));
    } catch {
      // Last resort: non-atomic write (still valid JSON, but may be torn if a process crashes mid-write).
      withBusyRetry(() => fs.writeFileSync(filePath, json, "utf8"));
      try {
        withBusyRetry(() => fs.rmSync(tmpPath, { force: true }));
      } catch {
        // ignore
      }
      // Preserve the original error context if needed.
      void e;
    }
  }
}

function normalizeRunDefaults(run) {
  if (!run || typeof run !== "object") return { changed: false, value: run };
  let changed = false;
  const r = { ...run };

  // Backfill dynamic prompt options for older runs (so prompts stay consistent after upgrades).
  if (typeof r.useChatGPT !== "boolean") {
    r.useChatGPT = false;
    changed = true;
  }
  if (typeof r.useGitHub !== "boolean") {
    r.useGitHub = false;
    changed = true;
  }
  if (typeof r.useLovable !== "boolean") {
    r.useLovable = false;
    changed = true;
  }
  if (typeof r.agCodexRatioDefault !== "boolean") {
    r.agCodexRatioDefault = true;
    changed = true;
  }
  if (typeof r.agCodexRatio !== "string") {
    r.agCodexRatio = "";
    changed = true;
  }

  // Corrector should default ON for robustness unless explicitly disabled.
  if (typeof r.enableCorrector !== "boolean") {
    r.enableCorrector = true;
    changed = true;
  }

  // Repair common mojibake for older runs (Windows console/codepage issues).
  // This matters for absolute paths (doc/TODO.md, logs, etc.) so the UI can read them reliably.
  const repaired = repairMojibakeDeep(r);
  if (repaired.changed) return { changed: true, value: repaired.value };

  return { changed, value: r };
}

class PipelineStateStore {
  constructor({ filePath }) {
    this._filePath = filePath;
    this._state = { ...DEFAULT_STATE };
    this._lastSaveError = null;
    this._load();
  }

  _load() {
    const r = readJsonFile(this._filePath);
    if (!r.ok) {
      try {
        const corruptPath = `${this._filePath}.corrupt-${Date.now()}`;
        fs.renameSync(this._filePath, corruptPath);
      } catch {
        // ignore
      }
      return;
    }
    const s = r.value;
    if (!s || typeof s !== "object") return;
    const runs = s.runs || {};
    let changed = false;
    const normalizedRuns = {};
    for (const [id, run] of Object.entries(runs)) {
      const n = normalizeRunDefaults(run);
      normalizedRuns[id] = n.value;
      if (n.changed) changed = true;
    }
    this._state = { ...DEFAULT_STATE, ...s, runs: normalizedRuns };
    if (changed) this.save();
  }

  save() {
    try {
      writeJsonFile(this._filePath, this._state);
      this._lastSaveError = null;
    } catch (e) {
      this._lastSaveError = e instanceof Error ? e.message : String(e);
      // eslint-disable-next-line no-console
      console.warn(`[PipelineStateStore] save failed (will retry later): ${this._lastSaveError}`);
    }
  }

  getRun(runId) {
    return this._state.runs[runId] || null;
  }

  setRun(runId, data) {
    this._state.runs[runId] = { ...data };
    this.save();
  }

  listRuns() {
    return Object.values(this._state.runs || {});
  }

  getLastSaveError() {
    return this._lastSaveError;
  }
}

module.exports = { PipelineStateStore };
