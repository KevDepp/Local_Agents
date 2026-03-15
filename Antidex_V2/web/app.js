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

function setSummaryText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "-";
}

function classifyActiveAgent(role) {
  const r = String(role || "").toLowerCase();
  if (r === "manager") return { label: "Manager", cls: "manager" };
  if (r === "developer" || r === "developer_codex") return { label: "Dev Codex", cls: "codex" };
  if (r === "developer_antigravity" || r === "ag") return { label: "Dev AG", cls: "ag" };
  if (r === "monitor") return { label: "Monitor", cls: "codex" };
  if (!r) return { label: "-", cls: "" };
  return { label: role, cls: "" };
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
let activeRunCwd = null;
let managerSource = null;
let developerSource = null;
let agSource = null;
let todoProgressTimer = null;
let tasksTimer = null;
let statePollTimer = null;
let jobPollTimer = null;
let lastAgentActivity = { role: null, step: null, atMs: 0 };
let lastLoadedTodo = { content: "", mtimeMs: null, path: null };
let lastDiskTodo = { content: "", mtimeMs: null };
let lastRenderedRunFp = null;
let lastSseActivityAtMs = 0;
let stateFetchInFlight = false;
let lastSeen = {
  manager: { role: null, step: null, atMs: 0 },
  developer: { role: null, step: null, atMs: 0 },
  ag: { role: null, step: null, atMs: 0 },
};

function stopStreams() {
  if (managerSource) managerSource.close();
  if (developerSource) developerSource.close();
  if (agSource) agSource.close();
  managerSource = null;
  developerSource = null;
  agSource = null;
  if (todoProgressTimer) clearInterval(todoProgressTimer);
  todoProgressTimer = null;
  if (tasksTimer) clearInterval(tasksTimer);
  tasksTimer = null;
  if (statePollTimer) clearInterval(statePollTimer);
  statePollTimer = null;
  if (jobPollTimer) clearInterval(jobPollTimer);
  jobPollTimer = null;
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
  $("logAg").textContent = "";
}

function openTodoEditor(runId) {
  const rid = String(runId || "").trim();
  if (!rid) {
    setMeta("No runId selected");
    return;
  }
  const w = window.open(`/todo_edit.html?runId=${encodeURIComponent(rid)}`, "_blank", "noopener");
  if (!w) setMeta("Popup blocked: allow popups to edit TODO");
}

function buildThreadPolicyFromUi() {
  const codex = document.getElementById("threadPolicyCodex")?.value || "reuse";
  const ag = document.getElementById("threadPolicyAg")?.value || "reuse";
  return { manager: "reuse", developer_codex: codex, developer_antigravity: ag };
}

function unifiedLineDiff(a, b) {
  const A = String(a || "").split(/\r?\n/);
  const B = String(b || "").split(/\r?\n/);
  const out = [];

  // Simple LCS-based diff (good enough for TODO.md sized files)
  const n = A.length;
  const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push(` ${A[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`-${A[i]}`);
      i += 1;
    } else {
      out.push(`+${B[j]}`);
      j += 1;
    }
  }
  while (i < n) {
    out.push(`-${A[i]}`);
    i += 1;
  }
  while (j < m) {
    out.push(`+${B[j]}`);
    j += 1;
  }

  return out.join("\n");
}

async function apiGet(path, { timeoutMs = 15_000 } = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const r = await fetch(path, {
      headers: { "cache-control": "no-store" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!r.ok) throw new Error(await r.text());
    return await r.json();
  } catch (e) {
    const msg = e?.name === "AbortError" ? `Request timeout after ${timeoutMs}ms: ${path}` : e?.message || String(e);
    throw new Error(msg);
  } finally {
    if (timer) clearTimeout(timer);
  }
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

let lastRenderedJobId = null;
let lastJobTailStream = "stdout";

function setJobMeta(text) {
  const el = document.getElementById("jobMeta");
  if (el) el.textContent = text || "";
}

function setJobText(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text || "";
}

function setJobButtonsState({ hasJob, hasActive } = {}) {
  const enable = (id, yes) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !yes;
  };
  enable("jobRefresh", Boolean(hasJob));
  enable("jobTailStdout", Boolean(hasJob));
  enable("jobTailStderr", Boolean(hasJob));
  enable("jobMonitorNow", Boolean(hasActive));
  enable("jobRestart", Boolean(hasActive));
  enable("jobStop", Boolean(hasActive));
}

function describePipelineJobRelation(pipeline, hasActive) {
  const status = pipeline?.status ? String(pipeline.status) : "";
  if (!status) return "";
  if (status === "stopped" && hasActive) return "pipeline=stopped, long_job=running";
  if (status === "paused" && hasActive) return "pipeline=paused, long_job=running";
  return `pipeline=${status}`;
}

async function refreshJobDetails({ tailStream } = {}) {
  const runId = activeRunId;
  if (!runId) return;
  const stream = tailStream || lastJobTailStream || "stdout";
  lastJobTailStream = stream;
  try {
    const st = await apiGet(`/api/jobs/state?runId=${encodeURIComponent(runId)}`, { timeoutMs: 12_000 });
    const active = st?.active || null;
    const latest = active || st?.latest || null;
    if (!latest) {
      setJobMeta("No active job");
      setJobButtonsState({ hasJob: false, hasActive: false });
      setJobText("jobMonitorMd", "");
      setJobText("jobLogTail", "");
      lastRenderedJobId = null;
      return;
    }
    const hasActive = Boolean(active);
    const parts = [];
    parts.push(`${hasActive ? "jobId" : "lastJob"}=${latest.jobId}`);
    parts.push(`status=${latest.status || (hasActive ? "running" : "unknown")}`);
    const relation = describePipelineJobRelation(st?.pipeline, hasActive);
    if (relation) parts.push(relation);
    if (latest.pid != null) parts.push(`pid=${latest.pid}${latest.pidAlive === true ? " (alive)" : latest.pidAlive === false ? " (dead)" : ""}`);
    if (latest.startedAt) parts.push(`started=${latest.startedAt}`);
    if (latest.stoppedAt) parts.push(`stopped=${latest.stoppedAt}`);
    if (latest.lastMonitorAtIso) parts.push(`lastMonitor=${latest.lastMonitorAtIso}`);
    if (st?.taskHistory?.markdown) parts.push(`history=${st.taskHistory.markdown}`);
    if (!hasActive) parts.push("active=no");
    setJobMeta(parts.join(" | "));
    setJobButtonsState({ hasJob: true, hasActive });
    lastRenderedJobId = latest.jobId;

    if (typeof st.monitor_md === "string" && st.monitor_md.trim()) setJobText("jobMonitorMd", st.monitor_md);
    else if (st.monitor && typeof st.monitor.summary === "string") setJobText("jobMonitorMd", `summary: ${st.monitor.summary}`);
    else setJobText("jobMonitorMd", "(no monitor report yet)");

    const tail = await apiGet(
      `/api/jobs/tail?runId=${encodeURIComponent(runId)}&stream=${encodeURIComponent(stream)}&bytes=${encodeURIComponent(120000)}`,
      { timeoutMs: 12_000 },
    );
    const prefix = stream === "stderr" ? "[stderr]" : "[stdout]";
    setJobText("jobLogTail", `${prefix} ${tail?.path || ""}\n\n${tail?.text || ""}`);
  } catch (e) {
    setJobMeta(`Job refresh error: ${e?.message || String(e)}`);
  }
}

function renderJobPanelFromRun(run) {
  const active = run?.activeJob;
  const lastJobId = run?.lastJobId || null;
  if (!active || !active.jobId) {
    if (lastJobId) {
      const relation = describePipelineJobRelation(run, false);
      setJobMeta(`lastJob=${lastJobId}${relation ? ` | ${relation}` : ""} | refreshing...`);
      setJobButtonsState({ hasJob: true, hasActive: false });
      if (lastRenderedJobId !== lastJobId) {
        lastRenderedJobId = lastJobId;
        void refreshJobDetails();
      }
      return;
    }
    setJobMeta("No active job");
    setJobButtonsState({ hasJob: false, hasActive: false });
    if (lastRenderedJobId) {
      setJobText("jobMonitorMd", "");
      setJobText("jobLogTail", "");
    }
    lastRenderedJobId = null;
    return;
  }
  lastRenderedJobId = active.jobId;
  const parts = [];
  parts.push(`jobId=${active.jobId}`);
  parts.push(`status=${active.status}`);
  const relation = describePipelineJobRelation(run, true);
  if (relation) parts.push(relation);
  if (active.pid != null) parts.push(`pid=${active.pid}${active.pidAlive ? " (alive)" : " (dead)"}`);
  if (active.lastMonitorDecision) parts.push(`monitor=${active.lastMonitorDecision}`);
  if (active.lastMonitorAtIso) parts.push(`last=${active.lastMonitorAtIso}`);
  setJobMeta(parts.join(" | "));
  setJobButtonsState({ hasJob: true, hasActive: true });
  if (active.lastMonitorSummary) setJobText("jobMonitorMd", `summary: ${active.lastMonitorSummary}`);
}

function startJobPolling() {
  if (jobPollTimer) clearInterval(jobPollTimer);
  jobPollTimer = setInterval(() => {
    if (!activeRunId) return;
    if (!lastRenderedJobId) return;
    // Lightweight: refresh only when a job is active (UI already has the badge summary).
    // We still call the endpoint; it returns active=null quickly when no job exists.
    void refreshJobDetails();
  }, 60_000);
}

async function refreshRunState() {
  const current = activeRunId;
  if (!current) return;
  if (stateFetchInFlight) return;
  stateFetchInFlight = true;
  try {
    const st = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(current)}`, { timeoutMs: 8_000 });
    if (st && st.run) renderRun(st.run);
  } catch {
    // ignore (SSE may still be live)
  } finally {
    stateFetchInFlight = false;
  }
}

function renderRun(run) {
  if (!run) {
    setStatus("(no run)");
    setSummaryText("badgeStatus", "status: -");
    setSummaryText("badgePhase", "phase: -");
    setSummaryText("badgeIteration", "iteration: -");
    setSummaryText("badgeActiveAgent", "active: -");
    setSummaryText("badgeActiveStep", "step: -");
    setSummaryText("todoProgressText", "TODO: -");
    setSummaryText("currentTaskText", "task: -");
    return;
  }
  const fp = JSON.stringify({
    runId: run.runId,
    status: run.status,
    projectPhase: run.projectPhase || null,
    iteration: run.iteration,
    currentTaskId: run.currentTaskId || null,
    assignedDeveloper: run.assignedDeveloper || null,
    developerStatus: run.developerStatus || null,
    managerDecision: run.managerDecision || null,
    cwd: run.cwd || null,
    workspaceCwd: run.workspaceCwd || null,
    managerModel: run.managerModel || null,
    developerModel: run.developerModel || null,
    activeTurn: run.activeTurn ? { role: run.activeTurn.role || null, step: run.activeTurn.step || null } : null,
    lastError: run.lastError ? { where: run.lastError.where || null, message: run.lastError.message || null } : null,
    lastSummary: run.lastSummary || null,
    lastJobId: run.lastJobId || null,
    activeJob: run.activeJob
      ? {
          jobId: run.activeJob.jobId || null,
          status: run.activeJob.status || null,
          pid: run.activeJob.pid ?? null,
          pidAlive: run.activeJob.pidAlive ?? null,
          lastMonitorAtIso: run.activeJob.lastMonitorAtIso || null,
          lastMonitorDecision: run.activeJob.lastMonitorDecision || null,
          lastMonitorSummary: run.activeJob.lastMonitorSummary || null,
        }
      : null,
    useChatGPT: typeof run.useChatGPT === "boolean" ? run.useChatGPT : null,
    useGitHub: typeof run.useGitHub === "boolean" ? run.useGitHub : null,
    useLovable: typeof run.useLovable === "boolean" ? run.useLovable : null,
    agCodexRatioDefault: typeof run.agCodexRatioDefault === "boolean" ? run.agCodexRatioDefault : null,
    agCodexRatio: run.agCodexRatio || null,
  });
  if (fp === lastRenderedRunFp) return;
  lastRenderedRunFp = fp;

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
  activeRunCwd = run.cwd || null;
  if (run.workspaceCwd) lines.push(`workspaceCwd: ${run.workspaceCwd}`);
  lines.push(`managerModel: ${run.managerModel}`);
  lines.push(`developerModel: ${run.developerModel}`);
  if (typeof run.useChatGPT === "boolean") lines.push(`useChatGPT: ${run.useChatGPT}`);
  if (typeof run.useGitHub === "boolean") lines.push(`useGitHub: ${run.useGitHub}`);
  if (typeof run.useLovable === "boolean") lines.push(`useLovable: ${run.useLovable}`);
  if (typeof run.agCodexRatioDefault === "boolean") lines.push(`agCodexRatioDefault: ${run.agCodexRatioDefault}`);
  if (run.agCodexRatio) lines.push(`agCodexRatio: ${run.agCodexRatio}`);
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

  // Summary badges (header)
  setSummaryText("badgeStatus", `status: ${run.status || "-"}`);
  setSummaryText("badgePhase", `phase: ${run.projectPhase || run.status || "-"}`);
  setSummaryText("badgeIteration", `iteration: ${run.iteration ?? "-"}`);

  const terminal = run.status === "completed" || run.status === "failed" || run.status === "stopped" || run.status === "canceled";
  const activeRole = (() => {
    if (run.activeTurn?.role) return run.activeTurn.role;
    if (run.status === "waiting_job") return null;
    if (run.status === "planning" || run.status === "reviewing") return "manager";
    if (run.status === "implementing") return run.assignedDeveloper || "developer";
    return null;
  })();
  const activeStep = run.activeTurn?.step || (terminal ? "-" : lastAgentActivity.step) || "-";
  const agent = classifyActiveAgent(activeRole);

  const badge = document.getElementById("badgeActiveAgent");
  if (badge) {
    const extras = [];
    const now = Date.now();
    const RECENT_MS = 5 * 60_000;
    if (lastSeen.developer?.atMs && now - lastSeen.developer.atMs <= RECENT_MS) extras.push("last dev: Dev Codex");
    if (lastSeen.ag?.atMs && now - lastSeen.ag.atMs <= RECENT_MS) extras.push("last ag: Dev AG");
    const activeLabel = terminal || run.status === "paused" ? "-" : agent.label;
    badge.textContent = `active: ${activeLabel}${extras.length ? " | " + extras.join(" | ") : ""}`;
    badge.classList.remove("manager", "codex", "ag");
    if (agent.cls) badge.classList.add(agent.cls);
  }
  setSummaryText("badgeActiveStep", `step: ${activeStep || "-"}`);
  setSummaryText("currentTaskText", `task: ${run.currentTaskId || "-"}`);

  // Long job panel (best-effort; does not throw if elements are missing)
  try {
    renderJobPanelFromRun(run);
  } catch {
    // ignore
  }

  // Controls UX
  try {
    const cont = document.getElementById("continue");
    const resumeBtn = document.getElementById("resume");
    const pauseBtn = document.getElementById("pause");
    const stopBtn = document.getElementById("stop");
    const cancelBtn = document.getElementById("cancel");

    const isPaused = run.status === "paused";
    if (cont) cont.style.display = isPaused ? "none" : "";
    if (resumeBtn) resumeBtn.style.display = isPaused ? "" : "none";
    if (pauseBtn) pauseBtn.disabled = run.status === "paused" || run.status === "stopped" || run.status === "completed" || run.status === "canceled";
    if (stopBtn) stopBtn.disabled = run.status === "stopped" || run.status === "completed" || run.status === "canceled";
    if (cancelBtn) cancelBtn.disabled = run.status === "completed" || run.status === "canceled";
    if (cont) cont.disabled = run.status === "canceled";
    if (resumeBtn) resumeBtn.disabled = run.status !== "paused";
  } catch {
    // ignore
  }

  // Keep UI controls aligned with the loaded run (best-effort; don't throw if missing).
  try {
    if (document.getElementById("useChatGPT") && typeof run.useChatGPT === "boolean") $("useChatGPT").checked = run.useChatGPT;
    if (document.getElementById("useGitHub") && typeof run.useGitHub === "boolean") $("useGitHub").checked = run.useGitHub;
    if (document.getElementById("useLovable") && typeof run.useLovable === "boolean") $("useLovable").checked = run.useLovable;
    if (document.getElementById("agCodexRatioDefault") && typeof run.agCodexRatioDefault === "boolean") $("agCodexRatioDefault").checked = run.agCodexRatioDefault;
    if (document.getElementById("agCodexRatio") && typeof run.agCodexRatio === "string") $("agCodexRatio").value = run.agCodexRatio;
  } catch {
    // ignore
  }
}

function parseTodoProgress(markdown) {
  const text = String(markdown || "");
  const lines = text.split(/\r?\n/);
  let total = 0;
  let done = 0;
  for (const line of lines) {
    // Ignorer la ligne d'exemple de formatage laissée par défaut par le Manager
    if (line.includes("P0 (Owner)") && line.includes("Task (proof:")) continue;

    // Support common TODO checkbox formats:
    // - [ ] item
    // 1. [ ] item
    // [ ] item
    const m =
      line.match(/^\s*(?:[-*]|\d+\.)\s*\[(x|X| )\]\s+/) ||
      line.match(/^\s*\[(x|X| )\]\s+/);
    if (!m) continue;
    total += 1;
    if (String(m[1]).toLowerCase() === "x") done += 1;
  }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

function extractTodoTaskOrder(markdown) {
  const text = String(markdown || "");
  // Examples: T-011_rework_rules_engine_v2, T-002b_integrate_rules_into_spec
  const re = /\bT-\d{3}[A-Za-z0-9]*[A-Za-z0-9_]*\b/g;
  const order = new Map();
  let i = 0;
  for (;;) {
    const m = re.exec(text);
    if (!m) break;
    const id = String(m[0] || "").trim();
    if (!id) continue;
    if (!order.has(id)) order.set(id, i++);
  }
  return order;
}

async function refreshTodoProgress() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") return;
  try {
    const r = await apiGet(`/api/pipeline/file?runId=${encodeURIComponent(runId)}&name=todo`);
    const content = r?.content || "";
    const { done, total, pct } = parseTodoProgress(content);
    const bar = document.getElementById("todoProgressBar");
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    setSummaryText("todoProgressText", total ? `TODO: ${done}/${total} (${pct}%)` : "TODO: -");
  } catch {
    const bar = document.getElementById("todoProgressBar");
    if (bar) bar.style.width = "0%";
    setSummaryText("todoProgressText", "TODO: -");
  }
}

function openStreams(runId) {
  stopStreams();
  if (!runId) return;

  const markSse = () => {
    lastSseActivityAtMs = Date.now();
  };
  markSse();

  const managerUrl = `/api/pipeline/stream/${encodeURIComponent(runId)}?role=manager`;
  const developerUrl = `/api/pipeline/stream/${encodeURIComponent(runId)}?role=developer`;
  const agUrl = `/api/pipeline/stream/${encodeURIComponent(runId)}?role=developer_antigravity`;

  managerSource = new EventSource(managerUrl);
  developerSource = new EventSource(developerUrl);
  agSource = new EventSource(agUrl);

  const onDelta = (role, ev) => {
    markSse();
    try {
      const data = JSON.parse(ev.data);
      if (role === "manager") appendLog("logManager", data.delta || "");
      else if (role === "developer") appendLog("logDeveloper", data.delta || "");
      else appendLog("logAg", data.delta || "");
    } catch {
      if (role === "manager") appendLog("logManager", ev.data || "");
      else if (role === "developer") appendLog("logDeveloper", ev.data || "");
      else appendLog("logAg", ev.data || "");
    }
  };

  const onCompleted = (role, ev) => {
    markSse();
    try {
      const data = JSON.parse(ev.data);
      if (data.assistantText) {
        if (role === "manager") appendLog("logManager", data.assistantText);
        else if (role === "developer") appendLog("logDeveloper", data.assistantText);
        else appendLog("logAg", data.assistantText);
        if (role === "manager") appendLog("logManager", "\n");
        else if (role === "developer") appendLog("logDeveloper", "\n");
        else appendLog("logAg", "\n");
      }
      if (data.errorMessage) {
        if (role === "manager") appendLog("logManager", `\n[error]\n${data.errorMessage}\n`);
        else if (role === "developer") appendLog("logDeveloper", `\n[error]\n${data.errorMessage}\n`);
        else appendLog("logAg", `\n[error]\n${data.errorMessage}\n`);
      }
    } catch {
      // ignore
    }
  };

  const onDiag = (role, ev) => {
    markSse();
    try {
      const data = JSON.parse(ev.data);
      const msg = data?.message ? String(data.message) : String(ev.data || "");
      if (!msg) return;
      if (role === "manager") appendLog("logManager", `\n[diag]\n${msg}\n`);
      else if (role === "developer") appendLog("logDeveloper", `\n[diag]\n${msg}\n`);
      else appendLog("logAg", `\n[diag]\n${msg}\n`);
    } catch {
      // ignore
    }
  };

  managerSource.addEventListener("delta", (ev) => onDelta("manager", ev));
  developerSource.addEventListener("delta", (ev) => onDelta("developer", ev));
  agSource.addEventListener("delta", (ev) => onDelta("ag", ev));
  managerSource.addEventListener("completed", (ev) => onCompleted("manager", ev));
  developerSource.addEventListener("completed", (ev) => onCompleted("developer", ev));
  agSource.addEventListener("completed", (ev) => onCompleted("ag", ev));
  managerSource.addEventListener("diag", (ev) => onDiag("manager", ev));
  developerSource.addEventListener("diag", (ev) => onDiag("developer", ev));
  agSource.addEventListener("diag", (ev) => onDiag("ag", ev));

  const onRun = (ev) => {
    markSse();
    try {
      const data = JSON.parse(ev.data);
      if (data && typeof data === "object" && data.runId) renderRun(data);
    } catch {
      // ignore
    }
  };

  const onMeta = (role, ev) => {
    markSse();
    try {
      const data = JSON.parse(ev.data);
      const roleName = data?.role || role;
      const stepName = data?.step || "?";
      lastAgentActivity = { role: roleName, step: stepName, atMs: Date.now() };
      const rk = (() => {
        const r = String(roleName || "").toLowerCase();
        if (r === "manager") return "manager";
        if (r === "developer_antigravity" || r === "ag") return "ag";
        if (r.startsWith("developer")) return "developer";
        return "manager";
      })();
      lastSeen[rk] = { role: roleName, step: stepName, atMs: Date.now() };
      const msg = data
        ? `[meta] ${data.role || role}/${data.step || "?"} model=${data.model || "?"} thread=${data.threadId || "?"} turn=${data.turnId || "?"}`
        : "[meta]";
      if (role === "manager") appendLog("logManager", `\n${msg}\n`);
      else if (role === "developer") appendLog("logDeveloper", `\n${msg}\n`);
      else appendLog("logAg", `\n${msg}\n`);
    } catch {
      // ignore
    }
  };

  managerSource.addEventListener("run", onRun);
  developerSource.addEventListener("run", onRun);
  agSource.addEventListener("run", onRun);
  managerSource.addEventListener("meta", (ev) => onMeta("manager", ev));
  developerSource.addEventListener("meta", (ev) => onMeta("developer", ev));
  agSource.addEventListener("meta", (ev) => onMeta("ag", ev));

  // Keep global progress visible (TODO.md is user-editable)
  void refreshTodoProgress();
  todoProgressTimer = setInterval(() => {
    if (document.hidden) return;
    void refreshTodoProgress();
  }, 15000);

  void tasksReload();
  tasksTimer = setInterval(() => {
    if (document.hidden) return;
    void tasksReload();
    void todoCheckDisk();
  }, 20000);

  // Backstop polling: EventSource can silently disconnect on long runs.
  void refreshRunState();
  statePollTimer = setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    const sources = [managerSource, developerSource, agSource].filter(Boolean);
    const anyOpen = sources.some((s) => s && s.readyState === 1);
    const recentlySse = lastSseActivityAtMs && now - lastSseActivityAtMs < 20_000;
    if (anyOpen && recentlySse) return;
    void refreshRunState();
  }, 15000);
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
  try {
    const r = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    setActiveRunId(runId);
    renderRun(r.run);
    startJobPolling();
    void refreshJobDetails();

    // Load TODO/tasks even if SSE fails (EventSource can be blocked/unsupported in some environments).
    await todoReload();
    await tasksReload();

    // UX: "Load selected" lives below the TODO panel; bring the TODO into view so users can confirm it loaded.
    try {
      const editor = document.getElementById("todoEditor");
      const text = editor?.value || "";
      if (editor && text.trim().length) {
        editor.scrollIntoView({ behavior: "smooth", block: "center" });
        try {
          editor.focus({ preventScroll: true });
        } catch {
          editor.focus();
        }
        setMeta(`Loaded runId=${runId} (TODO loaded: ${text.length} chars)`);
      } else {
        setMeta(`Loaded runId=${runId} (TODO empty)`);
      }
    } catch {
      setMeta(`Loaded runId=${runId}`);
    }

    try {
      openStreams(runId);
    } catch (e) {
      const msg = e?.message ? String(e.message) : String(e);
      setMeta(`Loaded runId=${runId}, but live streams failed: ${msg}`);
    }
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    setMeta(`Error: ${msg}`);
  }
}

async function startPipeline() {
  const cwd = $("cwd").value.trim();
  const userPrompt = $("userPrompt").value.trim();
  const managerModel = $("managerModel").value.trim() || "gpt-5.4";
  const developerModel = $("developerModel").value.trim() || "gpt-5.4";
  const managerPreprompt = $("managerPre").value.trim();
  const developerPreprompt = $("developerPre").value.trim();
  const createProjectDir = !!$("createProjectDir")?.checked;
  const projectDirName = ($("projectDirName")?.value || "").trim();
  const connectorBaseUrl = ($("connectorBaseUrl")?.value || "").trim();
  const connectorNotify = !!$("connectorNotify")?.checked;
  const connectorDebug = !!$("connectorDebug")?.checked;
  const enableCorrector = $("enableCorrector") ? !!$("enableCorrector").checked : true;
  const threadPolicy = buildThreadPolicyFromUi();
  const useChatGPT = $("useChatGPT") ? $("useChatGPT").checked === true : false;
  const useGitHub = $("useGitHub") ? $("useGitHub").checked === true : false;
  const useLovable = $("useLovable") ? $("useLovable").checked === true : false;
  const agCodexRatioDefault = $("agCodexRatioDefault") ? $("agCodexRatioDefault").checked === true : false;
  const agCodexRatio = agCodexRatioDefault ? "" : ($("agCodexRatio")?.value || "").trim();

  try {
    setMeta("Starting pipeline…");
    const resp = await apiPost("/api/pipeline/start", {
      cwd,
      userPrompt,
      managerModel,
      developerModel,
      managerPreprompt,
      developerPreprompt,
      connectorBaseUrl: connectorBaseUrl || null,
      connectorNotify,
      connectorDebug,
      enableCorrector,
      threadPolicy,
      createProjectDir,
      projectDirName: projectDirName || null,
      useChatGPT,
      useGitHub,
      useLovable,
      agCodexRatioDefault,
      agCodexRatio: agCodexRatio || null,
    });
    const run = resp.run;
    setActiveRunId(run.runId);
    renderRun(run);
    clearLogs();
    openStreams(run.runId);
    void todoReload();
    void tasksReload();
    await refreshRuns();
    setMeta("Pipeline started (phase planning + implementing)");
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    if (msg.includes("Another pipeline is already running")) {
      try {
        const lock = await apiGet("/api/pipeline/lock");
        setMeta(`Error: ${msg}\n\nLock:\n${JSON.stringify(lock.lock || lock, null, 2)}`);
        return;
      } catch {
        // ignore
      }
    }
    setMeta(`Error: ${msg}`);
  }
}

async function checkConnector() {
  const baseUrl = ($("connectorBaseUrl")?.value || "").trim();
  if (!baseUrl) {
    $("connectorStatus").textContent = "(missing connectorBaseUrl)";
    return;
  }
  try {
    $("connectorStatus").textContent = "Checking…";
    const r = await apiGet(`/api/connector/status?baseUrl=${encodeURIComponent(baseUrl)}`);
    $("connectorStatus").textContent = JSON.stringify(r, null, 2);
  } catch (e) {
    $("connectorStatus").textContent = `Error: ${e.message}`;
  }
}

async function continuePipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to continue");
    return;
  }
  try {
    setMeta("Continuing pipeline (auto-run)…");
    const cwd = (activeRunCwd || $("cwd").value || "").trim();
    const threadPolicy = buildThreadPolicyFromUi();
    const newSession = $("continueNewSession")?.checked === true;
    const useChatGPT = $("useChatGPT") ? $("useChatGPT").checked === true : false;
    const useGitHub = $("useGitHub") ? $("useGitHub").checked === true : false;
    const useLovable = $("useLovable") ? $("useLovable").checked === true : false;
    const agCodexRatioDefault = $("agCodexRatioDefault") ? $("agCodexRatioDefault").checked === true : false;
    const agCodexRatio = agCodexRatioDefault ? "" : ($("agCodexRatio")?.value || "").trim();
    const body = {
      runId,
      ...(cwd ? { cwd } : {}),
      managerModel: ($("managerModel")?.value || "").trim(),
      developerModel: ($("developerModel")?.value || "").trim(),
      // UI uses ids managerPre/developerPre (legacy); keep continue compatible.
      managerPreprompt: ($("managerPre")?.value || "").trim(),
      developerPreprompt: ($("developerPre")?.value || "").trim(),
      connectorBaseUrl: ($("connectorBaseUrl")?.value || "").trim(),
      connectorNotify: $("connectorNotify")?.checked === true,
      connectorDebug: $("connectorDebug")?.checked === true,
      enableCorrector: $("enableCorrector") ? $("enableCorrector").checked : true,
      threadPolicy,
      newSession,
      autoRun: true,
      useChatGPT,
      useGitHub,
      useLovable,
      agCodexRatioDefault,
      agCodexRatio: agCodexRatio || null,
    };
    const resp = await apiPost("/api/pipeline/continue", body);
    renderRun(resp.run);
    openStreams(runId);
    void todoReload();
    void tasksReload();
    setMeta("Pipeline running (auto-run).");
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    if (msg.toLowerCase().includes("run not found")) {
      setMeta(
        `Error: ${msg}\n\nTip: this usually means you restarted Antidex (or you have 2 servers on different ports). Make sure the CWD field is filled, then try Continue again. Also check the header meta for the server port/pid/dataDir.`,
      );
      return;
    }
    setMeta(`Error: ${msg}`);
  }
}

async function sendToManager() {
  const runId = activeRunId || $("runIdOut")?.textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId loaded (use Load selected first)");
    return;
  }
  const userCommandMessage = $("userPrompt").value.trim();
  if (!userCommandMessage) {
    setMeta("Nothing to send (Prompt utilisateur is empty)");
    return;
  }
  try {
    setMeta("Sending message to Manager (override)…");
    const cwd = (activeRunCwd || $("cwd").value || "").trim();
    const threadPolicy = buildThreadPolicyFromUi();
    const newSession = $("continueNewSession")?.checked === true;
    const useChatGPT = $("useChatGPT") ? $("useChatGPT").checked === true : false;
    const useGitHub = $("useGitHub") ? $("useGitHub").checked === true : false;
    const useLovable = $("useLovable") ? $("useLovable").checked === true : false;
    const agCodexRatioDefault = $("agCodexRatioDefault") ? $("agCodexRatioDefault").checked === true : false;
    const agCodexRatio = agCodexRatioDefault ? "" : ($("agCodexRatio")?.value || "").trim();
    const body = {
      runId,
      ...(cwd ? { cwd } : {}),
      managerModel: ($("managerModel")?.value || "").trim(),
      developerModel: ($("developerModel")?.value || "").trim(),
      managerPreprompt: ($("managerPre")?.value || "").trim(),
      developerPreprompt: ($("developerPre")?.value || "").trim(),
      connectorBaseUrl: ($("connectorBaseUrl")?.value || "").trim(),
      connectorNotify: $("connectorNotify")?.checked === true,
      connectorDebug: $("connectorDebug")?.checked === true,
      enableCorrector: $("enableCorrector") ? $("enableCorrector").checked : true,
      threadPolicy,
      newSession,
      autoRun: true,
      useChatGPT,
      useGitHub,
      useLovable,
      agCodexRatioDefault,
      agCodexRatio: agCodexRatio || null,
      userCommandMessage,
      userCommandSource: "ui_send",
    };
    const resp = await apiPost("/api/pipeline/continue", body);
    renderRun(resp.run);
    openStreams(runId);
    void todoReload();
    void tasksReload();
    $("userPrompt").value = "";
    setMeta("Sent to Manager. Pipeline running (auto-run).");
  } catch (e) {
    setMeta(`Error: ${e?.message ? String(e.message) : String(e)}`);
  }
}

async function resumePipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to resume");
    return;
  }
  try {
    setMeta("Resuming pipeline (auto-run)…");
    const resp = await apiPost("/api/pipeline/resume", { runId, autoRun: true });
    renderRun(resp.run);
    openStreams(runId);
    void todoReload();
    void tasksReload();
    setMeta("Pipeline running (auto-run).");
  } catch (e) {
    setMeta(`Error: ${e?.message ? String(e.message) : String(e)}`);
  }
}

async function pausePipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to pause");
    return;
  }
  try {
    setMeta("Pausing pipeline…");
    await apiPost("/api/pipeline/pause", { runId });
    const r = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    renderRun(r.run);
    setMeta("Pipeline paused");
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

async function cancelPipeline() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") {
    setMeta("No runId to cancel");
    return;
  }
  try {
    setMeta("Canceling pipeline…");
    await apiPost("/api/pipeline/cancel", { runId });
    const r = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`);
    renderRun(r.run);
    setMeta("Pipeline canceled");
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

async function forceUnlock() {
  try {
    setMeta("Force unlock…");
    const resp = await apiPost("/api/pipeline/unlock", {});
    const r = resp?.result;
    if (r?.unlocked) {
      setMeta(`Unlocked (runId=${r.runId || "unknown"})`);
    } else {
      setMeta("Not locked");
    }
    await refreshRuns();
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

async function loadFilePath(filePath) {
  if (!filePath) return;
  try {
    setMeta(`Loading file…`);
    const r = await apiGet(`/api/logs/file?path=${encodeURIComponent(filePath)}`);
    $("artifactContent").textContent = r.content || "";
    setMeta(`Loaded ${filePath}`);
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

async function todoReload() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") return;
  try {
    const r = await apiGet(`/api/pipeline/todo?runId=${encodeURIComponent(runId)}`);
    const content = r?.content || "";
    $("todoEditor").value = content;
    lastLoadedTodo = { content, mtimeMs: r.mtimeMs ?? null, path: r.path || null };
    lastDiskTodo = { content, mtimeMs: r.mtimeMs ?? null };
    const p = r.path ? String(r.path) : "(unknown)";
    const m = r.mtimeMs ? new Date(r.mtimeMs).toISOString() : "-";
    $("todoMeta").textContent = `path: ${p} | mtime: ${m} | size: ${r.size ?? "-"}`;
    $("todoDiff").textContent = unifiedLineDiff(lastLoadedTodo.content, $("todoEditor").value);
    $("todoDiffDisk").textContent = "";
  } catch (e) {
    $("todoMeta").textContent = `Error: ${e.message}`;
  }
}

async function todoCheckDisk() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") return;
  try {
    const r = await apiGet(`/api/pipeline/todo?runId=${encodeURIComponent(runId)}`, { timeoutMs: 8000 });
    const diskContent = r?.content || "";
    const diskMtimeMs = r?.mtimeMs ?? null;

    if (diskMtimeMs && lastLoadedTodo.mtimeMs && diskMtimeMs === lastLoadedTodo.mtimeMs) return;

    if (diskContent !== lastLoadedTodo.content) {
      lastDiskTodo = { content: diskContent, mtimeMs: diskMtimeMs };
      $("todoDiffDisk").textContent = unifiedLineDiff(lastLoadedTodo.content, diskContent);
      const iso = diskMtimeMs ? new Date(diskMtimeMs).toISOString() : "-";
      $("todoMeta").textContent = `TODO changed on disk (mtime: ${iso}). Reload if you want to replace the editor content.`;
    }
  } catch {
    // ignore
  }
}

function todoUpdateDiff() {
  try {
    const cur = $("todoEditor").value || "";
    $("todoDiff").textContent = unifiedLineDiff(lastLoadedTodo.content, cur);
  } catch {
    // ignore
  }
}

async function todoSave({ alsoContinue = false } = {}) {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") return;
  try {
    const content = $("todoEditor").value || "";
    const r = await apiPost("/api/pipeline/todo", { runId, content });
    lastLoadedTodo = { content, mtimeMs: r.mtimeMs ?? null, path: r.path || null };
    lastDiskTodo = { content, mtimeMs: r.mtimeMs ?? null };
    $("todoMeta").textContent = `saved: ${r.path} | mtime: ${new Date(r.mtimeMs).toISOString()} | size: ${r.size}`;
    todoUpdateDiff();
    $("todoDiffDisk").textContent = "";
    if (alsoContinue) {
      // force a manager resync pass (todoUpdated)
      setMeta("Continuing with TODO update…");
      const cwd = (activeRunCwd || $("cwd").value || "").trim();
      const useChatGPT = $("useChatGPT") ? $("useChatGPT").checked === true : false;
      const useGitHub = $("useGitHub") ? $("useGitHub").checked === true : false;
      const useLovable = $("useLovable") ? $("useLovable").checked === true : false;
      const agCodexRatioDefault = $("agCodexRatioDefault") ? $("agCodexRatioDefault").checked === true : false;
      const agCodexRatio = ($("agCodexRatio")?.value || "").trim();
      const resp = await apiPost("/api/pipeline/continue", {
        runId,
        ...(cwd ? { cwd } : {}),
        managerModel: ($("managerModel")?.value || "").trim(),
        developerModel: ($("developerModel")?.value || "").trim(),
        managerPreprompt: ($("managerPre")?.value || "").trim(),
        developerPreprompt: ($("developerPre")?.value || "").trim(),
        connectorBaseUrl: ($("connectorBaseUrl")?.value || "").trim(),
        connectorNotify: $("connectorNotify")?.checked === true,
        connectorDebug: $("connectorDebug")?.checked === true,
        enableCorrector: $("enableCorrector") ? $("enableCorrector").checked : true,
        threadPolicy: buildThreadPolicyFromUi(),
        newSession: $("continueNewSession")?.checked === true,
        todoUpdated: true,
        autoRun: true,
        useChatGPT,
        useGitHub,
        useLovable,
        agCodexRatioDefault,
        agCodexRatio: agCodexRatio || null,
      });
      renderRun(resp.run);
      openStreams(runId);
      setMeta("Pipeline running (todoUpdated).");
    }
  } catch (e) {
    setMeta(`Error: ${e.message}`);
  }
}

function renderTasks(tasks) {
  const root = $("tasksList");
  root.innerHTML = "";
  const list = Array.isArray(tasks) ? tasks : [];
  $("tasksMeta").textContent = list.length ? `${list.length} tasks` : "no tasks";

  const todoText = (() => {
    try {
      const v = $("todoEditor")?.value;
      if (v && String(v).trim().length) return String(v);
    } catch {
      // ignore
    }
    try {
      if (lastLoadedTodo?.content && String(lastLoadedTodo.content).trim().length) return String(lastLoadedTodo.content);
    } catch {
      // ignore
    }
    return "";
  })();

  const todoOrder = extractTodoTaskOrder(todoText);
  const ordered = [...list].sort((a, b) => {
    const ai = todoOrder.has(a.taskId) ? todoOrder.get(a.taskId) : Number.POSITIVE_INFINITY;
    const bi = todoOrder.has(b.taskId) ? todoOrder.get(b.taskId) : Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return String(a.taskId || "").localeCompare(String(b.taskId || ""));
  });

  for (const t of ordered) {
    const row = document.createElement("div");
    row.className = "taskRow";

    const left = document.createElement("div");
    left.innerHTML = `<span class="taskId">${t.taskId}</span> ${t.isCurrent ? '<span class="pill current">current</span>' : ""} ${
      t.assignedDeveloper ? `<span class="pill">${t.assignedDeveloper}</span>` : ""
    }`;

    const pill = (label, ok) => {
      const s = document.createElement("span");
      s.className = `pill ${ok ? "ok" : "missing"}`;
      s.textContent = label;
      return s;
    };

    const qLabel = `Q:${(t.questions || []).length}`;
    const aLabel = `A:${(t.answers || []).length}`;

    const mid1 = document.createElement("div");
    mid1.appendChild(pill("task", !!t.exists?.task));
    mid1.appendChild(document.createTextNode(" "));
    mid1.appendChild(pill("ack", !!t.exists?.devAck));
    mid1.appendChild(document.createTextNode(" "));
    mid1.appendChild(pill("result", !!t.exists?.devResult));
    mid1.appendChild(document.createTextNode(" "));
    mid1.appendChild(pill("review", !!t.exists?.managerReview));

    const mid2 = document.createElement("div");
    mid2.appendChild(pill(qLabel, (t.questions || []).length > 0));
    mid2.appendChild(document.createTextNode(" "));
    mid2.appendChild(pill(aLabel, (t.answers || []).length > 0));

    const actions = document.createElement("div");
    const mkBtn = (label, path) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.disabled = !path;
      b.addEventListener("click", () => void loadFilePath(path));
      return b;
    };
    actions.appendChild(mkBtn("task.md", t.paths?.taskPath));
    actions.appendChild(mkBtn("result", t.paths?.devResultPath));
    actions.appendChild(mkBtn("review", t.paths?.managerReviewPath));
    const lastQ = (t.questions || []).slice(-1)[0] || null;
    const lastA = (t.answers || []).slice(-1)[0] || null;
    actions.appendChild(mkBtn("Q", lastQ));
    actions.appendChild(mkBtn("A", lastA));

    row.appendChild(left);
    row.appendChild(mid1);
    row.appendChild(mid2);
    row.appendChild(actions);
    root.appendChild(row);
  }
}

async function tasksReload() {
  const runId = activeRunId || $("runIdOut").textContent;
  if (!runId || runId === "(none)") return;
  try {
    const r = await apiGet(`/api/pipeline/tasks?runId=${encodeURIComponent(runId)}`);
    renderTasks(r.tasks || []);
  } catch (e) {
    $("tasksMeta").textContent = `Error: ${e.message}`;
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
  $("sendToManager")?.addEventListener("click", sendToManager);
  document.getElementById("resume")?.addEventListener("click", resumePipeline);
  $("pause")?.addEventListener("click", pausePipeline);
  $("editTodo")?.addEventListener("click", () => {
    const runId = activeRunId || $("runIdOut")?.textContent;
    openTodoEditor(runId);
  });
  $("stop").addEventListener("click", stopPipeline);
  $("cancel")?.addEventListener("click", cancelPipeline);
  $("unlock")?.addEventListener("click", forceUnlock);
  $("checkConnector")?.addEventListener("click", checkConnector);
  $("todoReload")?.addEventListener("click", todoReload);
  $("todoSave")?.addEventListener("click", () => void todoSave({ alsoContinue: false }));
  $("todoSaveContinue")?.addEventListener("click", () => void todoSave({ alsoContinue: true }));
  $("todoEditor")?.addEventListener("input", todoUpdateDiff);
  $("tasksReload")?.addEventListener("click", tasksReload);
  $("openLogs").addEventListener("click", () => {
    window.open("/logs.html", "_blank", "noopener");
  });
  await setupCwdDialog();
  $("refreshRuns").addEventListener("click", refreshRuns);
  $("loadRun").addEventListener("click", async () => {
    const runId = $("runSelect").value;
    if (runId) await loadRun(runId);
  });
  $("modifyTodo")?.addEventListener("click", () => {
    const runId = activeRunId || $("runSelect")?.value || $("runIdOut")?.textContent;
    openTodoEditor(runId);
  });
  $("loadSpec").addEventListener("click", () => loadArtifact("spec"));
  $("loadTodo").addEventListener("click", () => loadArtifact("todo"));
  $("loadTesting").addEventListener("click", () => loadArtifact("testing"));
  $("loadProjectState").addEventListener("click", () => loadArtifact("projectState"));
  $("loadTask").addEventListener("click", () => loadArtifact("task"));
  $("loadTaskResult").addEventListener("click", () => loadArtifact("taskResult"));
  $("loadTaskReview").addEventListener("click", () => loadArtifact("taskReview"));
  $("loadAgResult")?.addEventListener("click", () => loadArtifact("agResult"));
  $("loadAgAck")?.addEventListener("click", () => loadArtifact("agAck"));

  // Long jobs panel (best-effort if elements exist)
  try {
    setJobButtonsEnabled(false);
  } catch {
    // ignore
  }
  document.getElementById("jobRefresh")?.addEventListener("click", () => void refreshJobDetails());
  document.getElementById("jobTailStdout")?.addEventListener("click", () => void refreshJobDetails({ tailStream: "stdout" }));
  document.getElementById("jobTailStderr")?.addEventListener("click", () => void refreshJobDetails({ tailStream: "stderr" }));
  document.getElementById("jobMonitorNow")?.addEventListener("click", async () => {
    const runId = activeRunId || $("runIdOut")?.textContent;
    if (!runId || runId === "(none)") return;
    await apiPost("/api/jobs/monitorNow", { runId, reason: "UI monitor now" });
    await refreshJobDetails();
  });
  document.getElementById("jobStop")?.addEventListener("click", async () => {
    const runId = activeRunId || $("runIdOut")?.textContent;
    if (!runId || runId === "(none)") return;
    await apiPost("/api/jobs/stop", { runId, reason: "UI stop" });
    await refreshJobDetails();
  });
  document.getElementById("jobRestart")?.addEventListener("click", async () => {
    const runId = activeRunId || $("runIdOut")?.textContent;
    if (!runId || runId === "(none)") return;
    await apiPost("/api/jobs/restart", { runId, reason: "UI restart" });
    await refreshJobDetails();
  });

  // Pré-remplir un pré-prompt manager raisonnable
  $("managerPre").value =
    [
      "Role: Manager (planning only; do NOT implement code).",
      "Read `agents/manager.md`, then `doc/DOCS_RULES.md` and `doc/INDEX.md`.",
      "Maintain `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md` and update `data/pipeline_state.json` (+ turn marker when requested).",
    ].join("\n");

  // Pré-remplir un pré-prompt développeur (optionnel)
  $("developerPre").value =
    "Tu es le développeur principal. Lis doc/INDEX.md puis doc/SPEC.md, doc/TODO.md et doc/TESTING_PLAN.md. Implémente d'abord les P0, ajoute des tests, et mets à jour la documentation si besoin (TODO/SPEC/DECISIONS + INDEX). À la fin, mets developer_status=ready_for_review dans data/pipeline_state.json avec un résumé et les résultats de tests.";

  try {
    const status = await apiGet("/api/status");
    const serverBits = [];
    if (status?.app) serverBits.push(String(status.app));
    if (status?.port) serverBits.push(`:${status.port}`);
    if (status?.pid) serverBits.push(`pid=${status.pid}`);
    if (status?.dataDir) serverBits.push(`dataDir=${status.dataDir}`);
    const serverInfo = serverBits.length ? serverBits.join(" ") : "server";
    if (!status?.codex?.ok) {
      setMeta(`${serverInfo}\nCodex missing: ${status?.codex?.hint || "unknown"}`);
    } else {
      setMeta(`${serverInfo}\nReady (codex: ${status.codex.source})`);
    }
  } catch {
    setMeta("Ready.");
  }
  await refreshRuns();

  // Options UX: if default ratio policy is enabled, disable the free-text field to avoid contradictions.
  try {
    const def = document.getElementById("agCodexRatioDefault");
    const ratio = document.getElementById("agCodexRatio");
    const sync = () => {
      if (!def || !ratio) return;
      const on = def.checked === true;
      ratio.disabled = on;
      if (on) ratio.value = "";
    };
    def?.addEventListener("change", sync);
    sync();
  } catch {
    // ignore
  }

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

window.addEventListener("message", (ev) => {
  try {
    const data = ev?.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "todo_saved" && data.runId) {
      setMeta(`TODO saved for runId=${data.runId}`);
      if (String(activeRunId || "") === String(data.runId)) {
        void refreshTodoProgress();
        void todoReload();
        void tasksReload();
      }
      return;
    }
    if (data.type === "todo_continue" && data.runId) {
      const rid = String(data.runId);
      setMeta(`Continuing runId=${rid} after TODO update…`);
      // Best-effort: refresh run state if it's the active one.
      if (String(activeRunId || "") === rid) {
        void (async () => {
          try {
            const st = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(rid)}`);
            renderRun(st.run);
          } catch {
            // ignore
          }
        })();
      }
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
