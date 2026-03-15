const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.ANTIDEX_FAKE_CODEX = process.env.ANTIDEX_FAKE_CODEX || "1";

const { PipelineManager } = require("../server/pipelineManager");

function write(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text, "utf8");
}

function setMtime(filePath, date) {
  fs.utimesSync(filePath, date, date);
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "antidex-outcome-rework-"));
  const dataDir = path.join(tmpRoot, "orchestrator-data");
  const projectDir = path.join(tmpRoot, "project");
  const taskId = "T-006c_medium_baseline_fix";
  const taskDir = path.join(projectDir, "data", "tasks", taskId);
  const reportsDir = path.join(projectDir, "reports");

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(reportsDir, { recursive: true });

  const pm = new PipelineManager({ dataDir, rootDir: path.resolve(__dirname, "..") });
  clearInterval(pm._longJobTickInterval);

  try {
    write(
      path.join(taskDir, "task.md"),
      [
        `# ${taskId}`,
        "",
        "task_kind: ai_baseline_fix",
        "",
        "## Definition of Done (DoD)",
        "- Regenerate `reports/medium_vs_medium_sanity.json`.",
        "",
      ].join("\n"),
    );
    write(
      path.join(taskDir, "manager_instruction.md"),
      [
        `# Manager instruction - ${taskId}`,
        "",
        "- Proof artifact: `reports/medium_vs_medium_sanity.json`",
        "",
      ].join("\n"),
    );
    write(
      path.join(taskDir, "manager_review.md"),
      [
        `# Manager Review - ${taskId}`,
        "",
        "Decision: **REWORK**",
        "Reviewed_at: 2026-03-10T16:11:14.472Z",
        "Turn nonce: turn-test",
        "",
        "Reasons (short):",
        "- Existing report `reports/medium_vs_medium_sanity.json` is stale and still 200/0.",
        "",
      ].join("\n"),
    );
    write(
      path.join(taskDir, "dev_result.md"),
      [
        "# dev result",
        "",
        "This file was rewritten without rerunning the proof artifact.",
        "",
        "Quick check report: `reports/medium_vs_medium_sanity_quick.json`",
      ].join("\n"),
    );
    write(path.join(reportsDir, "medium_vs_medium_sanity.json"), JSON.stringify({ meta: { generated_at: "2026-03-10T10:11:28.404Z" } }, null, 2));
    write(path.join(reportsDir, "medium_vs_medium_sanity_quick.json"), JSON.stringify({ meta: { generated_at: "2026-03-10T10:30:00.000Z" } }, null, 2));

    const reportPath = path.join(reportsDir, "medium_vs_medium_sanity.json");
    const quickReportPath = path.join(reportsDir, "medium_vs_medium_sanity_quick.json");
    const reviewPath = path.join(taskDir, "manager_review.md");
    const devResultPath = path.join(taskDir, "dev_result.md");
    setMtime(reportPath, new Date("2026-03-10T10:11:28.404Z"));
    setMtime(quickReportPath, new Date("2026-03-10T10:30:00.000Z"));
    setMtime(reviewPath, new Date("2026-03-10T16:11:14.472Z"));
    setMtime(devResultPath, new Date("2026-03-10T16:12:00.000Z"));

    const run = {
      runId: "outcome-rework-test",
      cwd: projectDir,
      workspaceCwd: projectDir,
      assignedDeveloper: "developer_codex",
    };

    const stale = pm._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
    if (stale.ok) {
      throw new Error("expected stale evidence validation to fail when only dev_result.md is newer");
    }
    const autoPromoteStale = pm._autoPromoteDeveloperStatusFromEvidence(
      { ...run, developerStatus: "ongoing", currentTaskId: taskId },
      { taskId, reason: "stale_outcome_rework_smoke" },
    );
    if (autoPromoteStale.ok) {
      throw new Error("expected auto-promotion to ready_for_review to fail on stale outcome-driven evidence");
    }

    setMtime(reportPath, new Date("2026-03-10T16:13:00.000Z"));
    const staleSemantic = pm._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
    if (staleSemantic.ok) {
      throw new Error("expected stale evidence validation to fail when report mtime is newer but meta.generated_at is still stale");
    }

    write(path.join(reportsDir, "medium_vs_medium_sanity.json"), JSON.stringify({ meta: { generated_at: "2026-03-10T16:13:00.000Z" } }, null, 2));
    setMtime(reportPath, new Date("2026-03-10T16:13:00.000Z"));
    const stillStaleViaDevResult = pm._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
    if (stillStaleViaDevResult.ok) {
      throw new Error("expected stale evidence validation to fail when dev_result.md still cites a stale quick report");
    }

    write(path.join(reportsDir, "medium_vs_medium_sanity_quick.json"), JSON.stringify({ meta: { generated_at: "2026-03-10T16:14:00.000Z" } }, null, 2));
    setMtime(quickReportPath, new Date("2026-03-10T16:14:00.000Z"));
    const fresh = pm._validateFreshEvidenceForOutcomeRework(run, { taskDir, taskId });
    if (!fresh.ok) {
      throw new Error(`expected fresh evidence validation to pass, got: ${fresh.reason || "unknown reason"}`);
    }
    const autoPromoteFresh = pm._autoPromoteDeveloperStatusFromEvidence(
      { ...run, developerStatus: "ongoing", currentTaskId: taskId },
      { taskId, reason: "fresh_outcome_rework_smoke" },
    );
    if (!autoPromoteFresh.ok || autoPromoteFresh.developerStatus !== "ready_for_review") {
      throw new Error(`expected auto-promotion to pass on fresh outcome-driven evidence, got: ${autoPromoteFresh.reason || autoPromoteFresh.developerStatus || "unknown"}`);
    }

    const task3pId = "T-006c_medium_baseline_fix_3p_scope";
    const task3pDir = path.join(projectDir, "data", "tasks", task3pId);
    write(
      path.join(task3pDir, "task.md"),
      [
        `# ${task3pId}`,
        "",
        "task_kind: ai_baseline_fix",
        "",
        "## Goal",
        "- Validate MEDIUM in 3 players.",
        "",
        "## Definition of Done (DoD)",
        "- Regenerate `reports/easy_vs_easy_sanity_3p.json`.",
        "- Regenerate `reports/medium_vs_medium_sanity_3p.json`.",
      ].join("\n"),
    );
    write(
      path.join(task3pDir, "manager_instruction.md"),
      [
        `# Manager instruction - ${task3pId}`,
        "",
        "Historical evidence only:",
        "- `reports/medium_vs_medium_sanity.json` (old 2p diagnostic, do not use as current gate)",
        "",
        "Required 3p evidence:",
        "- `reports/easy_vs_easy_sanity_3p.json`",
        "- `reports/medium_vs_medium_sanity_3p.json`",
      ].join("\n"),
    );
    write(
      path.join(task3pDir, "manager_review.md"),
      [
        `# Manager Review - ${task3pId}`,
        "",
        "Decision: **REWORK**",
        "Reviewed_at: 2026-03-13T01:00:00.000Z",
        "Turn nonce: turn-3p-scope",
      ].join("\n"),
    );
    write(
      path.join(task3pDir, "dev_result.md"),
      [
        "# dev result",
        "",
        "- `reports/easy_vs_easy_sanity_3p.json` meta.generated_at=2026-03-13T01:05:00.000Z",
        "- `reports/medium_vs_medium_sanity_3p.json` meta.generated_at=2026-03-13T01:06:00.000Z",
      ].join("\n"),
    );
    write(path.join(reportsDir, "medium_vs_medium_sanity.json"), JSON.stringify({ meta: { generated_at: "2026-03-10T10:11:28.404Z" } }, null, 2));
    write(path.join(reportsDir, "easy_vs_easy_sanity_3p.json"), JSON.stringify({ meta: { generated_at: "2026-03-13T01:05:00.000Z" } }, null, 2));
    write(path.join(reportsDir, "medium_vs_medium_sanity_3p.json"), JSON.stringify({ meta: { generated_at: "2026-03-13T01:06:00.000Z" } }, null, 2));

    const run3p = {
      runId: "outcome-rework-3p-scope",
      cwd: projectDir,
      workspaceCwd: projectDir,
      assignedDeveloper: "developer_codex",
    };
    const fresh3p = pm._validateFreshEvidenceForOutcomeRework(run3p, { taskDir: task3pDir, taskId: task3pId });
    if (!fresh3p.ok) {
      throw new Error(`expected 3p-scoped evidence validation to ignore stale 2p historical report, got: ${fresh3p.reason || "unknown reason"}`);
    }

    console.log("outcome-rework-evidence-smoke-test: ok");
  } finally {
    clearInterval(pm._longJobTickInterval);
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
