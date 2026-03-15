const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ANTIDEX_FAKE_CODEX = process.env.ANTIDEX_FAKE_CODEX || "1";

const { PipelineManager } = require("../server/pipelineManager");

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + "\n", "utf8");
}

function setupProject(baseDir, { taskId, pipelineState, includeDevResult = true }) {
  const projectDir = path.join(baseDir, "project");
  const docDir = path.join(projectDir, "doc");
  const dataDir = path.join(projectDir, "data");
  const taskDir = path.join(dataDir, "tasks", taskId);

  fs.mkdirSync(docDir, { recursive: true });
  fs.mkdirSync(taskDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, "turn_markers"), { recursive: true });

  fs.writeFileSync(path.join(docDir, "TODO.md"), `- [ ] (developer_codex) ${taskId} - current task\n`, "utf8");
  fs.writeFileSync(path.join(taskDir, "task.md"), `# ${taskId}\n\ntask_kind: benchmark\n`, "utf8");
  fs.writeFileSync(path.join(taskDir, "manager_instruction.md"), `# Manager instruction - ${taskId}\n`, "utf8");
  fs.writeFileSync(
    path.join(taskDir, "manager_review.md"),
    `# Manager Review - ${taskId}\n\nDecision: **REWORK**\nReviewed_at: 2026-03-10T15:14:12.739Z\nTurn nonce: turn-test\n\nNext actions:\n- Retry developer on the same task.\n`,
    "utf8",
  );
  if (includeDevResult) fs.writeFileSync(path.join(taskDir, "dev_result.md"), "# Existing dev result\n", "utf8");

  const pipelineStatePath = path.join(dataDir, "pipeline_state.json");
  writeJson(pipelineStatePath, pipelineState);

  return {
    projectDir,
    pipelineStatePath,
    taskDir,
    todoPath: path.join(docDir, "TODO.md"),
    tasksDir: path.join(dataDir, "tasks"),
    turnMarkersDir: path.join(dataDir, "turn_markers"),
  };
}

async function runScenario({ reason, pipelineState, expectedDeveloperStatus, expectedSummary }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-rebase-"));
  const taskId = "T-006c_medium_baseline_fix";
  const dataDir = path.join(tmpRoot, "antidex-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const project = setupProject(tmpRoot, { taskId, pipelineState });
  const pm = new PipelineManager({ dataDir, rootDir: path.resolve(__dirname, "..") });
  clearInterval(pm._longJobTickInterval);

  const runId = `rebase-${reason}`;
  pm._state.setRun(runId, {
    runId,
    cwd: project.projectDir,
    status: "reviewing",
    iteration: 164,
    currentTaskId: taskId,
    assignedDeveloper: "developer_codex",
    developerStatus: "ready_for_review",
    managerDecision: null,
    projectTodoPath: project.todoPath,
    projectPipelineStatePath: project.pipelineStatePath,
    projectTasksDir: project.tasksDir,
    projectTurnMarkersDir: project.turnMarkersDir,
    projectRecoveryLogPath: path.join(project.projectDir, "data", "recovery_log.jsonl"),
    lastError: null,
    activeTurn: null,
  });

  await pm._forceRebaseToTodo(runId, { reason });

  const afterFile = JSON.parse(fs.readFileSync(project.pipelineStatePath, "utf8"));
  const afterRun = pm.getRun(runId);

  if (afterFile.developer_status !== expectedDeveloperStatus) {
    throw new Error(
      `${reason}: expected pipeline_state developer_status=${expectedDeveloperStatus}, got ${afterFile.developer_status || "(missing)"}`
    );
  }
  if (afterRun.developerStatus !== expectedDeveloperStatus) {
    throw new Error(`${reason}: expected run developerStatus=${expectedDeveloperStatus}, got ${afterRun.developerStatus || "(missing)"}`);
  }
  if (afterFile.manager_decision !== null) {
    throw new Error(`${reason}: expected pipeline_state manager_decision=null after rebase`);
  }
  if (expectedSummary && String(afterFile.summary || "") !== expectedSummary) {
    throw new Error(`${reason}: expected summary to stay '${expectedSummary}', got '${afterFile.summary || ""}'`);
  }
}

async function main() {
  await runScenario({
    reason: "manager_review",
    pipelineState: {
      run_id: "run-test",
      iteration: 164,
      phase: "dispatching",
      current_task_id: "T-006c_medium_baseline_fix",
      assigned_developer: "developer_codex",
      developer_status: "ready_for_review",
      manager_decision: null,
      summary: "REWORK T-006c_medium_baseline_fix: implement tie-break fix and rerun.",
      updated_at: "2026-03-10T15:14:12.739Z",
    },
    expectedDeveloperStatus: "ongoing",
    expectedSummary: "REWORK T-006c_medium_baseline_fix: implement tie-break fix and rerun.",
  });

  await runScenario({
    reason: "user_command_processed",
    pipelineState: {
      run_id: "run-test",
      iteration: 164,
      phase: "dispatching",
      current_task_id: "T-006c_medium_baseline_fix",
      assigned_developer: "developer_codex",
      developer_status: "blocked",
      manager_decision: null,
      summary: "User command processed.",
      updated_at: "2026-03-10T15:14:12.739Z",
    },
    expectedDeveloperStatus: "ready_for_review",
    expectedSummary: null,
  });

  console.log("rebase-manager-review-smoke-test: ok");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
