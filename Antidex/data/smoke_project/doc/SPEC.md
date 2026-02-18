# SPEC

Context:
- `smoke_project` is a minimal target project used to validate the Antidex manager → developer pipeline.
- Scope of this run: **planning only**. The Manager creates/updates planning docs, defines at least one developer task, and updates `data/pipeline_state.json`.
- No application code or tests are implemented in this run; any execution work happens in later tasks handled by developers.

Acceptance criteria:
- `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, and `doc/DECISIONS.md` all exist and describe this smoke planning run.
- At least one task folder `data/tasks/T-001_smoke_planning/` exists with `task.md` and `manager_instruction.md`, including an assigned developer and a clear Definition of Done.
- `data/pipeline_state.json` is updated to phase `"dispatching"` for task `T-001_smoke_planning` with `developer_status = "ongoing"` and `assigned_developer = "developer_codex"`.
- The Manager does not create or modify any application code files in this run (documentation + planning artifacts only).
