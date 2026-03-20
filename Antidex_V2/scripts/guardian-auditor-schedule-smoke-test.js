const assert = require("node:assert/strict");

const {
  auditorBackoffMsFromHealthyStreak,
  reconcileAuditorScheduleEntry,
  shouldRunAuditorForEntry,
  applyAuditorOutcomeToEntry,
  canAttemptAuditorForRow,
  getExpectedMinutesExceededWake,
} = require("./guardian");

function makeRow(overrides = {}) {
  return {
    runId: "run-schedule-smoke",
    status: "planning",
    developerStatus: "ongoing",
    currentTaskId: "T-001_demo",
    lastError: null,
    updatedAt: "2026-03-15T00:00:00.000Z",
    ...overrides,
  };
}

async function main() {
  const baseMs = 15 * 60 * 1000;

  assert.equal(auditorBackoffMsFromHealthyStreak(0, baseMs), 15 * 60 * 1000);
  assert.equal(auditorBackoffMsFromHealthyStreak(2, baseMs), 15 * 60 * 1000);
  assert.equal(auditorBackoffMsFromHealthyStreak(3, baseMs), 30 * 60 * 1000);
  assert.equal(auditorBackoffMsFromHealthyStreak(6, baseMs), 60 * 60 * 1000);
  assert.equal(auditorBackoffMsFromHealthyStreak(12, baseMs), 120 * 60 * 1000);

  let nowMs = 0;
  let entry = reconcileAuditorScheduleEntry(null, makeRow(), { nowMs, basePollMs: baseMs, serverEpoch: 1 }).entry;
  assert.equal(entry.nextDueAtMs, baseMs);
  assert.equal(shouldRunAuditorForEntry(entry, { nowMs: baseMs - 1 }), false);
  assert.equal(shouldRunAuditorForEntry(entry, { nowMs: baseMs }), true);

  nowMs = baseMs;
  entry = applyAuditorOutcomeToEntry(entry, { conclusion: "healthy" }, { nowMs, basePollMs: baseMs });
  assert.equal(entry.healthyStreak, 1);
  assert.equal(entry.nextDueAtMs, nowMs + baseMs);

  nowMs += baseMs;
  entry = applyAuditorOutcomeToEntry(entry, { conclusion: "healthy" }, { nowMs, basePollMs: baseMs });
  assert.equal(entry.healthyStreak, 2);
  assert.equal(entry.nextDueAtMs, nowMs + baseMs);

  nowMs += baseMs;
  entry = applyAuditorOutcomeToEntry(entry, { conclusion: "healthy" }, { nowMs, basePollMs: baseMs });
  assert.equal(entry.healthyStreak, 3);
  assert.equal(entry.nextDueAtMs, nowMs + 2 * baseMs);

  nowMs += 10_000;
  let reconciled = reconcileAuditorScheduleEntry(
    entry,
    makeRow({ currentTaskId: "T-002_other", updatedAt: "2026-03-15T00:45:10.000Z" }),
    { nowMs, basePollMs: baseMs, serverEpoch: 1 },
  );
  assert.ok(reconciled.resetReasons.includes("task_changed"));
  assert.equal(reconciled.entry.healthyStreak, 0);
  assert.equal(reconciled.entry.nextDueAtMs, nowMs + baseMs);

  nowMs += 10_000;
  reconciled = reconcileAuditorScheduleEntry(
    reconciled.entry,
    makeRow({
      currentTaskId: "T-002_other",
      status: "waiting_job",
      developerStatus: "waiting_job",
      updatedAt: "2026-03-15T00:45:20.000Z",
    }),
    { nowMs, basePollMs: baseMs, serverEpoch: 1 },
  );
  assert.ok(reconciled.resetReasons.includes("entered_waiting_job"));

  nowMs += 10_000;
  reconciled = reconcileAuditorScheduleEntry(
    reconciled.entry,
    makeRow({
      currentTaskId: "T-002_other",
      status: "failed",
      developerStatus: "blocked",
      lastError: { where: "guardrail/review_loop" },
      updatedAt: "2026-03-15T00:45:30.000Z",
    }),
    { nowMs, basePollMs: baseMs, serverEpoch: 1 },
  );
  assert.ok(reconciled.resetReasons.includes("new_incident"));

  nowMs += 10_000;
  reconciled = reconcileAuditorScheduleEntry(
    reconciled.entry,
    makeRow({
      currentTaskId: "T-002_other",
      status: "implementing",
      developerStatus: "ongoing",
      lastError: null,
      updatedAt: "2026-03-15T00:45:40.000Z",
    }),
    { nowMs, basePollMs: baseMs, serverEpoch: 1 },
  );
  assert.ok(reconciled.resetReasons.includes("run_resumed"));

  nowMs += 10_000;
  reconciled = reconcileAuditorScheduleEntry(reconciled.entry, makeRow({ currentTaskId: "T-002_other" }), {
    nowMs,
    basePollMs: baseMs,
    serverEpoch: 2,
  });
  assert.ok(reconciled.resetReasons.includes("server_restart"));

  const overdueCarry = reconcileAuditorScheduleEntry(
    {
      runId: "run-schedule-smoke",
      status: "implementing",
      developerStatus: "ongoing",
      currentTaskId: "T-002_other",
      waitingJob: false,
      lastErrorWhere: null,
      healthyStreak: 0,
      nextDueAtMs: nowMs - 60_000,
    },
    makeRow({
      currentTaskId: "T-002_other",
      status: "waiting_job",
      developerStatus: "waiting_job",
      updatedAt: "2026-03-15T00:46:00.000Z",
    }),
    { nowMs, basePollMs: baseMs, serverEpoch: 2 },
  );
  assert.ok(overdueCarry.resetReasons.includes("entered_waiting_job"));
  assert.equal(overdueCarry.entry.nextDueAtMs, nowMs);

  const overExpectedNow = Date.parse("2026-03-15T02:20:00.000Z");
  const overExpected = getExpectedMinutesExceededWake(
    makeRow({
      status: "waiting_job",
      developerStatus: "waiting_job",
      activeJob: {
        jobId: "job-over-expected",
        startedAt: "2026-03-15T00:00:00.000Z",
        expectedMinutes: 120,
      },
    }),
    { nowMs: overExpectedNow },
  );
  assert.equal(overExpected.jobId, "job-over-expected");
  assert.equal(overExpected.expectedMinutes, 120);

  const overExpectedReconciled = reconcileAuditorScheduleEntry(
    {
      runId: "run-schedule-smoke",
      status: "waiting_job",
      developerStatus: "waiting_job",
      currentTaskId: "T-002_other",
      waitingJob: true,
      lastErrorWhere: null,
      healthyStreak: 5,
      nextDueAtMs: overExpectedNow + 30 * 60 * 1000,
      overExpectedWakeKey: null,
    },
    makeRow({
      currentTaskId: "T-002_other",
      status: "waiting_job",
      developerStatus: "waiting_job",
      activeJob: {
        jobId: "job-over-expected",
        startedAt: "2026-03-15T00:00:00.000Z",
        expectedMinutes: 120,
      },
    }),
    { nowMs: overExpectedNow, basePollMs: baseMs, serverEpoch: 2 },
  );
  assert.ok(overExpectedReconciled.resetReasons.includes("expected_minutes_exceeded"));
  assert.equal(overExpectedReconciled.entry.nextDueAtMs, overExpectedNow);
  assert.equal(overExpectedReconciled.entry.healthyStreak, 0);

  const overExpectedNoRepeat = reconcileAuditorScheduleEntry(
    overExpectedReconciled.entry,
    makeRow({
      currentTaskId: "T-002_other",
      status: "waiting_job",
      developerStatus: "waiting_job",
      activeJob: {
        jobId: "job-over-expected",
        startedAt: "2026-03-15T00:00:00.000Z",
        expectedMinutes: 120,
      },
    }),
    { nowMs: overExpectedNow + 60_000, basePollMs: baseMs, serverEpoch: 2 },
  );
  assert.equal(overExpectedNoRepeat.resetReasons.includes("expected_minutes_exceeded"), false);

  assert.equal(
    canAttemptAuditorForRow(
      makeRow({
        activeTurn: { role: "developer", step: "implementing" },
      }),
    ),
    false,
  );
  assert.equal(
    canAttemptAuditorForRow(
      makeRow({
        developerStatus: "auto_fixing",
        activeTurn: { role: "developer_codex", step: "corrector" },
      }),
    ),
    false,
  );
  assert.equal(
    canAttemptAuditorForRow(
      makeRow({
        activeTurn: { role: "auditor", step: "audit" },
      }),
    ),
    false,
  );

  const resumed = reconcileAuditorScheduleEntry(
    {
      runId: "run-schedule-smoke",
      status: "stopped",
      developerStatus: "waiting_job",
      currentTaskId: "T-002_other",
      waitingJob: true,
      lastErrorWhere: "stop",
      healthyStreak: 0,
      nextDueAtMs: nowMs - 60_000,
    },
    makeRow({
      currentTaskId: "T-002_other",
      status: "reviewing",
      developerStatus: "ready_for_review",
      updatedAt: "2026-03-15T00:46:10.000Z",
    }),
    { nowMs, basePollMs: baseMs, serverEpoch: 2 },
  );
  assert.ok(resumed.resetReasons.includes("run_resumed"));
  assert.equal(resumed.entry.nextDueAtMs, nowMs + baseMs);

  console.log("guardian-auditor schedule smoke test: ok");
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exitCode = 1;
});
