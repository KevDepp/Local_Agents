const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_STATE = {
  lastCwd: null,
  lastModel: null,
  lastEffort: "high",
  lastThreadId: null,
  recentThreads: [],
};

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeJsonFile(filePath, value) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

class StateStore {
  constructor({ filePath }) {
    this._filePath = filePath;
    this._state = { ...DEFAULT_STATE };
    this._load();
  }

  _load() {
    const s = readJsonFile(this._filePath);
    if (!s || typeof s !== "object") return;
    this._state = {
      ...DEFAULT_STATE,
      ...s,
      recentThreads: Array.isArray(s.recentThreads) ? s.recentThreads : [],
    };
  }

  getState() {
    return this._state;
  }

  save() {
    writeJsonFile(this._filePath, this._state);
  }

  setLastUsed({ cwd, model, effort, threadId }) {
    if (typeof cwd === "string") this._state.lastCwd = cwd;
    if (typeof model === "string" || model === null) this._state.lastModel = model;
    if (typeof effort === "string" && effort.trim()) this._state.lastEffort = effort.trim();
    if (typeof threadId === "string") this._state.lastThreadId = threadId;
    this.save();
  }

  setLastEffort(effort) {
    if (typeof effort !== "string" || !effort.trim()) return;
    this._state.lastEffort = effort.trim();
    this.save();
  }

  touchThread({ threadId, cwd, model }) {
    if (!threadId) return;
    const now = new Date().toISOString();
    const entry = {
      threadId,
      cwd: cwd || null,
      model: model || null,
      lastUsedAt: now,
    };

    const list = this._state.recentThreads.filter((t) => t && t.threadId !== threadId);
    list.unshift(entry);
    this._state.recentThreads = list.slice(0, 50);
    this._state.lastThreadId = threadId;
    if (cwd) this._state.lastCwd = cwd;
    if (model !== undefined) this._state.lastModel = model;
    this.save();
  }
}

module.exports = { StateStore };
