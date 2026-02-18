# Manager Instruction — T-003_files

Role:
- You are `developer_codex`. Before starting, read `agents/developer_codex.md` (check the `version` field).

Scope:
- Implement only the creation (ou mise à jour) de `files.md` à la racine du projet.
- Do not recreate or delete `hello.txt` or `world.txt`.

Files to read:
- `agents/developer_codex.md`
- `doc/DOCS_RULES.md`
- `doc/SPEC.md`
- `doc/TODO.md`
- `doc/TESTING_PLAN.md`
- `doc/DECISIONS.md`
- `data/tasks/T-003_files/task.md`
- `data/pipeline_state.json`

Expected outputs:
- ACK: write `data/tasks/T-003_files/dev_ack.json` with a short JSON payload confirming you have read the task and instructions (include at least start time and files you plan to touch).
- RESULT: write `data/tasks/T-003_files/dev_result.md` describing what you did, including:
  - commands you ran (e.g. ``Get-Content files.md``),
  - their outputs (copy/paste),
  - a short summary of changes.

Tests:
- Verify that `files.md` exists and mentions both `hello.txt` and `world.txt`, for example:
  - ``Test-Path files.md``
  - ``Get-Content files.md``
- Include the commands and their outputs in `dev_result.md`.

Q/A:
- If you have questions or are blocked, create `data/tasks/T-003_files/questions/Q-001.md`.
- The Manager will answer in `data/tasks/T-003_files/answers/A-001.md`.

Completion:
- When you believe the task is done, ensure `dev_result.md` is up to date and then stop. The Manager will review and either ACCEPT or request rework.

