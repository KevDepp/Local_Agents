function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function setMeta(text) {
  $("meta").textContent = text || "";
}

function setStatus(text) {
  $("status").textContent = text || "";
}

function setRunId(runId) {
  $("runIdOut").textContent = runId || "(none)";
}

function setUserPrompt(text) {
  const el = $("userPrompt");
  el.value = text || "";
  try {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    // ignore
  }
}

let activeRunId = null;
let managerSource = null;
let developerSource = null;

function stopStreams() {
  if (managerSource) managerSource.close();
  if (developerSource) developerSource.close();
  managerSource = null;
  developerSource = null;
}

function setActiveRunId(runId) {
  activeRunId = runId || null;
  setRunId(activeRunId || "(none)");
}

function appendLog(id, text) {
  if (!text) return;
  const el = $(id);
  el.textContent += text;
  const maxLen = 200_000;
  if (el.textContent.length > maxLen) {
    el.textContent = el.textContent.slice(-maxLen);
  }
  el.scrollTop = el.scrollHeight;
}

function clearLogs() {
  $("logManager").textContent = "";
  $("logDeveloper").textContent = "";
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
    throw new Error(base);
  }
  return json;
}

function renderRun(run) {
  if (!run) {
    setStatus("(no run)");
    return;
  }
  const lines = [];
  lines.push(`runId: ${run.runId}`);
  lines.push(`status: ${run.status}`);
  if (run.projectPhase) lines.push(`phase: ${run.projectPhase}`);
  lines.push(`iteration: ${run.iteration}`);
  if (run.currentTaskId) lines.push(`currentTaskId: ${run.currentTaskId}`);
  if (run.assignedDeveloper) lines.push(`assignedDeveloper: ${run.assignedDeveloper}`);
  lines.push(`developerStatus: ${run.developerStatus || "(none)"}`);
  lines.push(`managerDecision: ${run.managerDecision || "(none)"}`);
  lines.push(`cwd: ${run.cwd}`);
  lines.push(`managerModel: ${run.managerModel}`);
  lines.push(`developerModel: ${run.developerModel}`);
  lines.push(`managerThreadId: ${run.managerThreadId || "(none)"}`);
  lines.push(`developerThreadId: ${run.developerThreadId || "(none)"}`);
  if (run.lastError) {
    const msg = run.lastError.message || "(unknown error)";
    lines.push(`lastError: ${msg}`);
  }
  if (run.lastSummary) {
    lines.push("lastSummary:");
    lines.push(String(run.lastSummary));
  }
  setStatus(lines.join("\n"));
}

function openStreams(runId) {
  stopStreams();
  if (!runId) return;

  const managerUrl = `/api/pipeline/stream/${encodeURIComponent(runId)}?role=manager`;
  const developerUrl = `/api/pipeline/stream/${encodeURIComponent(runId)}?role=developer`;

  managerSource = new EventSource(managerUrl);
  developerSource = new EventSource(developerUrl);

  const onDelta = (role, ev) => {
    try {
      const data = JSON.parse(ev.data);
      appendLog(role === "manager" ? "logManager" : "logDeveloper", data.delta || "");
    } catch {
      appendLog(role === "manager" ? "logManager" : "logDeveloper", ev.data || "");
    }
  };

  const onCompleted = (role, ev) => {
    try {
      const data = JSON.parse(ev.data);
      if (data.assistantText) {
        appendLog(role === "manager" ? "logManager" : "logDeveloper", data.assistantText);
        appendLog(role === "manager" ? "logManager" : "logDeveloper", "\n");
      }
      if (data.errorMessage) {
        appendLog(role === "manager" ? "logManager" : "logDeveloper", `\n[error]\n${data.errorMessage}\n`);
      }
    } catch {
      // ignore
    }
  };

  const onDiag = (role, ev) => {
    try {
      const data = JSON.parse(ev.data);
      const msg = data?.message ? String(data.message) : String(ev.data || "");
      if (msg) appendLog(role === "manager" ? "logManager" : "logDeveloper", `\n[diag]\n${msg}\n`);
    } catch {
      // ignore
    }
  };

  managerSource.addEventListener("delta", (ev) => onDelta("manager", ev));
  developerSource.addEventListener("delta", (ev) => onDelta("developer", ev));
  managerSource.addEventListener("completed", (ev) => onCompleted("manager", ev));
  developerSource.addEventListener("completed", (ev) => onCompleted("developer", ev));
  managerSource.addEventListener("diag", (ev) => onDiag("manager", ev));
  developerSource.addEventListener("diag", (ev) => onDiag("developer", ev));
}

function fillRunSelect(runs) {
  const sel = $("runSelect");
  sel.innerHTML = "";
  for (const r of runs || []) {
    const opt = document.createElement("option");
    opt.value = r.runId;
    const label = `${r.runId} (${r.status || "unknown"})`;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  if (!runs || !runs.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "(no runs)";
    sel.appendChild(opt);
  }
}

async function refreshRuns() {
  const r = await apiGet("/api/pipeline/runs");
  fillRunSelect(r.runs || []);
}

async function loadRun(runId) {
  if (!runId) return;
  const r = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
  setActiveRunId(runId);
  renderRun(r.run);
  openStreams(runId);
}

async function startPipeline() {
  const cwd = $("cwd").value.trim();
  const userPrompt = $("userPrompt").value.trim();
  const managerModel = $("managerModel").value.trim() || "gpt-5.1";
  const developerModel = $("developerModel").value.trim() || "gpt-5.2-codex";
  const managerPreprompt = $("managerPre").value.trim();
  const developerPreprompt = $("developerPre").value.trim();

  try {
    setMeta("Starting pipeline…");
    const resp = await apiPost("/api/pipeline/start", {
      cwd,
      userPrompt,
      managerModel,
      developerModel,
      managerPreprompt,
      developerPreprompt,
    });
    const run = resp.run;
    setActiveRunId(run.runId);
    renderRun(run);
    clearLogs();
    openStreams(run.runId);
    await refreshRuns();
    setMeta("Pipeline started (phase planning + implementing)");
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

async function continuePipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to continue");
    return;
  }
  try {
    setMeta("Continuing pipeline…");
    const resp = await apiPost("/api/pipeline/continue", { runId });
    renderRun(resp.run);
    openStreams(runId);
    setMeta("Pipeline step done");
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

async function stopPipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to stop");
    return;
  }
  try {
    setMeta("Stopping pipeline…");
    await apiPost("/api/pipeline/stop", { runId });
    const r = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    renderRun(r.run);
    setMeta("Pipeline stopped");
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

async function loadArtifact(name) {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId selected");
    return;
  }
  try {
    setMeta(`Loading ${name}…`);
    const r = await apiGet(
      `/api/pipeline/file?runId=${encodeURIComponent(runId)}&name=${encodeURIComponent(name)}`,
    );
    if (!r.exists) {
      $("artifactContent").textContent = `(missing) ${r.path}`;
      setMeta("File not found");
      return;
    }
    let text = r.content || "";
    if (r.isJson) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // ignore
      }
    }
    $("artifactContent").textContent = text;
    setMeta(`Loaded ${name}`);
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
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
      div.textContent = d.name || d.label || d.path;
      div.addEventListener("click", async () => {
        if (d.path) await loadDir(d.path);
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
    const roots = (r.roots || []).map((root) => ({ name: root.label, path: root.path }));
    renderList(roots);
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
  $("start").addEventListener("click", startPipeline);
  $("continue").addEventListener("click", continuePipeline);
  $("stop").addEventListener("click", stopPipeline);
  $("openLogs").addEventListener("click", () => {
    window.open("/logs.html", "_blank", "noopener");
  });
  await setupCwdDialog();
  $("refreshRuns").addEventListener("click", refreshRuns);
  $("loadRun").addEventListener("click", async () => {
    const runId = $("runSelect").value;
    if (runId) await loadRun(runId);
  });
  $("loadSpec").addEventListener("click", () => loadArtifact("spec"));
  $("loadTodo").addEventListener("click", () => loadArtifact("todo"));
  $("loadTesting").addEventListener("click", () => loadArtifact("testing"));
  $("loadProjectState").addEventListener("click", () => loadArtifact("projectState"));
  $("loadTask").addEventListener("click", () => loadArtifact("task"));
  $("loadTaskResult").addEventListener("click", () => loadArtifact("taskResult"));
  $("loadTaskReview").addEventListener("click", () => loadArtifact("taskReview"));

  // Pré-remplir un pré-prompt manager raisonnable
  $("managerPre").value =
    "Tu es un architecte logiciel / chef de projet. Tu clarifies la demande utilisateur et tu mets en place la documentation de travail du projet. Lis doc/DOCS_RULES.md + doc/INDEX.md, puis rédige/actualise doc/SPEC.md, doc/TODO.md (priorisée P0/P1/P2 + ordre 1,2,3), et doc/TESTING_PLAN.md. Tu ne modifies pas le code, tu prépares le travail pour un agent développeur séparé. Le pipeline attend aussi un marqueur JSON valide dans data/pipeline_state.json.";

  // Pré-remplir un pré-prompt développeur (optionnel)
  $("developerPre").value =
    "Tu es le développeur principal. Lis doc/INDEX.md puis doc/SPEC.md, doc/TODO.md et doc/TESTING_PLAN.md. Implémente d'abord les P0, ajoute des tests, et mets à jour la documentation si besoin (TODO/SPEC/DECISIONS + INDEX). À la fin, mets developer_status=ready_for_review dans data/pipeline_state.json avec un résumé et les résultats de tests.";

  try {
    const status = await apiGet("/api/status");
    if (!status?.codex?.ok) {
      setMeta(`Codex missing: ${status?.codex?.hint || "unknown"}`);
    } else {
      setMeta(`Ready (codex: ${status.codex.source})`);
    }
  } catch {
    setMeta("Ready.");
  }
  await refreshRuns();

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has("prompt_b64")) {
      const b64 = params.get("prompt_b64") || "";
      const decoded = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
      setUserPrompt(decoded);
    } else if (params.has("prompt")) {
      setUserPrompt(params.get("prompt") || "");
    }

    if (params.get("autostart") === "1") {
      setMeta("Autostart…");
      setTimeout(() => {
        void startPipeline();
      }, 0);
    }
  } catch {
    // ignore
  }
});

// For automation tools
window.setUserPrompt = (text, autoStart) => {
  setUserPrompt(text);
  if (autoStart) void startPipeline();
};

