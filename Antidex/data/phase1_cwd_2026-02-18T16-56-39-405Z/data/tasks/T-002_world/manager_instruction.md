# Manager Instructions for T-002_world

Role:
- You are `developer_codex`. Before starting, read `agents/developer_codex.md` (check the `version` header).

Scope:
- Implement only the creation of `world.txt` at the project root.
- Do not create or modify `hello.txt` (other than reading it if needed).
- Do not create `files.md` in this task.

Files to read:
- `data/tasks/T-002_world/task.md`
- `agents/developer_codex.md`

Expected outputs:
- ACK: write `data/tasks/T-002_world/dev_ack.json` with a short JSON payload confirming you have read the task and instructions.
- RESULT: write `data/tasks/T-002_world/dev_result.md` describing what you did, including:
  - commands you ran (e.g. ``Test-Path world.txt``),
  - their outputs (copy/paste),
  - a short summary of changes.

Tests:
- Run a simple existence check in PowerShell, for example:
  - ``Test-Path world.txt``
- Include the command and its output in `dev_result.md`.

Q/A:
- If you have questions, create `data/tasks/T-002_world/questions/Q-001.md`.
- The Manager will answer in `data/tasks/T-002_world/answers/A-001.md`.

Completion:
- When you believe the task is done, ensure `dev_result.md` is up to date and then stop. The Manager will review and either ACCEPT or request rework.

