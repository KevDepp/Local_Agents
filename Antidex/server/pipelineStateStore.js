const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STATE = {
  runs: {},
};

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: true, value: null };
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function writeJsonFile(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

class PipelineStateStore {
  constructor({ filePath }) {
    this._filePath = filePath;
    this._state = { ...DEFAULT_STATE };
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
    this._state = { ...DEFAULT_STATE, ...s, runs: s.runs || {} };
  }

  save() {
    writeJsonFile(this._filePath, this._state);
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
}

module.exports = { PipelineStateStore };
