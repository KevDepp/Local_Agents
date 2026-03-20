const { spawn } = require("child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

function ensureDir(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
}

function appendJsonlLine(filePath, obj) {
  try {
    if (!filePath) return false;
    ensureDir(path.dirname(filePath));
    fs.appendFileSync(filePath, `${JSON.stringify(obj)}\n`, { encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function nowIsoForFile() {
  return nowIso().replace(/[:.]/g, "-");
}

function writeJsonAtomic(filePath, value) {
  ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

function writeTextAtomic(filePath, text) {
  ensureDir(path.dirname(filePath));
  const payload = String(text || "");
  const normalized = payload.endsWith("\n") ? payload : payload + "\n";
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, normalized, "utf8");
  try {
    fs.renameSync(tmpPath, filePath);
  } catch {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tmpPath, filePath);
    } catch {
      fs.writeFileSync(filePath, normalized, "utf8");
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // ignore
      }
    }
  }
}

function incidentResultPathFromIncidentPath(incidentPath) {
  return String(incidentPath || "").replace(/(\.json)$/i, "_result$1");
}

function baseRecommendationKey(rec) {
  const where = rec && rec.where ? String(rec.where) : "";
  if (where) return where;
  const signature = rec && rec.signature ? String(rec.signature) : "";
  return signature.replace(/:.+$/, "");
}

function auditorRunDir(dataDir, runId) {
  const safe = String(runId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(dataDir, "external_auditor", safe);
}

function buildAuditJson({ snapshot, mode }) {
  return {
    ...snapshot,
    schema: "antidex.external_auditor.v1",
    at: snapshot?.at || snapshot?.generated_at || nowIso(),
    generated_at: snapshot?.generated_at || snapshot?.at || nowIso(),
    auditor_mode: mode,
  };
}

function buildAuditMarkdown({ snapshot, mode, reportJsonPath, reportMdPath }) {
  const lines = [];
  lines.push(`# External audit - ${snapshot?.run_id || "unknown"}`);
  lines.push("");
  lines.push(`- generated_at: ${snapshot?.generated_at || snapshot?.at || nowIso()}`);
  lines.push(`- mode: ${mode}`);
  lines.push(`- conclusion: ${snapshot?.conclusion || "unknown"}`);
  lines.push(`- confidence: ${snapshot?.confidence || "-"}`);
  lines.push(`- recommended_action: ${snapshot?.recommended_action || "-"}`);
  lines.push(`- run_status: ${snapshot?.run_status || "-"}`);
  lines.push(`- developer_status: ${snapshot?.developer_status || "-"}`);
  lines.push(`- current_task_id: ${snapshot?.current_task_id || "-"}`);
  if (snapshot?.summary) lines.push(`- summary: ${snapshot.summary}`);
  if (snapshot?.recommendation) {
    lines.push("");
    lines.push("## Recommendation");
    lines.push(`- signature: ${snapshot.recommendation.signature || "-"}`);
    lines.push(`- where: ${snapshot.recommendation.where || "-"}`);
    lines.push(`- confidence: ${snapshot.recommendation.confidence || "-"}`);
    lines.push(`- dedupe_key: ${snapshot.recommendation.dedupe_key || "-"}`);
    lines.push(`- explanation: ${snapshot.recommendation.explanation || "-"}`);
  }
  if (snapshot?.recovery) {
    lines.push("");
    lines.push("## Recovery");
    lines.push(`- status: ${snapshot.recovery.status || "-"}`);
    lines.push(`- lane: ${snapshot.recovery.lane || "-"}`);
    lines.push(`- fix_status: ${snapshot.recovery.fix_status || "-"}`);
    if (Array.isArray(snapshot.recovery.healing?.reasons) && snapshot.recovery.healing.reasons.length) {
      lines.push(`- healing: ${snapshot.recovery.healing.reasons.join(", ")}`);
    }
    if (Array.isArray(snapshot.recovery.progress?.reasons) && snapshot.recovery.progress.reasons.length) {
      lines.push(`- progress: ${snapshot.recovery.progress.reasons.join(", ")}`);
    }
  }
  if (Array.isArray(snapshot?.findings) && snapshot.findings.length) {
    lines.push("");
    lines.push("## Findings");
    for (const finding of snapshot.findings) {
      const modeLabel = finding.automation === "auto_incident_candidate" ? "auto" : "report-only";
      lines.push(`- [${modeLabel}] ${finding.code || finding.signature || "finding"}: ${finding.summary || finding.explanation || "-"}`);
    }
  }
  if (snapshot?.automation_scope) {
    lines.push("");
    lines.push("## Automation scope");
    lines.push(`- observer_mode: ${snapshot.automation_scope.observer_mode || "-"}`);
    lines.push(`- auto_incident_limited_to_catalogued_signatures: ${snapshot.automation_scope.auto_incident_limited_to_catalogued_signatures === true}`);
    if (Array.isArray(snapshot.automation_scope.report_only_findings) && snapshot.automation_scope.report_only_findings.length) {
      lines.push(`- report_only_findings: ${snapshot.automation_scope.report_only_findings.join(", ")}`);
    }
    if (Array.isArray(snapshot.automation_scope.auto_actionable_findings) && snapshot.automation_scope.auto_actionable_findings.length) {
      lines.push(`- auto_actionable_findings: ${snapshot.automation_scope.auto_actionable_findings.join(", ")}`);
    }
  }
  if (snapshot?.audit_context?.antidex || snapshot?.audit_context?.project) {
    lines.push("");
    lines.push("## Context");
    if (snapshot.audit_context.antidex?.run_trace?.timeline_path) lines.push(`- antidex_timeline: ${snapshot.audit_context.antidex.run_trace.timeline_path}`);
    if (snapshot.audit_context.antidex?.run_trace?.summary_path) lines.push(`- antidex_summary: ${snapshot.audit_context.antidex.run_trace.summary_path}`);
    if (snapshot.audit_context.project?.pipeline_state?.path) lines.push(`- project_pipeline_state: ${snapshot.audit_context.project.pipeline_state.path}`);
    if (snapshot.audit_context.project?.current_task?.task_md?.path) lines.push(`- current_task_md: ${snapshot.audit_context.project.current_task.task_md.path}`);
    if (snapshot.audit_context.project?.current_task?.manager_instruction?.path) lines.push(`- current_manager_instruction: ${snapshot.audit_context.project.current_task.manager_instruction.path}`);
  }
  lines.push("");
  lines.push(`- json_report: ${reportJsonPath}`);
  lines.push(`- md_report: ${reportMdPath}`);
  return lines.join("\n");
}

function writeAuditReport({ dataDir, runId, mode, snapshot }) {
  const dir = auditorRunDir(dataDir, runId);
  ensureDir(dir);
  const stamp = nowIsoForFile().slice(0, 19);
  const jsonPath = path.join(dir, `AUD-${stamp}.json`);
  const mdPath = path.join(dir, `AUD-${stamp}.md`);
  const auditJson = buildAuditJson({ snapshot, mode });
  writeJsonAtomic(jsonPath, auditJson);
  const md = buildAuditMarkdown({
    snapshot: auditJson,
    mode,
    reportJsonPath: path.relative(dir, jsonPath).replace(/\\/g, "/"),
    reportMdPath: path.relative(dir, mdPath).replace(/\\/g, "/"),
  });
  writeTextAtomic(mdPath, md);
  writeJsonAtomic(path.join(dir, "latest.json"), auditJson);
  writeTextAtomic(path.join(dir, "latest.md"), md);
  return { dir, jsonPath, mdPath, markdown: md, snapshot: auditJson };
}

function auditorLatestReportPath(dataDir, runId) {
  return path.join(auditorRunDir(dataDir, runId), "latest.json");
}

function snapshotAuditAtMs(snapshot) {
  const raw = snapshot?.generated_at || snapshot?.at || null;
  const ms = raw ? Date.parse(String(raw)) : NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function readLatestPersistedAudit({ dataDir, runId }) {
  const jsonPath = auditorLatestReportPath(dataDir, runId);
  const snapshot = readJsonBestEffort(jsonPath);
  if (!snapshot || typeof snapshot !== "object") return null;
  return {
    jsonPath,
    snapshot,
    auditAtMs: snapshotAuditAtMs(snapshot),
  };
}

function shouldConsumePersistedAudit(entry, persisted) {
  if (!persisted?.snapshot) return false;
  const auditAtMs = Number(persisted.auditAtMs || 0);
  const lastAuditAtMs = Number(entry?.lastAuditAtMs || 0);
  if (!lastAuditAtMs) return true;
  return auditAtMs > lastAuditAtMs;
}

function finalizeAuditorPendingMarker({ pendingPath, suffix, payload }) {
  try {
    const dest = path.join(path.dirname(pendingPath), `${suffix}_${nowIsoForFile()}.json`);
    writeJsonAtomic(dest, payload || {});
    fs.rmSync(pendingPath, { force: true });
    return dest;
  } catch {
    return null;
  }
}

async function maybeHandleAuditorRecommendation({ baseUrl, dataDir, runId, auditorMode, auditorWhitelist, snapshot, pendingPath }) {
  if (auditorMode !== "enforcing" || !snapshot?.recommendation) return false;
  const baseKey = baseRecommendationKey(snapshot.recommendation);
  if (auditorWhitelist.size && !auditorWhitelist.has(baseKey)) return false;

  const reportPath = auditorLatestReportPath(dataDir, runId);
  const pendingPayload = {
    at: nowIso(),
    runId,
    mode: auditorMode,
    where: snapshot.recommendation.where || null,
    signature: snapshot.recommendation.signature || null,
    dedupe_key: snapshot.recommendation.dedupe_key || null,
    recommendation: snapshot.recommendation,
    reportPath,
  };
  writeJsonAtomic(pendingPath, pendingPayload);

  const open = await httpJson({
    method: "POST",
    baseUrl,
    urlPath: "/api/auditor/open_incident",
    body: {
      runId,
      recommendation: snapshot.recommendation,
      auditReportPath: reportPath,
      mode: auditorMode,
    },
    timeoutMs: 30_000,
  });
  const payload = {
    ...pendingPayload,
    handled_at: nowIso(),
    open_ok: open.ok,
    open_result: open?.json?.out || open?.json || open.raw || null,
  };
  if (open.ok && open?.json?.out?.ok !== false) {
    finalizeAuditorPendingMarker({ pendingPath, suffix: "handled", payload });
    return true;
  }
  finalizeAuditorPendingMarker({ pendingPath, suffix: "failed", payload });
  return false;
}

function markIncidentEnvironmentNotRecoverable({ pending, reason }) {
  try {
    const incidentPath = pending && pending.incidentPath ? String(pending.incidentPath) : "";
    if (!incidentPath) return false;
    const resultPath = incidentResultPathFromIncidentPath(incidentPath);
    const prev = readJsonBestEffort(resultPath) || {};
    const next = {
      ...(prev && typeof prev === "object" ? prev : {}),
      fix_status: "failed",
      fix_error: String(reason || "environment_not_recoverable"),
      recovery_status: "environment_not_recoverable",
      crisis_lane: "environment_not_recoverable",
      corrector_preflight: {
        ok: false,
        checked_at: nowIso(),
        lane: "environment_not_recoverable",
        reasons: ["app_server_unhealthy"],
      },
      updated_at: nowIso(),
    };
    writeJsonAtomic(resultPath, next);
    return true;
  } catch {
    return false;
  }
}

function isCorrectorFlowActive(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  const developerStatus = String(row?.developerStatus || "").trim().toLowerCase();
  const lastWhere = String(row?.lastError?.where || "").trim().toLowerCase();
  if (developerStatus === "auto_fixing") return true;
  if (lastWhere === "corrector/external_pending" || lastWhere === "corrector/recovery_pending" || lastWhere === "corrector/restart_required") return true;
  return status === "implementing" && developerStatus === "auto_fixing";
}

function canAttemptAuditorForRow(row) {
  if (isCorrectorFlowActive(row)) return false;
  if (isTerminalOrPausedStatus(row?.status)) return false;
  if (row?.activeTurn && typeof row.activeTurn === "object") return false;
  return true;
}

function normalizeRunStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function parseIsoToMs(value) {
  if (!value) return NaN;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : NaN;
}

function isWaitingJob(row) {
  const status = normalizeRunStatus(row?.status);
  const developerStatus = normalizeRunStatus(row?.developerStatus);
  return status === "waiting_job" || developerStatus === "waiting_job";
}

function isTerminalOrPausedStatus(status) {
  return ["paused", "stopped", "failed", "canceled", "completed"].includes(normalizeRunStatus(status));
}

function isActiveStatus(status) {
  return ["planning", "implementing", "reviewing", "waiting_job"].includes(normalizeRunStatus(status));
}

function isIncidentLikeWhere(where) {
  const w = String(where || "").trim().toLowerCase();
  if (!w) return false;
  if (w === "pause" || w === "stop" || w === "manager/user_command") return false;
  if (w === "corrector/recovery_pending" || w === "corrector/restart_required") return false;
  return true;
}

function auditorBackoffMsFromHealthyStreak(healthyStreak, basePollMs) {
  const base = Math.max(60_000, Math.floor(Number(basePollMs) || 15 * 60 * 1000));
  if (healthyStreak >= 12) return base * 8;
  if (healthyStreak >= 6) return base * 4;
  if (healthyStreak >= 3) return base * 2;
  return base;
}

function getExpectedMinutesExceededWake(row, { nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const activeJob = row?.activeJob && typeof row.activeJob === "object" ? row.activeJob : null;
  if (!activeJob) return null;
  const expectedMinutes = Number(activeJob.expectedMinutes ?? activeJob.expected_minutes);
  if (!Number.isFinite(expectedMinutes) || expectedMinutes < 0) return null;
  const startedAtMs = parseIsoToMs(activeJob.startedAt || activeJob.started_at);
  if (!Number.isFinite(startedAtMs)) return null;
  const thresholdMs = startedAtMs + expectedMinutes * 60_000;
  if (!Number.isFinite(thresholdMs) || now < thresholdMs) return null;
  return {
    jobId: activeJob.jobId ? String(activeJob.jobId) : null,
    expectedMinutes,
    thresholdMs,
    elapsedMinutes: Math.max(0, Math.round((now - startedAtMs) / 60000)),
  };
}

function reconcileAuditorScheduleEntry(prev, row, { nowMs, basePollMs, serverEpoch } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const currentStatus = normalizeRunStatus(row?.status);
  const currentDeveloperStatus = normalizeRunStatus(row?.developerStatus);
  const currentTaskId = row?.currentTaskId ? String(row.currentTaskId) : null;
  const currentLastErrorWhere = row?.lastError?.where ? String(row.lastError.where) : null;
  const overExpectedWake = getExpectedMinutesExceededWake(row, { nowMs: now });
  const overExpectedWakeKey = overExpectedWake?.jobId && Number.isFinite(overExpectedWake?.thresholdMs)
    ? `${overExpectedWake.jobId}:${overExpectedWake.thresholdMs}`
    : null;
  const next = prev
    ? { ...prev }
    : {
        healthyStreak: 0,
        lastAuditAtMs: 0,
        nextDueAtMs: now + basePollMs,
      };
  const resetReasons = [];

  if (!prev) {
    resetReasons.push("new_run");
  } else {
    if (Number(prev.serverEpoch || 0) !== Number(serverEpoch || 0)) resetReasons.push("server_restart");
    if ((prev.currentTaskId || null) !== currentTaskId) resetReasons.push("task_changed");
    if (!prev.waitingJob && isWaitingJob(row)) resetReasons.push("entered_waiting_job");
    if (isTerminalOrPausedStatus(prev.status) && isActiveStatus(currentStatus)) resetReasons.push("run_resumed");
    if ((prev.lastErrorWhere || null) !== (currentLastErrorWhere || null) && isIncidentLikeWhere(currentLastErrorWhere)) {
      resetReasons.push("new_incident");
    }
  }

  if (resetReasons.length) {
    next.healthyStreak = 0;
    next.nextDueAtMs = now + basePollMs;
    next.lastResetAtMs = now;
    next.lastResetReasons = resetReasons.slice(0, 8);
    // If an audit was already overdue while the run stayed active, do not lose it on
    // a mid-run reset like implementing -> waiting_job; trigger as soon as the turn clears.
    if (
      prev &&
      !isTerminalOrPausedStatus(prev.status) &&
      !isTerminalOrPausedStatus(currentStatus) &&
      Number(prev.nextDueAtMs || 0) > 0 &&
      Number(prev.nextDueAtMs || 0) <= now
    ) {
      next.nextDueAtMs = now;
    }
  }

  next.runId = row?.runId ? String(row.runId) : prev?.runId || null;
  next.serverEpoch = Number(serverEpoch || 0);
  next.status = currentStatus;
  next.developerStatus = currentDeveloperStatus;
  next.currentTaskId = currentTaskId;
  next.waitingJob = isWaitingJob(row);
  next.lastErrorWhere = currentLastErrorWhere;
  next.updatedAt = row?.updatedAt ? String(row.updatedAt) : null;
  next.overExpectedWakeKey = overExpectedWakeKey;

  if (overExpectedWakeKey && prev?.overExpectedWakeKey !== overExpectedWakeKey) {
    next.healthyStreak = 0;
    next.nextDueAtMs = now;
    next.lastResetAtMs = now;
    next.lastResetReasons = [...(next.lastResetReasons || []), "expected_minutes_exceeded"].slice(-8);
    resetReasons.push("expected_minutes_exceeded");
  }

  return { entry: next, resetReasons };
}

function shouldRunAuditorForEntry(entry, { nowMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (!entry) return false;
  return now >= Number(entry.nextDueAtMs || 0);
}

function applyAuditorOutcomeToEntry(entry, snapshot, { nowMs, basePollMs, observedAtMs } = {}) {
  const now = Number.isFinite(nowMs) ? nowMs : Date.now();
  const auditAtMs = Number.isFinite(observedAtMs) && observedAtMs > 0 ? observedAtMs : snapshotAuditAtMs(snapshot) || now;
  const next = entry ? { ...entry } : { healthyStreak: 0 };
  const conclusion = String(snapshot?.conclusion || "").trim().toLowerCase();
  next.lastAuditAtMs = auditAtMs;
  next.lastConclusion = conclusion || null;
  next.healthyStreak = conclusion === "healthy" ? Number(next.healthyStreak || 0) + 1 : 0;
  next.nextDueAtMs = now + auditorBackoffMsFromHealthyStreak(next.healthyStreak, basePollMs);
  return next;
}

function readJsonBestEffort(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function httpJson({ method, baseUrl, urlPath, body, timeoutMs = 30_000 }) {
  return new Promise((resolve) => {
    const u = new URL(urlPath, baseUrl);
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request(
      {
        method,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json; charset=utf-8", "content-length": String(payload.length) }
          : { "content-type": "application/json; charset=utf-8" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += Buffer.isBuffer(c) ? c.toString("utf8") : String(c);
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {
            parsed = null;
          }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, json: parsed, raw: data });
        });
      },
    );
    req.on("error", (e) => resolve({ ok: false, status: 0, json: null, raw: String(e?.message || e) }));
    req.on("timeout", () => {
      try {
        req.destroy(new Error("timeout"));
      } catch {
        // ignore
      }
    });
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForHealthy({ baseUrl, deadlineMs }) {
  const deadlineAt = Date.now() + deadlineMs;
  while (Date.now() < deadlineAt) {
    const r = await httpJson({ method: "GET", baseUrl, urlPath: "/health", timeoutMs: 5_000 });
    if (r.ok) return true;
    await sleep(500);
  }
  return false;
}

function startServerWithRestart({ rootDir, dataDir, env, onSpawn, onRestart } = {}) {
  const serverPath = path.join(rootDir, "server", "index.js");
  const restartReqPath = path.join(dataDir, "auto_resume", "restart_request.json");

  function spawnOnce() {
    console.log("[GUARDIAN] Starting Antidex server...");
    const child = spawn("node", [serverPath], { stdio: "inherit", env });
    if (typeof onSpawn === "function") {
      try {
        onSpawn({ pid: child.pid || null, at: nowIso() });
      } catch {
        // ignore
      }
    }

    child.on("exit", (code) => {
      if (code === 42) {
        const restartReq = readJsonBestEffort(restartReqPath);
        const at = new Date().toISOString();
        const runId = restartReq && restartReq.runId ? String(restartReq.runId) : null;
        const entry = {
          ts: at,
          reason: restartReq && restartReq.reason ? String(restartReq.reason) : "exit_42",
          runId,
          incident: restartReq && restartReq.incident ? String(restartReq.incident) : null,
          mode: restartReq && restartReq.mode ? String(restartReq.mode) : null,
          prev_pid: child.pid || null,
        };
        appendJsonlLine(path.join(dataDir, "restarts.jsonl"), entry);
        if (runId) {
          const runDir = path.join(dataDir, "runs", runId.replace(/[^a-zA-Z0-9_-]/g, "_"));
          appendJsonlLine(path.join(runDir, "restarts.jsonl"), entry);
        }
        try {
          if (fs.existsSync(restartReqPath)) fs.unlinkSync(restartReqPath);
        } catch {
          // ignore
        }
        console.log("[GUARDIAN] Server requested restart (exit code 42). Respawning...");
        if (typeof onRestart === "function") {
          try {
            onRestart(entry);
          } catch {
            // ignore
          }
        }
        setTimeout(spawnOnce, 1000);
        return;
      }

      console.log(`[GUARDIAN] Server exited with code ${code}. Terminating guardian.`);
      process.exit(code || 0);
    });

    child.on("error", (err) => {
      console.error("[GUARDIAN] Failed to spawn server:", err);
      process.exit(1);
    });

    return child;
  }

  const child = spawnOnce();
  return { child };
}

async function main() {
  const rootDir = path.join(__dirname, "..");
  const dataDir = process.env.ANTIDEX_DATA_DIR ? path.resolve(String(process.env.ANTIDEX_DATA_DIR)) : path.join(rootDir, "data");
  const port = Number(process.env.PORT || 3220);
  const baseUrl = process.env.ANTIDEX_BASE_URL ? String(process.env.ANTIDEX_BASE_URL) : `http://127.0.0.1:${port}`;
  const pollMs = (() => {
    const n = Number(process.env.ANTIDEX_GUARDIAN_POLL_MS || 1500);
    if (!Number.isFinite(n) || n < 250) return 1500;
    return Math.min(10_000, Math.floor(n));
  })();

  const pendingPath = path.join(dataDir, "external_corrector", "pending.json");
  const auditorPendingPath = path.join(dataDir, "external_auditor", "pending.json");
  ensureDir(path.dirname(pendingPath));
  ensureDir(path.dirname(auditorPendingPath));
  const auditorEnabled = String(process.env.ANTIDEX_EXTERNAL_AUDITOR || "").trim() === "1";
  const auditorMode = String(process.env.ANTIDEX_AUDITOR_MODE || "passive").trim().toLowerCase() === "enforcing" ? "enforcing" : "passive";
  const auditorBasePollMs = (() => {
    const n = Number(process.env.ANTIDEX_AUDITOR_POLL_MS || 15 * 60 * 1000);
    if (!Number.isFinite(n) || n < 60_000) return 15 * 60 * 1000;
    return Math.min(60 * 60 * 1000, Math.floor(n));
  })();
  const auditorSweepMs = (() => {
    const n = Number(process.env.ANTIDEX_AUDITOR_SWEEP_MS || 30_000);
    if (!Number.isFinite(n) || n < 5_000) return 30_000;
    return Math.min(60_000, Math.floor(n));
  })();
  const auditorHttpTimeoutMs = (() => {
    const n = Number(process.env.ANTIDEX_AUDITOR_HTTP_TIMEOUT_MS || 120_000);
    if (!Number.isFinite(n) || n < 15_000) return 120_000;
    return Math.min(5 * 60 * 1000, Math.floor(n));
  })();
  const auditorWhitelist = new Set(
    String(process.env.ANTIDEX_AUDITOR_ENFORCE_SIGNATURES || "job/active_reference_incoherent,review/stale_loop_high_confidence,ui_or_api/stale_projection")
      .split(",")
      .map((v) => String(v || "").trim())
      .filter(Boolean),
  );
  const guardianAuditorDebugLog = path.join(dataDir, "external_auditor", "guardian_debug.jsonl");
  appendJsonlLine(guardianAuditorDebugLog, {
    at: nowIso(),
    type: "auditor_config",
    enabled: auditorEnabled,
    mode: auditorMode,
    basePollMs: auditorBasePollMs,
    sweepMs: auditorSweepMs,
    httpTimeoutMs: auditorHttpTimeoutMs,
  });
  console.log(
    `[GUARDIAN] Auditor config: enabled=${auditorEnabled} mode=${auditorMode} basePollMs=${auditorBasePollMs} sweepMs=${auditorSweepMs} httpTimeoutMs=${auditorHttpTimeoutMs}`,
  );

  const env = {
    ...process.env,
    ANTIDEX_SUPERVISOR: "1",
    ANTIDEX_EXTERNAL_CORRECTOR: "1",
  };

  let serverEpoch = 0;
  const auditorScheduleByRun = new Map();
  const { child } = startServerWithRestart({
    rootDir,
    dataDir,
    env,
    onSpawn: () => {
      serverEpoch += 1;
    },
    onRestart: () => {
      for (const [runId, entry] of auditorScheduleByRun.entries()) {
        auditorScheduleByRun.set(runId, {
          ...entry,
          healthyStreak: 0,
          nextDueAtMs: Date.now() + auditorBasePollMs,
          lastResetAtMs: Date.now(),
          lastResetReasons: ["server_restart"],
          serverEpoch: serverEpoch + 1,
        });
      }
    },
  });

  const shutdown = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };
  process.on("SIGINT", () => {
    shutdown();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdown();
    process.exit(0);
  });

  let handling = false;
  let lastAttemptKey = null;
  let lastAttemptAtMs = 0;
  let lastAuditSweepAt = 0;

  while (true) {
    try {
      if (!handling && fs.existsSync(pendingPath)) {
        const pending = readJsonBestEffort(pendingPath);
        const runId = pending && pending.runId ? String(pending.runId) : null;
        const sig = pending && pending.sig ? String(pending.sig) : null;
        const incidentPath = pending && pending.incidentPath ? String(pending.incidentPath) : null;
        const key = `${runId || "?"}:${sig || "?"}:${incidentPath || "?"}`;

        if (lastAttemptKey !== key || Date.now() - lastAttemptAtMs >= Math.max(5000, pollMs * 3)) {
          lastAttemptKey = key;
          lastAttemptAtMs = Date.now();
          handling = true;
          console.log(`[GUARDIAN] External corrector pending detected (runId=${runId || "?"}, where=${pending?.where || "?"}).`);

          const healthy = await waitForHealthy({ baseUrl, deadlineMs: 30_000 });
          if (!healthy) {
            console.warn("[GUARDIAN] Server not healthy; classifying pending corrector as environment_not_recoverable.");
            markIncidentEnvironmentNotRecoverable({ pending, reason: "Guardian could not reach Antidex /health before corrector run." });
            finalizeAuditorPendingMarker({
              pendingPath,
              suffix: "handled_unrecoverable",
              payload: { ...(pending || {}), handled_at: nowIso(), lane: "environment_not_recoverable" },
            });
            handling = false;
            await sleep(pollMs);
            continue;
          }

          const out = await httpJson({ method: "POST", baseUrl, urlPath: "/api/corrector/run_pending", body: {} });
          if (!out.ok) {
            const msg = out?.json?.error || out.raw || `HTTP ${out.status}`;
            if (/No external corrector pending marker found/i.test(String(msg || ""))) {
              console.log("[GUARDIAN] Pending marker already handled.");
              handling = false;
              await sleep(pollMs);
              continue;
            }
            try {
              if (!fs.existsSync(pendingPath)) {
                console.log("[GUARDIAN] Pending marker missing after failed run_pending call; assuming handled/restart in progress.");
                handling = false;
                await sleep(pollMs);
                continue;
              }
            } catch {
              // ignore
            }
            console.warn(`[GUARDIAN] run_pending failed: ${msg}. Will retry later.`);
            handling = false;
            await sleep(pollMs);
            continue;
          }

          console.log("[GUARDIAN] Corrector triggered for pending incident.");

          if (runId) {
            const runs = await httpJson({ method: "GET", baseUrl, urlPath: "/api/pipeline/runs" });
            const r =
              runs.ok && runs.json && runs.json.runs
                ? runs.json.runs.find((x) => String(x?.runId || x?.id || "") === runId)
                : null;
            const status = r?.status ? String(r.status) : null;
            if (status === "stopped" || status === "failed") {
              console.log(`[GUARDIAN] Run is ${status}; calling Continue pipeline (autoRun=true).`);
              await httpJson({
                method: "POST",
                baseUrl,
                urlPath: "/api/pipeline/continue",
                body: { runId, autoRun: true, resumeSource: "guardian_post_corrector" },
              });
            }
          }

          handling = false;
        }
      } else if (!fs.existsSync(pendingPath)) {
        lastAttemptKey = null;
        lastAttemptAtMs = 0;
      }

      const correctorPendingExists = fs.existsSync(pendingPath);
      if (auditorEnabled && !handling && !correctorPendingExists && Date.now() - lastAuditSweepAt >= auditorSweepMs) {
        const healthy = await waitForHealthy({ baseUrl, deadlineMs: 10_000 });
        if (healthy) {
          const runs = await httpJson({ method: "GET", baseUrl, urlPath: "/api/pipeline/runs", timeoutMs: 15_000 });
          const rows = runs.ok && Array.isArray(runs?.json?.runs) ? runs.json.runs : [];
          const liveRunIds = new Set();
          for (const row of rows) {
            const runId = row?.runId ? String(row.runId) : null;
            if (!runId) continue;
            liveRunIds.add(runId);

            const reconciled = reconcileAuditorScheduleEntry(auditorScheduleByRun.get(runId) || null, row, {
              nowMs: Date.now(),
              basePollMs: auditorBasePollMs,
              serverEpoch,
            });
            let nextEntry = reconciled.entry;
            if (!auditorScheduleByRun.has(runId) || reconciled.resetReasons.length) {
              appendJsonlLine(guardianAuditorDebugLog, {
                at: nowIso(),
                type: "auditor_schedule_reset",
                runId,
                status: row?.status || null,
                developerStatus: row?.developerStatus || null,
                nextDueAt: Number(nextEntry.nextDueAtMs || 0),
                nextDueAtIso: Number.isFinite(Number(nextEntry.nextDueAtMs || 0)) ? new Date(Number(nextEntry.nextDueAtMs || 0)).toISOString() : null,
                reasons: reconciled.resetReasons,
              });
              console.log(
                `[GUARDIAN] Auditor schedule init/reset run=${runId} status=${row?.status || "-"} dev=${row?.developerStatus || "-"} nextDueAt=${new Date(
                  Number(nextEntry.nextDueAtMs || 0),
                ).toISOString()} reasons=${reconciled.resetReasons.join(",") || "none"}`,
              );
            }

            const persisted = readLatestPersistedAudit({ dataDir, runId });
            if (shouldConsumePersistedAudit(nextEntry, persisted)) {
              appendJsonlLine(guardianAuditorDebugLog, {
                at: nowIso(),
                type: "auditor_persisted_consumed",
                runId,
                generatedAt: persisted.snapshot?.generated_at || persisted.snapshot?.at || null,
                conclusion: persisted.snapshot?.conclusion || null,
              });
              console.log(
                `[GUARDIAN] Auditor consumed persisted report run=${runId} generated_at=${persisted.snapshot?.generated_at || persisted.snapshot?.at || "unknown"} conclusion=${persisted.snapshot?.conclusion || "unknown"}`,
              );
              nextEntry = applyAuditorOutcomeToEntry(nextEntry, persisted.snapshot, {
                nowMs: Date.now(),
                basePollMs: auditorBasePollMs,
                observedAtMs: persisted.auditAtMs,
              });
              auditorScheduleByRun.set(runId, nextEntry);
              await maybeHandleAuditorRecommendation({
                baseUrl,
                dataDir,
                runId,
                auditorMode,
                auditorWhitelist,
                snapshot: persisted.snapshot,
                pendingPath: auditorPendingPath,
              });
              continue;
            }

            auditorScheduleByRun.set(runId, nextEntry);

            if (!canAttemptAuditorForRow(row)) continue;
            if (!shouldRunAuditorForEntry(nextEntry, { nowMs: Date.now() })) continue;
            appendJsonlLine(guardianAuditorDebugLog, {
              at: nowIso(),
              type: "auditor_triggering",
              runId,
              status: row?.status || null,
              developerStatus: row?.developerStatus || null,
              dueAt: Number(nextEntry.nextDueAtMs || 0),
              dueAtIso: Number.isFinite(Number(nextEntry.nextDueAtMs || 0)) ? new Date(Number(nextEntry.nextDueAtMs || 0)).toISOString() : null,
            });
            console.log(
              `[GUARDIAN] Auditor triggering run=${runId} status=${row?.status || "-"} dev=${row?.developerStatus || "-"} dueAt=${new Date(
                Number(nextEntry.nextDueAtMs || 0),
              ).toISOString()}`,
            );

            const snapResp = await httpJson({
              method: "POST",
              baseUrl,
              urlPath: "/api/auditor/run",
              body: {
                runId,
                mode: auditorMode,
              },
              timeoutMs: auditorHttpTimeoutMs,
            });
            if (!snapResp.ok || !snapResp?.json?.snapshot) {
              appendJsonlLine(guardianAuditorDebugLog, {
                at: nowIso(),
                type: "auditor_http_failed",
                runId,
                status: snapResp.status || 0,
                error: snapResp.raw || null,
              });
              console.warn(`[GUARDIAN] Auditor HTTP call failed run=${runId}: ${snapResp.raw || `status=${snapResp.status}`}`);
              continue;
            }
            if (snapResp?.json?.out?.deferred) {
              appendJsonlLine(guardianAuditorDebugLog, {
                at: nowIso(),
                type: "auditor_deferred",
                runId,
              });
              console.log(`[GUARDIAN] Auditor deferred run=${runId}`);
              continue;
            }
            const snapshot = snapResp.json.snapshot;
            appendJsonlLine(guardianAuditorDebugLog, {
              at: nowIso(),
              type: "auditor_completed",
              runId,
              generatedAt: snapshot?.generated_at || snapshot?.at || null,
              conclusion: snapshot?.conclusion || null,
            });
            console.log(
              `[GUARDIAN] Auditor completed run=${runId} generated_at=${snapshot?.generated_at || snapshot?.at || "unknown"} conclusion=${snapshot?.conclusion || "unknown"}`,
            );
            auditorScheduleByRun.set(
              runId,
              applyAuditorOutcomeToEntry(auditorScheduleByRun.get(runId) || nextEntry, snapshot, {
                nowMs: Date.now(),
                basePollMs: auditorBasePollMs,
              }),
            );
            await maybeHandleAuditorRecommendation({
              baseUrl,
              dataDir,
              runId,
              auditorMode,
              auditorWhitelist,
              snapshot,
              pendingPath: auditorPendingPath,
            });
          }
          for (const runId of Array.from(auditorScheduleByRun.keys())) {
            if (!liveRunIds.has(runId)) auditorScheduleByRun.delete(runId);
          }
        }
        lastAuditSweepAt = Date.now();
      }

      await sleep(pollMs);
    } catch (e) {
      handling = false;
      console.warn("[GUARDIAN] Loop error:", e);
      await sleep(Math.max(1000, pollMs));
    }
  }
}

module.exports = {
  auditorBackoffMsFromHealthyStreak,
  reconcileAuditorScheduleEntry,
  shouldRunAuditorForEntry,
  applyAuditorOutcomeToEntry,
  canAttemptAuditorForRow,
  getExpectedMinutesExceededWake,
};

if (require.main === module) {
  main().catch((e) => {
    console.error("[GUARDIAN] Fatal:", e);
    process.exit(1);
  });
}
