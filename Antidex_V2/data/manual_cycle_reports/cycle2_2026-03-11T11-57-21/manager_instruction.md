# Manager instruction - T-006c_medium_baseline_fix

You are `developer_codex`.
Updated_at: 2026-03-11T10:57:05.0314046+00:00

Context (current evidence):
- `../ai_lab/reports/easy_vs_easy_sanity.json`: `wins_by_seat={0:100,1:100}`, `illegal_moves=0`.
- `../ai_lab/reports/medium_vs_medium_sanity.json`: `wins_by_seat={0:200,1:0}`, `illegal_moves=0`, `meta.generated_at=2026-03-10T19:39:13.387Z`.
  - Source of truth for this run: `data/jobs/job-T-006c_medium_baseline_fix-2026-03-10T18-48-59/result.json`.

Hard constraints:
- Work only in `../ai_lab/`. Do not touch `../odyssee-web` in this task.
- Do not modify `doc/*`.
- Do not modify `data/tasks/*` except `data/tasks/T-006c_medium_baseline_fix/dev_result.md`.
  - It is OK/expected that running the harness writes `data/jobs/*` and `data/jobs/requests/*` (these are execution artifacts).
- Keep `dev_result.md` current for the *latest* completed run (no “waiting job” state after a job is done): reference the job folder/result.json and include parsed summaries.
- Keep using a Windows-safe invocation style (do not rely on fragile `npm run` flag forwarding).
- If using long-job: use the structured `--script` form and do NOT use `--command "..."`:
  - `tools\\antidex.cmd job start --run-id 1c11dc2f-a9d3-4cac-a26d-eab866f267fd --task-id T-006c_medium_baseline_fix --expected-minutes 15 --script ..\\ai_lab\\scripts\\run_medium_sanity.cmd`
- Any script used under long-job must write `heartbeat.json`, `progress.json`, and `result.json` via `ANTIDEX_JOB_*` env vars (keep the current working behavior).

Goal:
- Fix MEDIUM so that in 2 players `MEDIUM vs MEDIUM` is not deterministically seat-0 winning (target seat-0 win count in `[90..110]` over 200 games with seed=1), with `illegal_moves=0`.

Scope focus (for the next attempt):
- First, fix **move selection symmetry / order dependence** (tie-breaking/jitter) and rerun the sanity.
- Do not change MEDIUM evaluation weights in the same attempt unless the selection/tie-breaking change is confirmed insufficient (still near-200/0 after the quick check).
- Do not launch another 200-game rerun until the symmetry/tie-breaking change and the order-invariance validation are actually implemented (avoid producing the same 200/0 artifact again).

Definition of Done (gating):
- Regenerate `../ai_lab/reports/medium_vs_medium_sanity.json` (2p, 200 games, seed=1, max_turns=200, tie-break enabled) such that:
  - `illegal_moves=0`
  - `wins_by_seat[0]` is between 90 and 110 (inclusive).
- Add a minimal order-invariance check showing MEDIUM move selection does not depend on legal-move iteration order, and mention how you validated it in `dev_result.md`.
  - Example: pick one representative state, permute the legal-move list ~20 times with the same seed, and show the selected move (or selected-move distribution) is invariant.
  - The check can be a tiny standalone script under `../ai_lab/scripts/` if that is the simplest way to make it reproducible; just reference the path + exact command in `dev_result.md`.
- Before setting `developer_status=ready_for_review`, verify the rerun is actually new:
  - `medium_vs_medium_sanity.json` `meta.generated_at` must change from `2026-03-10T19:39:13.387Z`, and the new `wins_by_seat` must meet the target above.

Implementation guidance (non-binding):
- Make MEDIUM selection order-invariant:
  - evaluate all legal moves,
  - collect the best set (or within a small tolerance),
  - choose among them using a deterministic RNG derived from `--seed` (+ game index + seat + move hash) or a deterministic jitter `epsilon * rng()` applied for tie-breaking only.
- To reduce accidental ordering dependence, canonicalize each move to a stable key (string/JSON), sort by that key before scoring/tie-breaking, and reuse that same key for the per-move hash used in the RNG.
- When generating that move key/hash, avoid relying on object property enumeration order; explicitly build a stable tuple/string from known fields.
- If you introduce deterministic score jitter, keep `epsilon` tiny relative to the score scale (tie-break only): it should never flip clearly-better vs clearly-worse moves.
- Do not use `Math.random()` (or any unseeded source) for tie-breaking/jitter.

Allowed execution (preferred while iterating):
- Use the **foreground** runner first:
  - `pushd ..\\ai_lab`
  - quick check: `node .\\node_modules\\tsx\\dist\\cli.mjs src\\runner.ts --players 2 --games 50 --seed 1 --policy medium --max-turns 200 --tie-break --output .\\reports\\medium_vs_medium_sanity_quick.json`
  - if improved, full run: `node .\\node_modules\\tsx\\dist\\cli.mjs src\\runner.ts --players 2 --games 200 --seed 1 --policy medium --max-turns 200 --tie-break --output .\\reports\\medium_vs_medium_sanity.json`
  - spot check (non-gating): `node .\\node_modules\\tsx\\dist\\cli.mjs src\\runner.ts --players 2 --games 50 --seed 2 --policy medium --max-turns 200 --tie-break --output .\\reports\\medium_vs_medium_sanity_quick_seed2.json`
  - `popd`

Status rules:
- Keep `developer_status=ongoing` while working.
- Set `developer_status=ready_for_review` only when the DoD above is satisfied.

Escalation (if still stuck):
- If, after implementing tie-breaking/jitter + order-invariance validation, `wins_by_seat[0]` is still > 120/200 on seed=1, stop and report your findings (tie frequency, whether scores are effectively unique, and why the first-player advantage persists) so we can decide whether the fix must move to evaluation.
- Add one extra diagnostic in that report: estimate tie rate and/or the distribution of `(bestScore - secondBestScore)` over a small sample of positions, to confirm whether the issue is actually tie-breaking-sensitive.
- Optional diagnostic experiment (only if still maximally biased after the symmetry fix): temporarily choose uniformly (seeded) among the top-3 scored moves when at least 3 moves exist, rerun 50 games (seed=1). If the split stays near 50/0, the issue is likely evaluation asymmetry rather than tie-breaking/ordering.


