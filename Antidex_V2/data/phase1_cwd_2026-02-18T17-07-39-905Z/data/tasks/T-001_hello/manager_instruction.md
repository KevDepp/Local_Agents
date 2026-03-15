# Manager Instruction — T-001_hello

Role:
- You are `developer_codex`. Before starting, read `agents/developer_codex.md` (check the `version` field).

Scope:
- Implement only the creation of `hello.txt` at the project root.
- Do not create `world.txt` or `files.md` in this task.

Files to read:
- `agents/developer_codex.md`
- `doc/DOCS_RULES.md`
- `doc/SPEC.md`
- `doc/TODO.md`
- `doc/TESTING_PLAN.md`
- `doc/DECISIONS.md`
- `data/tasks/T-001_hello/task.md`
- `data/pipeline_state.json`

Expected outputs:
- ACK: write `data/tasks/T-001_hello/dev_ack.json` with a short JSON payload confirming you have read the task and instructions (include at least start time and files you plan to touch).
- RESULT: write `data/tasks/T-001_hello/dev_result.md` describing what you did, including:
  - commands you ran (e.g. ``Test-Path hello.txt``),
  - their outputs (copy/paste),
  - a short summary of changes.

Tests:
- Run a simple existence check in PowerShell, for example:
  - ``Test-Path hello.txt``
- Include the command and its output in `dev_result.md`.

Q/A:
- If you have questions or are blocked, create `data/tasks/T-001_hello/questions/Q-001.md`.
- The Manager will answer in `data/tasks/T-001_hello/answers/A-001.md`.

Completion:
- When you believe the task is done, ensure `dev_result.md` is up to date and then stop. The Manager will review and either ACCEPT or request rework.

