function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function setMeta(text) {
  $("metaLine").textContent = text;
}

function setText(id, text) {
  const el = $(id);
  const v = text || "(none)";
  el.textContent = v;
  el.title = v;
}

function getThreadMode() {
  const els = document.querySelectorAll("input[name='threadMode']");
  for (const el of els) {
    if (el.checked) return el.value;
  }
  return "new";
}

function updateThreadModeUI() {
  const mode = getThreadMode();
  const disabled = mode !== "resume";
  $("threadId").disabled = disabled;
  $("refreshThreads").disabled = disabled;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(line) {
  const parts = String(line).split("`");
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    const chunk = escapeHtml(parts[i]);
    if (i % 2 === 1) out += `<code>${chunk}</code>`;
    else out += chunk;
  }
  return out;
}

function renderMarkdownSimple(text) {
  const lines = String(text || "").split(/\r?\n/);
  let html = "";
  let inFence = false;
  let fence = [];
  let fenceLang = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        inFence = true;
        fenceLang = trimmed.slice(3).trim();
        fence = [];
      } else {
        const langAttr = fenceLang ? ` data-lang="${escapeHtml(fenceLang)}"` : "";
        html += `<pre><code${langAttr}>${escapeHtml(fence.join("\n"))}</code></pre>`;
        inFence = false;
        fenceLang = "";
        fence = [];
      }
      continue;
    }
    if (inFence) {
      fence.push(line);
      continue;
    }
    if (trimmed === "") {
      html += '<div class="md-gap"></div>';
      continue;
    }
    html += `<div class="md-line">${renderInline(line)}</div>`;
  }

  if (inFence) {
    html += `<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`;
  }

  return html;
}

function isAtBottom(el) {
  const threshold = 16;
  return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
}

let renderMode = "plain";
let outputText = "";

function renderOutput(shouldStickToBottom) {
  const out = $("output");
  if (renderMode === "markdown") {
    out.classList.add("markdown");
    out.innerHTML = renderMarkdownSimple(outputText);
  } else {
    out.classList.remove("markdown");
    out.textContent = outputText;
  }
  if (shouldStickToBottom) out.scrollTop = out.scrollHeight;
}

async function apiGet(path) {
  const r = await fetch(path, { headers: { "cache-control": "no-store" } });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function apiPost(path, body) {
  const r = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  if (!r.ok || !json?.ok) {
    const base = json?.error || `HTTP ${r.status}`;
    const hint = json?.hint ? ` (${json.hint})` : "";
    throw new Error(base + hint);
  }
  return json;
}

function fillModels(models) {
  const dl = $("modelsList");
  dl.innerHTML = "";
  for (const m of models) {
    const opt = document.createElement("option");
    opt.value = m;
    dl.appendChild(opt);
  }
}

function fillThreads(threads) {
  const sel = $("threadId");
  sel.innerHTML = "";
  for (const t of threads) {
    const opt = document.createElement("option");
    opt.value = t.threadId;
    const label = t.threadId + (t.cwd ? `  (${t.cwd})` : "");
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (!threads.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no saved threads yet)";
    sel.appendChild(opt);
  }
}

function setOutput(text) {
  outputText = text || "";
  renderOutput(true);
}

function appendOutput(delta) {
  const out = $("output");
  const stick = isAtBottom(out);
  outputText += delta;
  renderOutput(stick);
}

let activeSource = null;
let activeRunId = null;

function stopStream() {
  if (activeSource) {
    activeSource.close();
    activeSource = null;
  }
}

async function refreshThreads() {
  const r = await apiGet("/api/threads");
  fillThreads(r.threads || []);
}

async function refreshModels() {
  const r = await apiGet("/api/models");
  fillModels(r.models || []);
  setMeta(`Models: ${r.source}`);
}

async function refreshStatus() {
  const s = await apiGet("/api/status");
  if (!s?.codex?.ok) {
    const hint = s?.codex?.hint ? ` (${s.codex.hint})` : "";
    setMeta(`Codex missing${hint}`);
    return;
  }
  let msg = `Ready (codex: ${s.codex.source})`;
  if (s.cwdRestricted) msg += " | cwd restricted";
  setMeta(msg);
}

async function loadInitialState() {
  const r = await apiGet("/api/state");
  const s = r.state || {};
  if (s.lastCwd) $("cwd").value = s.lastCwd;
  if (s.lastModel) $("model").value = s.lastModel;
  else $("model").value = "gpt-5.2-codex";
  if (s.lastEffort) $("effort").value = s.lastEffort;
  else $("effort").value = "high";
  await refreshThreads();
  await refreshModels();
  await refreshStatus();
}

function setControlsRunning(running) {
  $("send").disabled = running;
  $("stop").disabled = !running;
}

async function sendPrompt() {
  stopStream();

  const prompt = $("prompt").value;
  const cwd = $("cwd").value;
  const model = $("model").value || null;
  const effort = $("effort").value || "high";
  const threadMode = getThreadMode();
  const threadId = $("threadId").value || null;

  setControlsRunning(true);
  setOutput("");
  setText("runId", "(starting...)");
  setText("threadIdOut", "(starting...)");
  setText("turnIdOut", "(starting...)");
  setText("logPath", "(starting...)");
  setText("rolloutPath", "(waiting...)");
  setMeta("Running...");

  let run;
  try {
    run = await apiPost("/api/run", { prompt, cwd, model, effort, threadMode, threadId });
  } catch (e) {
    setControlsRunning(false);
    setMeta(`Error: ${e?.message || String(e)}`);
    throw e;
  }

  activeRunId = run.runId;
  setText("runId", run.runId);
  setText("threadIdOut", run.threadId);
  setText("turnIdOut", run.turnId || "(pending)");
  setText("logPath", run.logPath || "(none)");

  activeSource = new EventSource(`/api/stream/${encodeURIComponent(run.runId)}`);

  activeSource.addEventListener("meta", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.threadId) setText("threadIdOut", data.threadId);
      if (data.turnId) setText("turnIdOut", data.turnId);
      if (data.logPath) setText("logPath", data.logPath);
    } catch {
      // ignore
    }
  });

  activeSource.addEventListener("delta", (ev) => {
    appendOutput(ev.data || "");
  });

  activeSource.addEventListener("diag", (ev) => {
    try {
      const data = JSON.parse(ev.data);
      const msg = data?.message ? String(data.message) : String(ev.data || "");
      if (msg) appendOutput(`\n\n[diag:${data?.type || "info"}]\n${msg}\n`);
    } catch {
      const msg = String(ev.data || "");
      if (msg) appendOutput(`\n\n[diag]\n${msg}\n`);
    }
  });

  activeSource.addEventListener("completed", async (ev) => {
    setControlsRunning(false);
    stopStream();
    try {
      const data = JSON.parse(ev.data);
      if (data.assistantText) {
        outputText = String(data.assistantText);
        renderOutput(true);
      } else if (data.status === "failed" && data.errorMessage) {
        outputText = `[error]\n${String(data.errorMessage)}\n`;
        renderOutput(true);
      }
      setMeta(`Completed (${data.status || "completed"})`);
      if (data.rolloutPath) setText("rolloutPath", data.rolloutPath);
      await refreshThreads();
    } catch {
      setMeta("Completed");
    }
  });

  activeSource.addEventListener("error", () => {
    setControlsRunning(false);
    stopStream();
    setMeta("Disconnected");
  });
}

async function stopRun() {
  if (!activeRunId) return;
  try {
    await apiPost("/api/stop", { runId: activeRunId });
  } catch {
    // ignore
  }
  stopStream();
  setControlsRunning(false);
  setMeta("Stopped");
}

async function setupCwdDialog() {
  const dlg = $("cwdDialog");
  const listEl = $("cwdList");
  const pathEl = $("cwdPath");

  dlg.addEventListener("click", (ev) => {
    if (ev.target === dlg) dlg.close();
  });

  $("cwdCancel").addEventListener("click", () => dlg.close());

  function renderList(dirs) {
    listEl.innerHTML = "";
    for (const d of dirs) {
      const div = document.createElement("div");
      div.className = "cwdItem";
      div.textContent = d.name;
      div.addEventListener("click", async () => {
        await loadDir(d.path);
      });
      listEl.appendChild(div);
    }
    if (!dirs.length) {
      const div = document.createElement("div");
      div.className = "cwdItem";
      div.textContent = "(no subfolders)";
      listEl.appendChild(div);
    }
  }

  async function loadDir(p) {
    const r = await apiGet(`/api/fs/list?path=${encodeURIComponent(p)}`);
    pathEl.value = r.path;
    renderList(r.dirs || []);
  }

  async function loadRoots() {
    const r = await apiGet("/api/fs/roots");
    listEl.innerHTML = "";
    for (const root of r.roots || []) {
      const div = document.createElement("div");
      div.className = "cwdItem";
      div.textContent = root.label;
      div.addEventListener("click", async () => {
        await loadDir(root.path);
      });
      listEl.appendChild(div);
    }
  }

  $("browseCwd").addEventListener("click", async () => {
    dlg.showModal();
    const current = $("cwd").value;
    if (current) {
      try {
        await loadDir(current);
        return;
      } catch {
        // ignore
      }
    }
    await loadRoots();
  });

  $("cwdUp").addEventListener("click", async () => {
    const cur = pathEl.value;
    if (!cur) return;
    const up = cur.replace(/[\\/]+$/, "").replace(/[\\/][^\\/]+$/, "");
    if (!up || up === cur) {
      await loadRoots();
      return;
    }
    try {
      await loadDir(up);
    } catch {
      await loadRoots();
    }
  });

  $("cwdSelect").addEventListener("click", () => {
    const p = pathEl.value;
    if (p) $("cwd").value = p;
    dlg.close();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await setupCwdDialog();

  for (const el of document.querySelectorAll("input[name='threadMode']")) {
    el.addEventListener("change", updateThreadModeUI);
  }

  for (const el of document.querySelectorAll("input[name='renderMode']")) {
    el.addEventListener("change", () => {
      const out = $("output");
      const stick = isAtBottom(out);
      renderMode = el.value;
      renderOutput(stick);
    });
  }

  $("refreshModels").addEventListener("click", refreshModels);
  $("refreshThreads").addEventListener("click", refreshThreads);

  $("send").addEventListener("click", async () => {
    try {
      await sendPrompt();
    } catch {
      // already surfaced in UI
    }
  });
  $("stop").addEventListener("click", stopRun);
  $("clear").addEventListener("click", () => setOutput(""));

  await loadInitialState();
  updateThreadModeUI();
});
