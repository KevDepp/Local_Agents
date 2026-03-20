const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ANTIDEX_FAKE_CODEX = "1";

const { PipelineManager } = require("../server/pipelineManager");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-auditor-smoke-"));
  const dataDir = path.join(tmpRoot, "antidex-data");
  const projectDir = path.join(tmpRoot, "project");
  const tasksDir = path.join(projectDir, "data", "tasks");
  const turnMarkersDir = path.join(projectDir, "data", "turn_markers");
  const jobsDir = path.join(projectDir, "data", "jobs");
  const taskId = "T-001_demo";
  const taskDir = path.join(tasksDir, taskId);
  const runId = "run-auditor-smoke";
  const jobId = "job-demo-2026-03-15T00-00-00";
  const jobDir = path.join(jobsDir, jobId);
  const projectPipelineStatePath = path.join(projectDir, "data", "pipeline_state.json");
  const recoveryLogPath = path.join(projectDir, "data", "recovery_log.jsonl");

  ensureDir(path.join(projectDir, "doc"));
  ensureDir(taskDir);
  ensureDir(turnMarkersDir);
  ensureDir(jobDir);

  fs.writeFileSync(path.join(taskDir, "task.md"), `# ${taskId}\n`, "utf8");
  fs.writeFileSync(path.join(taskDir, "manager_instruction.md"), `# manager instruction\n`, "utf8");
  fs.writeFileSync(recoveryLogPath, "", "utf8");
  writeJson(projectPipelineStatePath, {
    run_id: runId,
    phase: "implementing",
    current_task_id: taskId,
    assigned_developer: "developer_codex",
    developer_status: "waiting_job",
    manager_decision: null,
    summary: "waiting for job",
    updated_at: new Date().toISOString(),
  });
  writeJson(path.join(jobDir, "job.json"), {
    job_id: jobId,
    run_id: runId,
    task_id: taskId,
    status: "running",
    pid: process.pid,
    started_at: new Date().toISOString(),
  });
  writeJson(path.join(jobDir, "result.json"), {
    status: "done",
    summary: "job finished successfully",
    at: new Date().toISOString(),
  });

  const prevEnv = {
    ANTIDEX_EXTERNAL_CORRECTOR: process.env.ANTIDEX_EXTERNAL_CORRECTOR,
    ANTIDEX_TEST_FAKE_CORRECTOR: process.env.ANTIDEX_TEST_FAKE_CORRECTOR,
    ANTIDEX_SUPERVISOR: process.env.ANTIDEX_SUPERVISOR,
  };
  const pipeline = new PipelineManager({ dataDir, rootDir: path.resolve(__dirname, "..") });
  try {
    pipeline._setRun(runId, {
      runId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "waiting_job",
      iteration: 0,
      cwd: projectDir,
      workspaceCwd: null,
      managerModel: "gpt-5.4",
      developerModel: "gpt-5.4",
      managerPreprompt: "",
      developerPreprompt: "",
      userPrompt: "(smoke)",
      threadPolicy: { manager: "reuse", developer_codex: "reuse", developer_antigravity: "reuse" },
      connectorBaseUrl: null,
      connectorNotify: false,
      connectorDebug: false,
      agConversationStarted: false,
      agRetryCounts: {},
      agForceNewThreadNextByTask: {},
      agReloadCounts: {},
      taskDispatchCounts: {},
      taskReviewCounts: {},
      managerThreadId: null,
      developerThreadId: null,
      developerThreadTaskId: null,
      managerRolloutPath: null,
      developerRolloutPath: null,
      logFiles: [],
      developerStatus: "waiting_job",
      managerDecision: null,
      projectManifestPath: path.join(projectDir, "data", "antidex", "manifest.json"),
      projectDocRulesPath: path.join(projectDir, "doc", "DOCS_RULES.md"),
      projectDocIndexPath: path.join(projectDir, "doc", "INDEX.md"),
      projectAgentsDir: path.join(projectDir, "agents"),
      projectManagerInstructionPath: path.join(projectDir, "agents", "manager.md"),
      projectDeveloperInstructionPath: path.join(projectDir, "agents", "developer_codex.md"),
      projectDeveloperAgInstructionPath: path.join(projectDir, "agents", "developer_antigravity.md"),
      projectAgCursorRulesPath: path.join(projectDir, "agents", "AG_cursorrules.md"),
      projectSpecPath: path.join(projectDir, "doc", "SPEC.md"),
      projectTodoPath: path.join(projectDir, "doc", "TODO.md"),
      projectTestingPlanPath: path.join(projectDir, "doc", "TESTING_PLAN.md"),
      projectDecisionsPath: path.join(projectDir, "doc", "DECISIONS.md"),
      projectGitWorkflowPath: path.join(projectDir, "doc", "GIT_WORKFLOW.md"),
      projectTasksDir: tasksDir,
      projectTurnMarkersDir: turnMarkersDir,
      projectMailboxDir: path.join(projectDir, "data", "mailbox"),
      projectJobsDir: jobsDir,
      projectUserCommandsDir: path.join(projectDir, "data", "user_commands"),
      projectPipelineStatePath,
      projectRecoveryLogPath: recoveryLogPath,
      currentTaskId: taskId,
      assignedDeveloper: "developer_codex",
      activeJobId: jobId,
      activeJob: { jobId, taskId, status: "running", pid: process.pid },
      lastJobId: jobId,
      pendingUserCommand: null,
      queuedUserCommand: null,
      userCommandHistory: [],
      todoProcessedMtimeMs: null,
      projectTodoFileMtimeMs: null,
      lastReconciledTodoFingerprint: null,
      lastError: null,
      activeTurn: null,
      monitorThreadId: null,
      monitorRolloutPath: null,
      enableCorrector: true,
      recovery: {
        active: false,
        status: null,
        lane: null,
        incidentPath: null,
        incidentSignature: null,
        incidentWhere: null,
        fixStatus: null,
        baseline: null,
        progress: null,
        correctorPreflight: null,
        resumePreflight: null,
        lastEvaluation: null,
      },
    });

    const initial = pipeline.getExternalAuditorSnapshot(runId);
    assert.equal(initial.schema, "antidex.external_auditor.v1");
    assert.equal(initial.local_revalidation?.performed, true);
    assert.equal(initial.conclusion, "incident_recommended");
    assert.equal(initial.recommendation?.where, "job/active_reference_incoherent");

    process.env.ANTIDEX_EXTERNAL_CORRECTOR = "1";
    const open = await pipeline.openAuditorRecommendationAsIncident({
      runId,
      recommendation: initial.recommendation,
      auditReportPath: path.join(tmpRoot, "AUD-test.json"),
      mode: "enforcing",
    });
    assert.equal(open.ok, true);
    assert.ok(fs.existsSync(path.join(dataDir, "external_corrector", "pending.json")));

    pipeline._updateRunRecovery(runId, {
      active: true,
      status: "verification_pending",
      lane: "auto_resume_safe",
      incidentPath: open.incidentPath,
      incidentSignature: initial.recommendation.signature,
      incidentWhere: initial.recommendation.where,
      fixStatus: "success",
      correctorPreflight: { ok: true, checked_at: new Date().toISOString() },
      baseline: pipeline._collectRecoveryBaseline(pipeline.getRun(runId)),
    });
    const recoveryStatusPath = path.join(dataDir, "external_auditor", runId, "recovery_status.json");
    assert.ok(fs.existsSync(recoveryStatusPath));
    const recoveryStatus = JSON.parse(fs.readFileSync(recoveryStatusPath, "utf8"));
    assert.equal(recoveryStatus.recovery_status, "verification_pending");

    const notCleared = pipeline.getExternalAuditorSnapshot(runId);
    assert.equal(notCleared.recovery?.status, "recovery_not_cleared");

    let run = pipeline.getRun(runId);
    run.activeJobId = null;
    run.activeJob = null;
    run.status = "implementing";
    run.developerStatus = "ongoing";
    pipeline._setRun(runId, run);

    const inconclusive = pipeline.getExternalAuditorSnapshot(runId);
    assert.equal(inconclusive.recovery?.status, "recovery_inconclusive");

    await sleep(25);
    fs.writeFileSync(path.join(turnMarkersDir, "turn-smoke.done"), "ok\n", "utf8");
    const ps = JSON.parse(fs.readFileSync(projectPipelineStatePath, "utf8"));
    ps.updated_at = new Date(Date.now() + 1000).toISOString();
    writeJson(projectPipelineStatePath, ps);
    run = pipeline.getRun(runId);
    run.iteration = 1;
    pipeline._setRun(runId, run);

    const cleared = pipeline.getExternalAuditorSnapshot(runId);
    assert.equal(cleared.recovery?.status, "recovery_cleared");
    assert.equal(cleared.recovery?.lane, "auto_resume_safe");

    pipeline._writeIncidentResult(open.incidentPath, {
      fix_status: "failed",
      recovery_status: "manager_action_required",
      updated_at: new Date().toISOString(),
    });
    pipeline._updateRunRecovery(runId, {
      active: true,
      status: "manager_action_required",
      lane: "manager_action_required",
      incidentPath: open.incidentPath,
      incidentSignature: initial.recommendation.signature,
      incidentWhere: initial.recommendation.where,
      fixStatus: "failed",
      baseline: null,
      progress: null,
      resumePreflight: null,
    });
    await sleep(25);
    fs.writeFileSync(path.join(turnMarkersDir, "turn-post-failed.done"), "ok\n", "utf8");
    const recoveredAfterFailedFix = pipeline.getExternalAuditorSnapshot(runId);
    assert.equal(recoveredAfterFailedFix.recovery?.status, "recovery_cleared");
    pipeline._persistExternalAuditorSnapshot(runId, { mode: "passive", snapshot: recoveredAfterFailedFix });
    const persistedRecovery = pipeline.getRun(runId).recovery;
    assert.equal(persistedRecovery?.active, false);
    assert.equal(persistedRecovery?.status, "recovery_cleared");
    assert.equal(persistedRecovery?.lane, "auto_resume_safe");
    assert.equal(persistedRecovery?.incidentPath, null);
    assert.equal(persistedRecovery?.fixStatus, null);
    assert.equal(persistedRecovery?.lastEvaluation?.status, "recovery_cleared");
    assert.equal(persistedRecovery?.lastEvaluation?.lane, "auto_resume_safe");
    assert.equal(persistedRecovery?.lastEvaluation?.fix_status, null);

    pipeline._updateRunRecovery(runId, {
      active: false,
      status: "recovery_cleared",
      lane: "manager_action_required",
      incidentPath: open.incidentPath,
      incidentSignature: initial.recommendation.signature,
      incidentWhere: initial.recommendation.where,
      fixStatus: "failed",
      progress: { observed: true, reasons: ["synthetic"] },
    });
    pipeline._persistExternalAuditorSnapshot(runId, { mode: "passive", snapshot: recoveredAfterFailedFix });
    const cleanedInactiveRecovery = pipeline.getRun(runId).recovery;
    assert.equal(cleanedInactiveRecovery?.active, false);
    assert.equal(cleanedInactiveRecovery?.status, "recovery_cleared");
    assert.equal(cleanedInactiveRecovery?.lane, "auto_resume_safe");
    assert.equal(cleanedInactiveRecovery?.incidentPath, null);
    assert.equal(cleanedInactiveRecovery?.fixStatus, null);

    pipeline._updateRunRecovery(runId, {
      active: false,
      status: "recovery_cleared",
      lane: "manager_action_required",
      incidentPath: open.incidentPath,
      incidentSignature: initial.recommendation.signature,
      incidentWhere: initial.recommendation.where,
      fixStatus: "failed",
      progress: { observed: true, reasons: ["synthetic"] },
      correctorPreflight: { ok: true, checked_at: new Date().toISOString(), lane: "manager_action_required" },
    });
    pipeline._persistExternalAuditorSnapshot(runId, {
      mode: "passive",
      snapshot: {
        schema: "antidex.external_auditor.v1",
        at: new Date().toISOString(),
        generated_at: new Date().toISOString(),
        run_id: runId,
        conclusion: "healthy",
        recommended_action: "none",
        recovery_status: "none",
        findings: [],
        recommendation: null,
        recovery: null,
      },
    });
    const canonicalizedClosedRecovery = pipeline.getRun(runId).recovery;
    assert.equal(canonicalizedClosedRecovery?.active, false);
    assert.equal(canonicalizedClosedRecovery?.status, "recovery_cleared");
    assert.equal(canonicalizedClosedRecovery?.lane, "auto_resume_safe");
    assert.equal(canonicalizedClosedRecovery?.incidentPath, null);
    assert.equal(canonicalizedClosedRecovery?.fixStatus, null);
    assert.equal(canonicalizedClosedRecovery?.correctorPreflight, null);
    assert.equal(canonicalizedClosedRecovery?.lastEvaluation?.lane, "auto_resume_safe");
    assert.equal(canonicalizedClosedRecovery?.lastEvaluation?.fix_status, null);

    pipeline._updateRunRecovery(runId, {
      active: true,
      status: "verification_pending",
      lane: "auto_resume_safe",
      incidentPath: open.incidentPath,
      incidentSignature: initial.recommendation.signature,
      incidentWhere: initial.recommendation.where,
      fixStatus: "success",
      correctorPreflight: { ok: true, checked_at: new Date().toISOString() },
      baseline: pipeline._collectRecoveryBaseline(pipeline.getRun(runId)),
    });
    run = pipeline.getRun(runId);
    run.activeTurn = { role: "manager", step: "reviewing" };
    pipeline._setRun(runId, run);
    const resumePreflight = pipeline._prepareRecoveryResume(runId, { source: "smoke" });
    assert.equal(resumePreflight.ok, false);
    assert.equal(resumePreflight.lane, "manager_action_required");

    const runId3 = "run-auditor-stale-projection";
    const staleTaskId = "T-003_stale_projection";
    const staleTaskDir = path.join(tasksDir, staleTaskId);
    const staleActiveJobId = "job-stale-current-2026-03-18T00-00-00";
    const staleOldJobId = "job-stale-old-2026-03-17T00-00-00";
    const staleJobDir = path.join(jobsDir, staleActiveJobId);
    const staleMonitorDir = path.join(staleJobDir, "monitor_reports");
    ensureDir(staleTaskDir);
    ensureDir(staleJobDir);
    ensureDir(staleMonitorDir);
    fs.writeFileSync(path.join(staleTaskDir, "task.md"), `# ${staleTaskId}\n`, "utf8");
    fs.writeFileSync(path.join(staleTaskDir, "manager_instruction.md"), "# manager instruction stale projection\n", "utf8");
    fs.writeFileSync(
      path.join(staleTaskDir, "dev_result.md"),
      `# ${staleTaskId}\n\nLong job running: \`${staleOldJobId}\`\n`,
      "utf8",
    );
    writeJson(projectPipelineStatePath, {
      run_id: runId3,
      phase: "dispatching",
      current_task_id: staleTaskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: `Long job restarted (${staleActiveJobId}).`,
      updated_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    writeJson(path.join(staleJobDir, "job.json"), {
      job_id: staleActiveJobId,
      run_id: runId3,
      task_id: staleTaskId,
      status: "running",
      pid: process.pid,
      started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    });
    writeJson(path.join(staleMonitorDir, "latest.json"), {
      status: "running",
      summary: "stale monitor snapshot",
      at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    });
    fs.utimesSync(
      path.join(staleMonitorDir, "latest.json"),
      new Date(Date.now() - 2 * 60 * 60 * 1000),
      new Date(Date.now() - 2 * 60 * 60 * 1000),
    );
    pipeline._setRun(runId3, {
      ...pipeline.getRun(runId),
      runId: runId3,
      status: "waiting_job",
      developerStatus: "waiting_job",
      currentTaskId: staleTaskId,
      activeJobId: staleActiveJobId,
      activeJob: {
        jobId: staleActiveJobId,
        taskId: staleTaskId,
        status: "running",
        pid: process.pid,
        lastMonitorAtIso: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      },
      lastJobId: staleActiveJobId,
      activeTurn: null,
      lastError: null,
      correctorIncidentCounts: {
        [`job/monitor_missed:${staleTaskId}:Long job monitor failed`]: 3,
      },
      correctorTotalCount: 3,
      recovery: {
        active: false,
        status: null,
        lane: null,
        incidentPath: null,
        incidentSignature: null,
        incidentWhere: null,
        fixStatus: null,
        baseline: null,
        progress: null,
        correctorPreflight: null,
        resumePreflight: null,
        lastEvaluation: null,
      },
    });
    const staleProjection = pipeline.getExternalAuditorSnapshot(runId3);
    assert.equal(staleProjection.conclusion, "incident_recommended");
    assert.equal(staleProjection.recommendation?.where, "ui_or_api/stale_projection");
    assert.ok(
      staleProjection.findings.some(
        (finding) => finding.code === "ui_or_api/stale_projection" && finding.automation === "auto_incident_candidate",
      ),
    );
    fs.rmSync(path.join(dataDir, "external_corrector", "pending.json"), { force: true });
    const staleOpen = await pipeline.openAuditorRecommendationAsIncident({
      runId: runId3,
      recommendation: staleProjection.recommendation,
      auditReportPath: path.join(tmpRoot, "AUD-stale-projection.json"),
      mode: "enforcing",
    });
    assert.equal(staleOpen.ok, true);
    assert.ok(fs.existsSync(path.join(dataDir, "external_corrector", "pending.json")));

    const runId2 = "run-auditor-generalist";
    const mismatchTaskId = "T-002_mismatch";
    const mismatchTaskDir = path.join(tasksDir, mismatchTaskId);
    ensureDir(mismatchTaskDir);
    fs.writeFileSync(path.join(mismatchTaskDir, "task.md"), `# ${mismatchTaskId}\n`, "utf8");
    fs.writeFileSync(path.join(mismatchTaskDir, "manager_instruction.md"), `# manager instruction mismatch\n`, "utf8");
    writeJson(projectPipelineStatePath, {
      run_id: runId2,
      phase: "implementing",
      current_task_id: "T-999_other",
      assigned_developer: "developer_codex",
      developer_status: "ongoing",
      manager_decision: null,
      summary: "mismatched projection for audit",
      updated_at: new Date().toISOString(),
    });
    pipeline._setRun(runId2, {
      ...pipeline.getRun(runId),
      runId: runId2,
      status: "implementing",
      developerStatus: "ongoing",
      currentTaskId: mismatchTaskId,
      activeJobId: null,
      activeJob: null,
      lastJobId: null,
      activeTurn: null,
      lastError: null,
      recovery: {
        active: false,
        status: null,
        lane: null,
        incidentPath: null,
        incidentSignature: null,
        incidentWhere: null,
        fixStatus: null,
        baseline: null,
        progress: null,
        correctorPreflight: null,
        resumePreflight: null,
        lastEvaluation: null,
      },
    });
    const generalist = pipeline.getExternalAuditorSnapshot(runId2);
    assert.equal(generalist.recommendation, null);
    assert.equal(generalist.recommended_action, "observe");
    assert.ok(generalist.findings.some((finding) => finding.code === "state/project_pipeline_state_mismatch"));
    assert.ok(generalist.findings.some((finding) => finding.automation === "report_only"));
    assert.ok(generalist.audit_context?.antidex?.docs?.spec);
    assert.equal(generalist.audit_context?.project?.current_task?.task_id, mismatchTaskId);
    pipeline._persistExternalAuditorSnapshot(runId2, {
      mode: "passive",
      snapshot: {
        ...generalist,
        memory_updates: [
          {
            transition: "observed",
            scope: "antidex",
            canonical_class: "state/project_pipeline_state_mismatch",
            summary: "Observed pipeline state mismatch between Antidex projection and project pipeline_state.",
            evidence: ["pipeline_state.json", "run.currentTaskId mismatch"],
            audit_report_path: path.join(dataDir, "external_auditor", runId2, "latest.json"),
          },
        ],
      },
    });
    const observedMemory = pipeline.getBugMemorySnapshot(runId2);
    assert.ok(observedMemory.antidex.recent_patterns.some((entry) => entry.canonical_class === "state/project_pipeline_state_mismatch"));
    assert.ok(observedMemory.antidex.recent_patterns.some((entry) => entry.lifecycle_status === "observed"));

    const normalizedObservationOnly = pipeline._normalizeExternalAuditorAgentReport(
      pipeline.getRun(runId2),
      {
        schema: "antidex.external_auditor.agent_report.v1",
        generated_at: new Date().toISOString(),
        run_id: runId2,
        conclusion: "recovery_cleared",
        confidence: "medium",
        summary: "Agent claims recovery cleared despite only reporting anomalies.",
        recommended_action: "keep_under_periodic_observation",
        recommendation: null,
        findings: [
          {
            code: "monitor/job_monitor_missed",
            severity: "warn",
            summary: "Monitor remains fragile.",
            evidence: ["agent_context.json: monitor stale"],
            why_it_matters: "The run is not fully healthy yet.",
            confidence: "medium",
          },
        ],
      },
      { mode: "passive", auditContext: {} },
    );
    assert.equal(normalizedObservationOnly.recovery, null);
    assert.equal(normalizedObservationOnly.recovery_status, "none");
    assert.equal(normalizedObservationOnly.conclusion, "suspicious");
    assert.equal(normalizedObservationOnly.recommended_action, "observe");
    assert.equal(normalizedObservationOnly.agent_report?.conclusion, "recovery_cleared");

    let staleTurnRun = pipeline.getRun(runId2);
    staleTurnRun.activeTurn = { role: "auditor", step: "audit", threadId: "thread-stale" };
    pipeline._setRun(runId2, staleTurnRun);
    staleTurnRun = pipeline.getRun(runId2);
    assert.equal(staleTurnRun.activeTurn, null);

    pipeline._active = { role: "developer_codex", step: "implementing" };
    const deferred = await pipeline.runExternalAuditorPass(runId2, { mode: "passive" });
    assert.equal(deferred.ok, true);
    assert.equal(deferred.deferred, true);
    assert.equal(deferred.snapshot.auditor_mode, "passive");
    assert.equal(deferred.snapshot.recommended_action, "observe");
    assert.ok(deferred.snapshot.findings.some((finding) => finding.code === "auditor/deferred_active_turn"));
    pipeline._active = null;

    let run2 = pipeline.getRun(runId2);
    const originalEnsureCodex = pipeline._ensureCodex.bind(pipeline);
    const originalEnsureThread = pipeline._ensureThread.bind(pipeline);
    const originalRunTurnWithHandshake = pipeline._runTurnWithHandshake.bind(pipeline);
    let ensureCodexCalls = 0;
    pipeline._ensureCodex = async (...args) => {
      ensureCodexCalls += 1;
      void args;
      return undefined;
    };
    pipeline._ensureThread = async () => "thread-auditor-smoke";
    pipeline._runTurnWithHandshake = async (opts) => {
      const reportDir = path.join(dataDir, "external_auditor", runId2);
      ensureDir(reportDir);
      const prompt = opts.buildPrompt({ run: pipeline.getRun(runId2), turnNonce: "turn-auditor-smoke", retryReason: null });
      if (!prompt.includes("agent_context.json")) {
        throw new Error("expected auditor prompt to read agent_context.json");
      }
      if (prompt.includes("doc/SPEC.md") || prompt.includes("doc/DECISIONS.md") || prompt.includes("doc/CORRECTOR_RUNBOOK.md")) {
        throw new Error("auditor prompt must rely on the compact context packet before broad doc rereads");
      }
      const context = JSON.parse(fs.readFileSync(path.join(reportDir, "agent_context.json"), "utf8"));
      if (!context.audit_context?.antidex?.docs_digest?.spec?.path) {
        throw new Error("expected auditor context packet to include Antidex SPEC digest metadata");
      }
      if (!context.audit_context?.project?.docs_digest?.todo?.path) {
        throw new Error("expected auditor context packet to include project TODO digest metadata");
      }
      if (!context.audit_context?.antidex?.bug_memory?.index_path) {
        throw new Error("expected auditor context packet to include Antidex bug memory metadata");
      }
      if (!context.audit_context?.project?.bug_memory?.index_path) {
        throw new Error("expected auditor context packet to include project bug memory metadata");
      }
      writeJson(path.join(reportDir, "agent_report.json"), {
        schema: "antidex.external_auditor.agent_report.v1",
        generated_at: new Date().toISOString(),
        run_id: runId2,
        conclusion: "healthy",
        confidence: "medium",
        summary: "Auditor agent completed normally.",
        recommended_action: "none",
        suggested_incident_where: null,
        suggested_incident_message: null,
        recommendation: null,
        findings: [],
        memory_updates: [
          {
            transition: "observed",
            scope: "project",
            canonical_class: "project/agent_memory_probe",
            summary: "Agent-authored memory update smoke probe.",
            evidence: ["agent_context.json"],
          },
        ],
      });
      fs.writeFileSync(path.join(reportDir, "agent_report.md"), "# Auditor\n\nHealthy.\n", "utf8");
      return { ok: true };
    };
    try {
      const activeAgentPass = await pipeline.runExternalAuditorPass(runId2, { mode: "passive" });
      assert.equal(activeAgentPass.ok, true);
      assert.equal(activeAgentPass.deferred, undefined);
      assert.equal(activeAgentPass.snapshot.recommended_action, "none");
      assert.equal(activeAgentPass.snapshot.conclusion, "healthy");
      const latestAuditPath = path.join(dataDir, "external_auditor", runId2, "latest.json");
      assert.ok(fs.existsSync(latestAuditPath));
      const latestAudit = JSON.parse(fs.readFileSync(latestAuditPath, "utf8"));
      assert.equal(latestAudit.conclusion, "healthy");
      assert.equal(latestAudit.auditor_mode, "passive");
      assert.equal(Array.isArray(latestAudit.memory_updates), true);
      assert.ok(ensureCodexCalls >= 1);
      const agentMemory = pipeline.getBugMemorySnapshot(runId2);
      assert.ok(agentMemory.project.recent_patterns.some((entry) => entry.canonical_class === "project/agent_memory_probe"));
    } finally {
      pipeline._ensureCodex = originalEnsureCodex;
      pipeline._ensureThread = originalEnsureThread;
      pipeline._runTurnWithHandshake = originalRunTurnWithHandshake;
    }

    fs.rmSync(path.join(dataDir, "bug_memory"), { recursive: true, force: true });
    fs.rmSync(path.join(projectDir, "data", "bug_memory"), { recursive: true, force: true });
    const runId4 = "run-auditor-memory-lifecycle";
    pipeline._setRun(runId4, {
      ...pipeline.getRun(runId),
      runId: runId4,
      status: "waiting_job",
      developerStatus: "waiting_job",
      currentTaskId: taskId,
      activeJobId: jobId,
      activeJob: { jobId, taskId, status: "running", pid: process.pid },
      lastJobId: jobId,
      activeTurn: null,
      lastError: null,
      recovery: {
        active: false,
        status: null,
        lane: null,
        incidentPath: null,
        incidentSignature: null,
        incidentWhere: null,
        fixStatus: null,
        baseline: null,
        progress: null,
        correctorPreflight: null,
        resumePreflight: null,
        lastEvaluation: null,
      },
    });
    const memoryObservedSnapshot = pipeline.getExternalAuditorSnapshot(runId4);
    pipeline._persistExternalAuditorSnapshot(runId4, {
      mode: "enforcing",
      snapshot: {
        ...memoryObservedSnapshot,
        memory_updates: [
          {
            transition: "observed",
            scope: "antidex",
            canonical_class: "job/active_reference_incoherent",
            signature: memoryObservedSnapshot.recommendation.signature,
            where: memoryObservedSnapshot.recommendation.where,
            summary: memoryObservedSnapshot.recommendation.explanation,
            evidence: memoryObservedSnapshot.recommendation.observed,
            audit_report_path: path.join(dataDir, "external_auditor", runId4, "latest.json"),
            automation: { status: "auto_actionable" },
          },
        ],
      },
    });
    let lifecycleMemory = pipeline.getBugMemorySnapshot(runId4);
    let lifecycleEntry = lifecycleMemory.antidex.recent_patterns.find((entry) => entry.canonical_class === "job/active_reference_incoherent");
    assert.equal(lifecycleEntry?.lifecycle_status, "observed");
    assert.equal(lifecycleEntry?.promotion_status, "auto_actionable");

    process.env.ANTIDEX_EXTERNAL_CORRECTOR = "1";
    delete process.env.ANTIDEX_SUPERVISOR;
    process.env.ANTIDEX_TEST_FAKE_CORRECTOR = "1";
    const memoryOpen = await pipeline.openAuditorRecommendationAsIncident({
      runId: runId4,
      recommendation: memoryObservedSnapshot.recommendation,
      auditReportPath: path.join(tmpRoot, "AUD-memory-lifecycle.json"),
      mode: "enforcing",
    });
    assert.equal(memoryOpen.ok, true);
    delete process.env.ANTIDEX_EXTERNAL_CORRECTOR;
    const memoryIncident = JSON.parse(fs.readFileSync(memoryOpen.incidentPath, "utf8"));
    const corrected = await pipeline._runCorrector(runId4, memoryOpen.incidentPath, memoryIncident);
    assert.equal(corrected, true);
    assert.ok(fs.existsSync(memoryIncident.corrector_memory_update_path));
    lifecycleMemory = pipeline.getBugMemorySnapshot(runId4);
    lifecycleEntry = lifecycleMemory.antidex.recent_patterns.find((entry) => entry.canonical_class === "job/active_reference_incoherent");
    assert.equal(lifecycleEntry?.lifecycle_status, "corrected");
    assert.ok(lifecycleEntry?.corrected_at);

    pipeline._updateRunRecovery(runId4, {
      active: true,
      status: "verification_pending",
      lane: "auto_resume_safe",
      incidentPath: memoryOpen.incidentPath,
      incidentSignature: memoryObservedSnapshot.recommendation.signature,
      incidentWhere: memoryObservedSnapshot.recommendation.where,
      fixStatus: "success",
      correctorPreflight: { ok: true, checked_at: new Date().toISOString() },
      baseline: pipeline._collectRecoveryBaseline(pipeline.getRun(runId4)),
    });
    let memoryRun = pipeline.getRun(runId4);
    memoryRun.activeJobId = null;
    memoryRun.activeJob = null;
    memoryRun.status = "implementing";
    memoryRun.developerStatus = "ongoing";
    memoryRun.iteration = 2;
    memoryRun.lastError = null;
    pipeline._setRun(runId4, memoryRun);
    await sleep(25);
    fs.writeFileSync(path.join(turnMarkersDir, "turn-memory.done"), "ok\n", "utf8");
    const psValidated = JSON.parse(fs.readFileSync(projectPipelineStatePath, "utf8"));
    psValidated.updated_at = new Date(Date.now() + 2000).toISOString();
    writeJson(projectPipelineStatePath, psValidated);
    const validatedSnapshot = pipeline.getExternalAuditorSnapshot(runId4);
    assert.equal(validatedSnapshot.recovery?.status, "recovery_cleared");
    pipeline._persistExternalAuditorSnapshot(runId4, {
      mode: "passive",
      snapshot: {
        ...validatedSnapshot,
        memory_updates: [
          {
            transition: "validated",
            scope: "antidex",
            canonical_class: "job/active_reference_incoherent",
            signature: memoryObservedSnapshot.recommendation.signature,
            where: memoryObservedSnapshot.recommendation.where,
            summary: "Recovery validated for active reference incoherence.",
            validation_evidence: [
              ...(validatedSnapshot.recovery?.healing?.reasons || []),
              ...(validatedSnapshot.recovery?.progress?.reasons || []),
            ],
            incident_path: memoryOpen.incidentPath,
            audit_report_path: path.join(dataDir, "external_auditor", runId4, "latest.json"),
          },
        ],
      },
    });
    lifecycleMemory = pipeline.getBugMemorySnapshot(runId4);
    lifecycleEntry = lifecycleMemory.antidex.recent_patterns.find((entry) => entry.canonical_class === "job/active_reference_incoherent");
    assert.equal(lifecycleEntry?.lifecycle_status, "validated");
    assert.ok(lifecycleEntry?.validated_at);
    assert.equal(lifecycleEntry?.promotion_status, "auto_actionable");

    memoryRun = pipeline.getRun(runId4);
    memoryRun.activeJobId = jobId;
    memoryRun.activeJob = { jobId, taskId, status: "running", pid: process.pid };
    memoryRun.status = "waiting_job";
    memoryRun.developerStatus = "waiting_job";
    memoryRun.recovery = {
      active: false,
      status: null,
      lane: null,
      incidentPath: null,
      incidentSignature: null,
      incidentWhere: null,
      fixStatus: null,
      baseline: null,
      progress: null,
      correctorPreflight: null,
      resumePreflight: null,
      lastEvaluation: null,
    };
    pipeline._setRun(runId4, memoryRun);
    const reopenedSnapshot = pipeline.getExternalAuditorSnapshot(runId4);
    pipeline._persistExternalAuditorSnapshot(runId4, {
      mode: "passive",
      snapshot: {
        ...reopenedSnapshot,
        memory_updates: [
          {
            transition: "reopened",
            scope: "antidex",
            canonical_class: "job/active_reference_incoherent",
            signature: memoryObservedSnapshot.recommendation.signature,
            where: memoryObservedSnapshot.recommendation.where,
            summary: "Active reference incoherence reappeared after prior correction/validation.",
            evidence: reopenedSnapshot.recommendation?.observed || [],
            incident_path: memoryOpen.incidentPath,
            audit_report_path: path.join(dataDir, "external_auditor", runId4, "latest.json"),
          },
        ],
      },
    });
    lifecycleMemory = pipeline.getBugMemorySnapshot(runId4);
    lifecycleEntry = lifecycleMemory.antidex.recent_patterns.find((entry) => entry.canonical_class === "job/active_reference_incoherent");
    assert.equal(lifecycleEntry?.lifecycle_status, "reopened");
    assert.ok(Number(lifecycleEntry?.reopen_count || 0) >= 1);

    const invalidCommit = pipeline._commitAgentBugMemoryUpdates(
      runId4,
      [
        {
          transition: "corrected",
          scope: "antidex",
          canonical_class: "state/should_be_rejected",
          summary: "auditor is not allowed to write corrected",
          audit_report_path: path.join(tmpRoot, "AUD-invalid.json"),
        },
      ],
      {
        sourceKind: "auditor",
        auditReportPath: path.join(tmpRoot, "AUD-invalid.json"),
      },
    );
    assert.equal(invalidCommit.committed, 0);
    assert.ok(invalidCommit.rejected_reasons.some((reason) => String(reason).includes("transition_not_allowed")));

    console.log("external-auditor smoke test: ok");
  } finally {
    clearInterval(pipeline._longJobTickInterval);
    if (prevEnv.ANTIDEX_EXTERNAL_CORRECTOR == null) delete process.env.ANTIDEX_EXTERNAL_CORRECTOR;
    else process.env.ANTIDEX_EXTERNAL_CORRECTOR = prevEnv.ANTIDEX_EXTERNAL_CORRECTOR;
    if (prevEnv.ANTIDEX_TEST_FAKE_CORRECTOR == null) delete process.env.ANTIDEX_TEST_FAKE_CORRECTOR;
    else process.env.ANTIDEX_TEST_FAKE_CORRECTOR = prevEnv.ANTIDEX_TEST_FAKE_CORRECTOR;
    if (prevEnv.ANTIDEX_SUPERVISOR == null) delete process.env.ANTIDEX_SUPERVISOR;
    else process.env.ANTIDEX_SUPERVISOR = prevEnv.ANTIDEX_SUPERVISOR;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
