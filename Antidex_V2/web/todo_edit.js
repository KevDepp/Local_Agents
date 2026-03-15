function $(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element: ${id}`);
  return el;
}

function setStatus(text) {
  $("status").textContent = text || "";
}

function getRunId() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("runId") || "").trim();
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
    if (e?.name === "AbortError") throw new Error(`Request timeout after ${timeoutMs}ms: ${path}`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function apiPost(path, body, { timeoutMs = 15_000 } = {}) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      ...(controller ? { signal: controller.signal } : {}),
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json?.ok) {
      const base = json?.error || `HTTP ${r.status}`;
      throw new Error(base);
    }
    return json;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Request timeout after ${timeoutMs}ms: ${path}`);
    throw e;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function fmtMtime(mtimeMs) {
  if (!mtimeMs) return "-";
  try {
    return new Date(mtimeMs).toISOString();
  } catch {
    return String(mtimeMs);
  }
}

async function loadTodo(runId) {
  setStatus(`Loading…\nGET /api/pipeline/todo?runId=${runId}`);
  const r = await apiGet(`/api/pipeline/todo?runId=${encodeURIComponent(runId)}`, { timeoutMs: 30_000 });
  $("runIdOut").textContent = runId;
  $("pathOut").textContent = r.path || "-";
  $("mtimeOut").textContent = fmtMtime(r.mtimeMs);
  $("sizeOut").textContent = r.size != null ? String(r.size) : "-";
  $("todoText").value = r.content || "";
  setStatus("Loaded.");
}

async function saveTodo(runId) {
  const content = $("todoText").value;
  const r = await apiPost("/api/pipeline/todo", { runId, content }, { timeoutMs: 30_000 });
  $("mtimeOut").textContent = fmtMtime(r.mtimeMs);
  $("sizeOut").textContent = r.size != null ? String(r.size) : "-";
  setStatus("Saved.");
  try {
    window.opener?.postMessage({ type: "todo_saved", runId }, "*");
  } catch {
    // ignore
  }
}

async function continueAfterSave(runId) {
  setStatus("Saving + continuing…");
  await saveTodo(runId);
  // Include cwd to allow recovery if orchestrator state was reset.
  const st = await apiGet(`/api/pipeline/state?runId=${encodeURIComponent(runId)}`, { timeoutMs: 30_000 });
  const cwd = st?.run?.cwd || null;
  // Real Codex runs can take a while; use a longer timeout here.
  // Continue in auto-run mode so the pipeline runs until it reaches blocked|failed|completed|stopped.
  await apiPost(
    "/api/pipeline/continue",
    { runId, ...(cwd ? { cwd } : {}), todoUpdated: true, autoRun: true },
    { timeoutMs: 600_000 },
  );
  setStatus("Continue triggered.");
  try {
    window.opener?.postMessage({ type: "todo_continue", runId }, "*");
  } catch {
    // ignore
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  const runId = getRunId();
  if (!runId) {
    setStatus("Missing runId in URL.");
    return;
  }

  $("runIdOut").textContent = runId;

  $("refresh").addEventListener("click", () => {
    void (async () => {
      try {
        setStatus("Refreshing…");
        await loadTodo(runId);
      } catch (e) {
        setStatus(`Error: ${e.message || String(e)}`);
      }
    })();
  });

  $("save").addEventListener("click", () => {
    void (async () => {
      try {
        setStatus("Saving…");
        await saveTodo(runId);
      } catch (e) {
        setStatus(`Error: ${e.message || String(e)}`);
      }
    })();
  });

  $("continue").addEventListener("click", () => {
    void (async () => {
      try {
        await continueAfterSave(runId);
      } catch (e) {
        setStatus(`Error: ${e.message || String(e)}`);
      }
    })();
  });

  $("close").addEventListener("click", () => window.close());

  try {
    setStatus("Loading…");
    await loadTodo(runId);
  } catch (e) {
    setStatus(`Error: ${e.message || String(e)}`);
  }
});
