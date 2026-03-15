# Manager Review - T-006c_medium_baseline_fix

Decision: **REWORK**
Reviewed_at: 2026-03-11T10:57:05.0314046+00:00
Turn nonce: turn-06cd0dbefc18457b8db1

Reasons (short):
- DoD not met: latest completed job still shows maximal seat bias (2p, 200 games, seed=1): wins_by_seat={0:200,1:0} with illegal_moves=0 (see data/jobs/job-T-006c_medium_baseline_fix-2026-03-10T18-48-59/result.json; report meta.generated_at=2026-03-10T19:39:13.387Z).
- dev_result.md is stale (still marked as waiting/pending) and does not document the completed job results nor any implemented symmetry/tie-breaking fix.

Goal check:
- Final goal: Fix MEDIUM so MEDIUM vs MEDIUM (2p) is not deterministically seat-0 winning (target seat-0 wins in [90..110] over 200 games, seed=1) with illegal_moves=0, so the Strength Gate is discriminant under seat rotation.
- Evidence that invalidates: data/jobs/job-T-006c_medium_baseline_fix-2026-03-10T18-48-59/result.json reports wins_by_seat={0:200,1:0} for medium_vs_medium.
- Failure type: local_task_issue
- Decision: rerun locally
- Why this is the right level: the harness produces clear, auditable artifacts; the gap is MEDIUM policy symmetry / selection behavior, not measurement.

Rerun justification:
- A rerun is only meaningful after actual MEDIUM behavior changes (order-invariant selection + deterministic seeded tie-breaking/jitter + explicit order-invariance validation).

Rework request:
1) Implement order-invariant MEDIUM move selection + deterministic seeded tie-breaking/jitter (no Math.random()).
2) Add/perform an order-invariance validation and document it.
3) Rerun 2p MEDIUM vs MEDIUM (200 games, seed=1) and ensure wins_by_seat[0] is in [90..110] with illegal_moves=0.
4) Update dev_result.md with the new job folder/command, parsed summaries, and code pointers.

Next actions:
- Update data/tasks/T-006c_medium_baseline_fix/manager_instruction.md in this same turn.
- Keep developer_status=ongoing until the DoD is satisfied.

