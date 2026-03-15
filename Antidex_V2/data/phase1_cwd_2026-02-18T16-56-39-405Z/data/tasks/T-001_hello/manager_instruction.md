# Manager Instructions for T-001_hello

Role:
- You are `developer_codex`. Before starting, read `agents/developer_codex.md` (check the `version` header).

Scope:
- Implement only the creation of `hello.txt` at the project root.
- Do not create `world.txt` or `files.md` in this task.

Files to read:
- `data/tasks/T-001_hello/task.md`
- `agents/developer_codex.md`

Expected outputs:
- ACK: write `data/tasks/T-001_hello/dev_ack.json` with a short JSON payload confirming you have read the task and instructions.
- RESULT: write `data/tasks/T-001_hello/dev_result.md` describing what you did, including:
  - commands you ran (e.g. ``Test-Path hello.txt``),
  - their outputs (copy/paste),
  - a short summary of changes.

Tests:
- Run a simple existence check in PowerShell, for example:
  - ``Test-Path hello.txt``
- Include the command and its output in `dev_result.md`.

Q/A:
- If you have questions, create `data/tasks/T-001_hello/questions/Q-001.md`.
- The Manager will answer in `data/tasks/T-001_hello/answers/A-001.md`.

Completion:
- When you believe the task is done, ensure `dev_result.md` is up to date and then stop. The Manager will review and either ACCEPT or request rework.

