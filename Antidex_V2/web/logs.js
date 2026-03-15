function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function setMeta(text) {
  $("meta").textContent = text || "";
}

async function apiGet(path) {
  const r = await fetch(path, { headers: { "cache-control": "no-store" } });
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

function renderRuns(runs) {
  const body = $("runsTable").querySelector("tbody");
  body.innerHTML = "";
  for (const r of runs || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${r.runId}</td>
      <td>${r.status || ""}</td>
      <td class="mono">${r.updatedAt || ""}</td>
      <td class="mono">${r.managerThreadId || ""}</td>
      <td class="mono">${r.developerThreadId || ""}</td>
    `;
    tr.addEventListener("click", () => {
      $("runIdInput").value = r.runId;
    });
    body.appendChild(tr);
  }
}

function renderThreads(threads) {
  const body = $("threadsTable").querySelector("tbody");
  body.innerHTML = "";
  for (const t of threads || []) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="mono">${t.threadId}</td>
      <td>${(t.roles || []).join(", ")}</td>
      <td class="mono">${(t.runIds || []).join(", ")}</td>
      <td class="mono">${t.rolloutPath || ""}</td>
    `;
    tr.addEventListener("click", () => {
      $("filePath").value = t.rolloutPath || "";
      $("search").value = t.threadId;
    });
    body.appendChild(tr);
  }
}

function renderConversation(items) {
  const container = $("conversation");
  container.innerHTML = "";
  for (const item of items || []) {
    const div = document.createElement("div");
    div.className = `msg ${item.role || "unknown"}`;
    const header = document.createElement("div");
    header.className = "msg-header";
    header.textContent = `${item.role || "unknown"} ${item.step ? "(" + item.step + ")" : ""}`;
    const pre = document.createElement("pre");
    pre.textContent = item.text || "";
    const meta = document.createElement("div");
    meta.className = "msg-meta mono";
    meta.textContent = item.filePath || "";
    div.appendChild(header);
    div.appendChild(pre);
    div.appendChild(meta);
    container.appendChild(div);
  }
}

async function refreshIndex() {
  setMeta("Loading index...");
  const r = await apiGet("/api/logs/index");
  const search = $("search").value.trim();
  let runs = r.runs || [];
  let threads = r.threads || [];
  if (search) {
    runs = runs.filter(
      (x) =>
        String(x.runId || "").includes(search) ||
        String(x.managerThreadId || "").includes(search) ||
        String(x.developerThreadId || "").includes(search),
    );
    threads = threads.filter((x) => String(x.threadId || "").includes(search));
  }
  renderRuns(runs);
  renderThreads(threads);
  setMeta(`Index loaded (${runs.length} runs, ${threads.length} threads)`);
}

async function loadConversation() {
  const runId = $("runIdInput").value.trim();
  if (!runId) {
    setMeta("Missing runId");
    return;
  }
  setMeta("Loading conversation...");
  const r = await apiGet(`/api/logs/conversation?runId=${encodeURIComponent(runId)}`);
  renderConversation(r.items || []);
  setMeta(`Conversation loaded (${(r.items || []).length} items)`);
}

async function loadFile() {
  const path = $("filePath").value.trim();
  if (!path) return;
  setMeta("Loading file...");
  const r = await apiGet(`/api/logs/file?path=${encodeURIComponent(path)}`);
  $("fileContent").textContent = r.content || "";
  setMeta("File loaded");
}

document.addEventListener("DOMContentLoaded", async () => {
  $("refresh").addEventListener("click", refreshIndex);
  $("loadConversation").addEventListener("click", loadConversation);
  $("loadFile").addEventListener("click", loadFile);
  $("search").addEventListener("input", () => {
    void refreshIndex();
  });
  await refreshIndex();
});
