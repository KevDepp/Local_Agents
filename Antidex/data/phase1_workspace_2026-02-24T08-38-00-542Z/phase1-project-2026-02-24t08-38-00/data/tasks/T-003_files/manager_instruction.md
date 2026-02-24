# Manager instruction â€” T-003_files

You are `developer_codex`. Start by reading:
- `agents/developer_codex.md` (version: 1)
- `doc/DOCS_RULES.md`, `doc/INDEX.md`
- `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`
- `data/tasks/T-003_files/task.md` (this task) and this file

## Implementation
- Create `files.md` at the **project root**.
- Ensure `files.md` lists both `hello.txt` and `world.txt` (suggested format):
  - a Markdown list with one file per line

## Proof / verification
- Run: `Get-Content .\\files.md` and report the output in `dev_result.md`.

## Required task artifacts
In `data/tasks/T-003_files/`:
1) Write `dev_ack.json` immediately.
2) After implementation, write `dev_result.md` including:
   - summary
   - files added/modified
   - commands run + results
   - any deviations

## Pipeline state updates
- Set `data/pipeline_state.json` `developer_status` to `ongoing` when you start work.
- Set `developer_status` to `ready_for_review` when done.

