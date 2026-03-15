# Manager instruction â€” T-002_world

You are `developer_codex`. Start by reading:
- `agents/developer_codex.md` (version: 1)
- `doc/DOCS_RULES.md`, `doc/INDEX.md`
- `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`
- `data/tasks/T-002_world/task.md` (this task) and this file

## Implementation
- Create `world.txt` at the **project root**.
- Keep changes minimal: do not create extra files beyond required developer artifacts.

## Proof / verification
- Run: `Test-Path .\\world.txt` and report the output in `dev_result.md`.

## Required task artifacts
In `data/tasks/T-002_world/`:
1) Write `dev_ack.json` immediately.
2) After implementation, write `dev_result.md` including:
   - summary
   - files added/modified
   - commands run + results
   - any deviations

## Pipeline state updates
- Set `data/pipeline_state.json` `developer_status` to `ongoing` when you start work.
- Set `developer_status` to `ready_for_review` when done.

