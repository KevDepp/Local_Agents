# Manager Review - T-006c_medium_baseline_fix

Decision: **REWORK**
Reviewed_at: 2026-03-11T09:35:17.2492062+00:00
Turn nonce: turn-8f85d74c8ae14e3586d0

Reasons (short):
- DoD not met: latest rerun is still maximally seat-biased (2p, 200 games, seed=1): wins_by_seat={0:200,1:0} with illegal_moves=0 in ../ai_lab/reports/medium_vs_medium_sanity.json (meta.generated_at=2026-03-10T19:39:13.387Z). Source of truth: data/jobs/job-T-006c_medium_baseline_fix-2026-03-10T18-48-59/result.json.
- dev_result.md is stale/inconsistent with the latest completed job (still marked as waiting/pending), so the attempt is not auditable.
- No evidence of the required symmetry / deterministic tie-break fix (and its order-invariance validation) being implemented or validated.

Goal check:
- Final goal: Fix MEDIUM so MEDIUM vs MEDIUM (2p) is not deterministically seat-0 winning (target seat-0 wins in [90..110] over 200 games, seed=1) with illegal_moves=0, so the Strength Gate is discriminant under seat rotation.
- Evidence that invalidates: data/jobs/job-T-006c_medium_baseline_fix-2026-03-10T18-48-59/result.json reports wins_by_seat={0:200,1:0} for medium_vs_medium.
- Failure type: local_task_issue
- Decision: rerun locally
- Why this is the right level: the harness produces clear, auditable artifacts; the remaining gap is MEDIUM policy symmetry / move-selection ordering, not measurement/protocol.

Rerun justification:
- The next attempt must include actual MEDIUM behavior changes (order-invariant selection + deterministic seeded tie-breaking/jitter + explicit order-invariance validation). A rerun after that change will produce genuinely new signal.

Rework request:
1) Implement an order-invariant MEDIUM move-selection fix (deterministic, seeded tie-breaking/jitter when multiple moves are equal/near-equal; no Math.random()).
2) Add/perform a minimal order-invariance validation (permute legal-move order ~20x for one representative state; confirm selected move / distribution is invariant) and document it.
3) Rerun MEDIUM vs MEDIUM sanity (2p, 200 games, seed=1, tie-break enabled) and overwrite ../ai_lab/reports/medium_vs_medium_sanity.json such that wins_by_seat[0] is in [90..110] and illegal_moves=0.
4) Update data/tasks/T-006c_medium_baseline_fix/dev_result.md to reference the new job folder/command and include parsed summaries.

Next actions:
- Update data/tasks/T-006c_medium_baseline_fix/manager_instruction.md in this same turn.
- Developer: implement the MEDIUM fix, rerun the MEDIUM sanity, then set developer_status=ready_for_review.

