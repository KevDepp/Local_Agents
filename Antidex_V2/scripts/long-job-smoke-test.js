const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

process.env.ANTIDEX_FAKE_CODEX = "1";

const { PipelineManager } = require("../server/pipelineManager");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-longjob-"));
  const dataDir = path.join(fixtureRoot, "orchestrator-data");
  const workspace = path.join(fixtureRoot, "workspace");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });

  const pipeline = new PipelineManager({ dataDir, rootDir: root });

  try {
    const started = await pipeline.startPipeline({
      cwd: workspace,
      userPrompt: "Long job smoke test fixture.",
      managerModel: "gpt-5.4",
      developerModel: "gpt-5.4",
      managerPreprompt: "Bootstrap only.",
      developerPreprompt: "",
      autoRun: false,
    });
    const runId = started?.run?.runId || started?.runId;
    if (!runId) throw new Error("startPipeline did not return runId");

    const run = pipeline.getRun(runId);
    if (!run?.cwd) throw new Error("run cwd missing after bootstrap");
    const projectRoot = run.cwd;
    const taskId = "T-LONGJOB-SMOKE";
    const scriptsDir = path.join(projectRoot, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });

    const jsWorkerPath = path.join(scriptsDir, "emit-job.js");
    const cmdWorkerPath = path.join(scriptsDir, "emit-job.cmd");
    const jsFailWorkerPath = path.join(scriptsDir, "emit-job-fail.js");
    const cmdFailWorkerPath = path.join(scriptsDir, "emit-job-fail.cmd");
    fs.writeFileSync(
      jsWorkerPath,
      [
        'const fs = require("node:fs");',
        'function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\\n`, "utf8"); }',
        'if (process.env.ANTIDEX_JOB_STDOUT_LOG_PATH) fs.appendFileSync(process.env.ANTIDEX_JOB_STDOUT_LOG_PATH, "node-worker reached\\n", "utf8");',
        'if (process.env.ANTIDEX_JOB_HEARTBEAT_PATH) writeJson(process.env.ANTIDEX_JOB_HEARTBEAT_PATH, { at: new Date().toISOString(), status: "alive" });',
        'if (process.env.ANTIDEX_JOB_PROGRESS_PATH) writeJson(process.env.ANTIDEX_JOB_PROGRESS_PATH, { at: new Date().toISOString(), percent: 100, note: "smoke complete" });',
        'if (!process.env.ANTIDEX_JOB_RESULT_PATH) throw new Error("Missing ANTIDEX_JOB_RESULT_PATH");',
        'writeJson(process.env.ANTIDEX_JOB_RESULT_PATH, { status: "done", at: new Date().toISOString(), output: "reports/smoke.json", summary: { wins_by_seat: { "0": 2, "1": 1 }, illegal_moves: 0, generated_at: new Date().toISOString() } });',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      cmdWorkerPath,
      ['@echo off', 'echo cmd-wrapper reached', 'node "%~dp0emit-job.js"', "exit /b %ERRORLEVEL%", ""].join("\r\n"),
      "utf8",
    );
    fs.writeFileSync(
      jsFailWorkerPath,
      [
        'const fs = require("node:fs");',
        'function writeJson(filePath, value) { fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\\n`, "utf8"); }',
        'if (process.env.ANTIDEX_JOB_STDOUT_LOG_PATH) fs.appendFileSync(process.env.ANTIDEX_JOB_STDOUT_LOG_PATH, "node-worker fail path\\n", "utf8");',
        'if (process.env.ANTIDEX_JOB_HEARTBEAT_PATH) writeJson(process.env.ANTIDEX_JOB_HEARTBEAT_PATH, { at: new Date().toISOString(), status: "alive", stage: "failing" });',
        'if (process.env.ANTIDEX_JOB_PROGRESS_PATH) writeJson(process.env.ANTIDEX_JOB_PROGRESS_PATH, { at: new Date().toISOString(), percent: 25, note: "about to fail" });',
        'if (!process.env.ANTIDEX_JOB_RESULT_PATH) throw new Error("Missing ANTIDEX_JOB_RESULT_PATH");',
        'writeJson(process.env.ANTIDEX_JOB_RESULT_PATH, { status: "error", at: new Date().toISOString(), error: "intentional smoke failure" });',
        'process.exitCode = 1;',
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      cmdFailWorkerPath,
      ['@echo off', 'echo cmd-wrapper fail path', 'node "%~dp0emit-job-fail.js"', "exit /b %ERRORLEVEL%", ""].join("\r\n"),
      "utf8",
    );

    const taskDir = path.join(projectRoot, "data", "tasks", taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, "task.md"), `# ${taskId}\n`, "utf8");
    fs.writeFileSync(path.join(taskDir, "manager_instruction.md"), `# ${taskId}\nUse long job.\n`, "utf8");

    const projectStatePath = path.join(projectRoot, "data", "pipeline_state.json");
    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 1,
      phase: "dispatching",
      current_task_id: taskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: "Smoke test long job pending.",
      updated_at: new Date().toISOString(),
    });

    const liveRun = pipeline.getRun(runId);
    liveRun.currentTaskId = taskId;
    liveRun.assignedDeveloper = "developer_codex";
    liveRun.status = "waiting_job";
    liveRun.developerStatus = "waiting_job";
    pipeline._setRun(runId, liveRun);

    const helperPath = path.join(projectRoot, "tools", "antidex.js");
    if (!fs.existsSync(helperPath)) throw new Error("project helper tools/antidex.js missing");
    const helper = spawnSync(
      process.execPath,
      [helperPath, "job", "start", "--run-id", runId, "--task-id", taskId, "--expected-minutes", "1", "--script", ".\\scripts\\emit-job.cmd"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    if (helper.status !== 0) {
      throw new Error(`helper failed: ${helper.stderr || helper.stdout || `exit ${helper.status}`}`);
    }

    const requestsDir = path.join(projectRoot, "data", "jobs", "requests");
    const requestFiles = fs.readdirSync(requestsDir).filter((name) => /^REQ-.*\.json$/i.test(name));
    if (requestFiles.length !== 1) throw new Error(`expected 1 request, got ${requestFiles.length}`);
    const requestJsonPath = path.join(requestsDir, requestFiles[0]);
    const request = readJson(requestJsonPath);
    if (request.launch_kind !== "script") {
      throw new Error(`unexpected launch_kind for script request: ${request.launch_kind}`);
    }
    if (request.script_path !== ".\\scripts\\emit-job.cmd") {
      throw new Error(`unexpected script_path: ${request.script_path}`);
    }
    if (!Array.isArray(request.command_argv) || request.command_argv.length < 3) {
      throw new Error("request did not persist command_argv");
    }
    if (!/^cmd(?:\.exe)?$/i.test(String(request.command_argv[0]))) {
      throw new Error(`unexpected launcher: ${request.command_argv[0]}`);
    }

    await pipeline._tickLongJobs();
    let activeRun = pipeline.getRun(runId);
    const jobId = activeRun.activeJobId || activeRun.lastJobId;
    if (!jobId) throw new Error("long job did not start");
    const jobDir = path.join(projectRoot, "data", "jobs", jobId);
    const jobJsonPath = path.join(jobDir, "job.json");
    const stdoutLogPath = path.join(jobDir, "stdout.log");
    const resultPath = path.join(jobDir, "result.json");

    let completed = false;
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      await pipeline._tickLongJobs();
      activeRun = pipeline.getRun(runId);
      if (fs.existsSync(resultPath) && activeRun.status !== "waiting_job") {
        completed = true;
        break;
      }
    }
    if (!completed) throw new Error("long job did not complete in time");

    const job = readJson(jobJsonPath);
    if (!Array.isArray(job.command_argv) || job.command_argv.length < 3) {
      throw new Error("job.json missing command_argv");
    }
    if (!fs.existsSync(resultPath)) throw new Error("result.json missing");
    if (!fs.existsSync(stdoutLogPath)) throw new Error("stdout.log missing");
    const stdoutText = fs.readFileSync(stdoutLogPath, "utf8");
    if (!stdoutText.includes("cmd-wrapper reached")) throw new Error("stdout log missing cmd wrapper output");
    const result = readJson(resultPath);
    if (result.status !== "done") throw new Error(`unexpected result status: ${result.status}`);

    const finalRun = pipeline.getRun(runId);
    if (finalRun.status !== "implementing" || finalRun.developerStatus !== "ongoing") {
      throw new Error(`unexpected final run state: ${finalRun.status}/${finalRun.developerStatus}`);
    }

    const failTaskId = "T-LONGJOB-FAIL";
    const failTaskDir = path.join(projectRoot, "data", "tasks", failTaskId);
    fs.mkdirSync(failTaskDir, { recursive: true });
    fs.writeFileSync(path.join(failTaskDir, "task.md"), `# ${failTaskId}\n`, "utf8");
    fs.writeFileSync(path.join(failTaskDir, "manager_instruction.md"), `# ${failTaskId}\nUse long job failure fixture.\n`, "utf8");

    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 2,
      phase: "dispatching",
      current_task_id: failTaskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: "Smoke test failing long job pending.",
      updated_at: new Date().toISOString(),
    });

    const failRun = pipeline.getRun(runId);
    failRun.currentTaskId = failTaskId;
    failRun.assignedDeveloper = "developer_codex";
    failRun.status = "waiting_job";
    failRun.developerStatus = "waiting_job";
    pipeline._setRun(runId, failRun);

    const failHelper = spawnSync(
      process.execPath,
      [helperPath, "job", "start", "--run-id", runId, "--task-id", failTaskId, "--expected-minutes", "1", "--script", ".\\scripts\\emit-job-fail.cmd"],
      { cwd: projectRoot, encoding: "utf8" },
    );
    if (failHelper.status !== 0) {
      throw new Error(`fail helper failed: ${failHelper.stderr || failHelper.stdout || `exit ${failHelper.status}`}`);
    }

    await pipeline._tickLongJobs();
    let activeFailRun = pipeline.getRun(runId);
    const failJobId = activeFailRun.activeJobId || activeFailRun.lastJobId;
    if (!failJobId) throw new Error("failing long job did not start");
    const failJobDir = path.join(projectRoot, "data", "jobs", failJobId);
    const failResultPath = path.join(failJobDir, "result.json");
    const failMonitorPath = path.join(failJobDir, "monitor_reports", "latest.json");

    let failedHandled = false;
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      await pipeline._tickLongJobs();
      activeFailRun = pipeline.getRun(runId);
      if (fs.existsSync(failResultPath) && activeFailRun.status !== "waiting_job") {
        failedHandled = true;
        break;
      }
    }
    if (!failedHandled) throw new Error("failing long job was not handled in time");
    const failResult = readJson(failResultPath);
    if (failResult.status !== "error") throw new Error(`unexpected fail result status: ${failResult.status}`);
    if (fs.existsSync(failMonitorPath)) {
      const failMonitor = readJson(failMonitorPath);
      if (failMonitor.status !== "failed") throw new Error(`unexpected fail monitor status: ${failMonitor.status}`);
      if (failMonitor.decision !== "wake_developer_now") {
        throw new Error(`unexpected fail monitor decision: ${failMonitor.decision}`);
      }
    }
    const finalFailRun = pipeline.getRun(runId);
    if (finalFailRun.status !== "implementing" || finalFailRun.developerStatus !== "ongoing") {
      throw new Error(`unexpected final fail run state: ${finalFailRun.status}/${finalFailRun.developerStatus}`);
    }
    if (finalFailRun.activeJobId) throw new Error("failing long job should have been cleared from active state");

    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 3,
      phase: "dispatching",
      current_task_id: taskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: "Stale waiting_job after terminal result.",
      updated_at: new Date().toISOString(),
    });

    const staleCompletedRun = pipeline.getRun(runId);
    staleCompletedRun.currentTaskId = taskId;
    staleCompletedRun.assignedDeveloper = "developer_codex";
    staleCompletedRun.status = "stopped";
    staleCompletedRun.developerStatus = "waiting_job";
    staleCompletedRun.activeJobId = null;
    staleCompletedRun.activeJob = null;
    staleCompletedRun.lastJobId = jobId;
    pipeline._setRun(runId, staleCompletedRun);

    await pipeline.syncFromProjectState(runId);
    const reconciledProjectState = readJson(projectStatePath);
    if (reconciledProjectState.developer_status !== "ongoing") {
      throw new Error(`expected stale waiting_job reconciliation to set developer_status=ongoing, got ${reconciledProjectState.developer_status}`);
    }
    if (!String(reconciledProjectState.tests?.notes || "").includes(`Latest long job ${jobId} completed`)) {
      throw new Error(`expected terminal reconciliation to refresh tests.notes, got ${reconciledProjectState.tests?.notes}`);
    }
    const reconciledRun = pipeline.getRun(runId);
    if (reconciledRun.developerStatus !== "ongoing") {
      throw new Error(`expected reconciled run developerStatus=ongoing, got ${reconciledRun.developerStatus}`);
    }
    if (reconciledRun.status !== "stopped") {
      throw new Error(`expected reconciled run to preserve stopped status, got ${reconciledRun.status}`);
    }
    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 3,
      phase: "dispatching",
      current_task_id: taskId,
      assigned_developer: "developer_codex",
      developer_status: "blocked",
      manager_decision: null,
      summary: `Long job monitor failed for ${taskId}; terminal result already exists.`,
      updated_at: new Date().toISOString(),
    });
    const blockedByMonitorRun = pipeline.getRun(runId);
    blockedByMonitorRun.currentTaskId = taskId;
    blockedByMonitorRun.assignedDeveloper = "developer_codex";
    blockedByMonitorRun.status = "stopped";
    blockedByMonitorRun.developerStatus = "blocked";
    blockedByMonitorRun.lastError = {
      message: "Long job monitor failed: codex app-server is not running",
      at: new Date().toISOString(),
      where: "job/monitor_missed",
    };
    blockedByMonitorRun.activeJobId = null;
    blockedByMonitorRun.activeJob = null;
    blockedByMonitorRun.lastJobId = jobId;
    pipeline._setRun(runId, blockedByMonitorRun);

    await pipeline.syncFromProjectState(runId);
    const reconciledBlockedProjectState = readJson(projectStatePath);
    if (reconciledBlockedProjectState.developer_status !== "ongoing") {
      throw new Error(
        `expected terminal result reconciliation to clear blocked project state, got ${reconciledBlockedProjectState.developer_status}`
      );
    }
    const reconciledBlockedRun = pipeline.getRun(runId);
    if (reconciledBlockedRun.developerStatus !== "ongoing") {
      throw new Error(
        `expected terminal result reconciliation to clear blocked run state, got ${reconciledBlockedRun.developerStatus}`
      );
    }
    if (reconciledBlockedRun.lastError !== null) {
      throw new Error(`expected terminal result reconciliation to clear lastError, got ${JSON.stringify(reconciledBlockedRun.lastError)}`);
    }
    const reconciledJobState = pipeline.getLongJobState(runId);
    if (reconciledJobState.pipeline?.developerStatus !== "ongoing") {
      throw new Error(
        `expected jobs API pipeline.developerStatus=ongoing after terminal reconciliation, got ${reconciledJobState.pipeline?.developerStatus}`
      );
    }
    if (reconciledJobState.latest?.status !== "done") {
      throw new Error(`expected latest long-job display status=done, got ${reconciledJobState.latest?.status}`);
    }
    if (reconciledJobState.latest?.pidAlive !== false) {
      throw new Error(`expected latest long-job pidAlive=false, got ${reconciledJobState.latest?.pidAlive}`);
    }
    if (reconciledJobState.monitor?.status !== "done") {
      throw new Error(`expected synthetic monitor status=done, got ${reconciledJobState.monitor?.status}`);
    }
    const monitorMd = String(reconciledJobState.monitor_md || "");
    if (!monitorMd.trim()) {
      throw new Error("expected terminal monitor markdown for latest job");
    }
    if (pipeline._hasProtocolAwareLiveLongJob(reconciledRun, taskId)) {
      throw new Error("stale terminal job should not count as a live protocol-aware job");
    }
    const staleJobJson = readJson(jobJsonPath);
    staleJobJson.status = "running";
    writeJson(jobJsonPath, staleJobJson);
    const staleAutoRun = pipeline.getRun(runId);
    staleAutoRun.status = "implementing";
    staleAutoRun.developerStatus = "ongoing";
    staleAutoRun.currentTaskId = taskId;
    pipeline._setRun(runId, staleAutoRun);
    const autoPromoted = pipeline._autoPromoteDeveloperStatusFromEvidence(staleAutoRun, {
      taskId,
      reason: "stale_terminal_job_smoke",
    });
    if (!autoPromoted.ok) {
      throw new Error(`expected auto-promotion to succeed, got: ${autoPromoted.reason || "unknown reason"}`);
    }
    if (autoPromoted.developerStatus === "waiting_job") {
      throw new Error("stale terminal job must not auto-promote developer_status=waiting_job");
    }
    pipeline._autoRunLoops.set(runId, Promise.resolve());
    const originalRunAuto = pipeline.runAuto.bind(pipeline);
    let staleLoopRestarted = false;
    pipeline.runAuto = async (id) => {
      staleLoopRestarted = id === runId;
    };
    const restartedAuto = pipeline._startAutoRun(runId);
    pipeline.runAuto = originalRunAuto;
    if (!restartedAuto.started) {
      throw new Error(`expected stale auto-run loop to be replaced, got ${restartedAuto.reason || "unknown reason"}`);
    }
    if (!staleLoopRestarted) {
      throw new Error("expected stale auto-run loop replacement to invoke runAuto");
    }
    if (!pipeline._refreshTaskLongJobHistory(runId, { taskId })) {
      throw new Error("expected long-job history refresh to succeed");
    }
    const historyJsonPath = path.join(taskDir, "long_job_history.json");
    const historyMdPath = path.join(taskDir, "long_job_history.md");
    const outcomeJsonPath = path.join(taskDir, "latest_long_job_outcome.json");
    const outcomeMdPath = path.join(taskDir, "latest_long_job_outcome.md");
    if (!fs.existsSync(historyJsonPath) || !fs.existsSync(historyMdPath) || !fs.existsSync(outcomeJsonPath) || !fs.existsSync(outcomeMdPath)) {
      throw new Error("expected long-job history and latest outcome files to exist");
    }
    const history = readJson(historyJsonPath);
    if (history.schema !== "antidex.long_job.history.v1") {
      throw new Error(`unexpected history schema: ${history.schema}`);
    }
    const latestOutcome = readJson(outcomeJsonPath);
    if (latestOutcome.schema !== "antidex.long_job.outcome.v1") {
      throw new Error(`unexpected latest outcome schema: ${latestOutcome.schema}`);
    }
    if (latestOutcome.latest_terminal_attempt?.job_id !== jobId) {
      throw new Error(`expected latest outcome to reference ${jobId}, got ${latestOutcome.latest_terminal_attempt?.job_id}`);
    }
    if (!Array.isArray(latestOutcome.latest_terminal_attempt?.outputs) || !latestOutcome.latest_terminal_attempt.outputs.length) {
      throw new Error("expected latest outcome to retain parsed terminal outputs");
    }
    if (!Array.isArray(latestOutcome.key_results) || !latestOutcome.key_results.some((item) => String(item).includes("wins_by_seat"))) {
      throw new Error(`expected latest outcome key_results to include wins_by_seat, got ${JSON.stringify(latestOutcome.key_results)}`);
    }
    if (!Array.isArray(history.attempts) || !history.attempts.length) {
      throw new Error("expected long-job history to contain attempts");
    }
    if (history.attempts[0].latest_monitor?.status !== "done") {
      throw new Error(`expected history latest monitor status=done, got ${history.attempts[0].latest_monitor?.status}`);
    }
    const developerPrompt = pipeline._buildDeveloperPrompt(reconciledRun, { turnNonce: "turn-smoke", taskIdOverride: taskId });
    const outcomeNeedle = `- data/tasks/${taskId}/latest_long_job_outcome.md`;
    const managerInstructionNeedle = `- data/tasks/${taskId}/manager_instruction.md`;
    const outcomeIdx = developerPrompt.indexOf(outcomeNeedle);
    const managerInstructionIdx = developerPrompt.indexOf(managerInstructionNeedle);
    if (outcomeIdx === -1 || managerInstructionIdx === -1 || outcomeIdx > managerInstructionIdx) {
      throw new Error("expected developer prompt to prioritize latest_long_job_outcome.md before manager_instruction.md");
    }
    await pipeline.stopPipeline(runId);
    const resumePacketPath = pipeline.getRun(runId)?.projectResumePackets?.developer_codex;
    if (!resumePacketPath || !fs.existsSync(resumePacketPath)) {
      throw new Error("expected developer resume packet after stop");
    }
    const resumePacketText = fs.readFileSync(resumePacketPath, "utf8");
    const resumeOutcomeIdx = resumePacketText.indexOf(outcomeNeedle);
    const resumeManagerInstructionIdx = resumePacketText.indexOf(managerInstructionNeedle);
    if (resumeOutcomeIdx === -1 || resumeManagerInstructionIdx === -1 || resumeOutcomeIdx > resumeManagerInstructionIdx) {
      throw new Error("expected developer resume packet to prioritize latest_long_job_outcome.md before manager_instruction.md");
    }
    fs.writeFileSync(
      path.join(taskDir, "manager_review.md"),
      [
        `# Manager Review - ${taskId}`,
        "",
        "Decision: **REWORK**",
        "Reviewed_at: 2026-03-11T12:00:00.000Z",
        "Turn nonce: turn-test",
        "",
        "Reasons (short):",
        `- See ${jobId}`,
        "",
        "Rerun justification:",
        "- Real code changed since the previous run.",
        "",
        "Rework request:",
        "1) Modify the algorithm.",
        "",
        "Next actions:",
        "- Relaunch after the fix.",
        "",
      ].join("\n"),
      "utf8",
    );
    pipeline._refreshTaskLongJobHistory(runId, { taskId });
    const historyAfterReview = readJson(historyJsonPath);
    if (historyAfterReview.latest_manager_review?.decision !== "REWORK") {
      throw new Error(`expected history latest manager review decision=REWORK, got ${historyAfterReview.latest_manager_review?.decision}`);
    }
    if (!historyAfterReview.attempts.some((attempt) => attempt.latest_manager_review?.decision === "REWORK")) {
      throw new Error("expected at least one attempt to be linked to the latest manager review");
    }

    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 4,
      phase: "dispatching",
      current_task_id: taskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: "Active turn should block stale waiting_job reconciliation.",
      updated_at: new Date().toISOString(),
    });
    const guardedRun = pipeline.getRun(runId);
    guardedRun.currentTaskId = taskId;
    guardedRun.assignedDeveloper = "developer_codex";
    guardedRun.status = "implementing";
    guardedRun.developerStatus = "ongoing";
    guardedRun.lastJobId = jobId;
    guardedRun.activeTurn = { role: "developer", step: "implementing", threadId: "T", turnId: "TURN" };
    pipeline._setRun(runId, guardedRun);
    await pipeline.syncFromProjectState(runId);
    const guardedProjectState = readJson(projectStatePath);
    if (guardedProjectState.developer_status !== "waiting_job") {
      throw new Error(`active turn should prevent stale waiting_job rewrite, got ${guardedProjectState.developer_status}`);
    }

    const threePTaskId = "T-LONGJOB-3P-GUARD";
    const threePTaskDir = path.join(projectRoot, "data", "tasks", threePTaskId);
    fs.mkdirSync(threePTaskDir, { recursive: true });
    fs.writeFileSync(
      path.join(threePTaskDir, "task.md"),
      [
        `# ${threePTaskId}`,
        "",
        "task_kind: ai_baseline_fix",
        "",
        "Definition of Done:",
        "- Produce `reports/easy_vs_easy_sanity_3p.json`.",
        "- Produce `reports/medium_vs_medium_sanity_3p.json`.",
        "",
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(
      path.join(threePTaskDir, "manager_instruction.md"),
      [
        `# ${threePTaskId}`,
        "",
        "- Run the EASY 3p control first.",
        "- Do not start or rerun any MEDIUM jobs until `reports/easy_vs_easy_sanity_3p.json` exists.",
        "- Required artifacts: `reports/easy_vs_easy_sanity_3p.json`, `reports/medium_vs_medium_sanity_quick_3p.json`, `reports/medium_vs_medium_sanity_3p.json`.",
        "",
      ].join("\n"),
      "utf8",
    );
    writeJson(projectStatePath, {
      run_id: runId,
      iteration: 5,
      phase: "dispatching",
      current_task_id: threePTaskId,
      assigned_developer: "developer_codex",
      developer_status: "waiting_job",
      manager_decision: null,
      summary: "3p task should reject 2p or premature medium jobs.",
      updated_at: new Date().toISOString(),
    });
    const guardedThreePRun = pipeline.getRun(runId);
    guardedThreePRun.currentTaskId = threePTaskId;
    guardedThreePRun.assignedDeveloper = "developer_codex";
    guardedThreePRun.status = "waiting_job";
    guardedThreePRun.developerStatus = "waiting_job";
    pipeline._setRun(runId, guardedThreePRun);

    const mismatch = pipeline._validateLongJobRequestAgainstTask(guardedThreePRun, {
      taskDir: threePTaskDir,
      taskId: threePTaskId,
      requestValue: {
        launch_kind: "script",
        script_path: ".\\scripts\\medium_sanity_quick_2p_job.cmd",
      },
    });
    if (mismatch.ok || !/scoped to 3p/i.test(String(mismatch.reason || ""))) {
      throw new Error(`expected 3p task to reject 2p long job wrapper, got: ${mismatch.reason || "ok"}`);
    }
    const prematureMedium = pipeline._validateLongJobRequestAgainstTask(guardedThreePRun, {
      taskDir: threePTaskDir,
      taskId: threePTaskId,
      requestValue: {
        launch_kind: "script",
        script_path: ".\\scripts\\medium_sanity_job.cmd",
      },
    });
    if (prematureMedium.ok || !/easy 3p control/i.test(String(prematureMedium.reason || ""))) {
      throw new Error(`expected 3p task to require easy control before medium jobs, got: ${prematureMedium.reason || "ok"}`);
    }

    console.log("OK");
  } finally {
    clearInterval(pipeline._longJobTickInterval);
    if (process.env.KEEP_TEST_FIXTURE === "1") {
      console.log(`Keeping fixture at ${fixtureRoot}`);
    } else {
      try {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});
