# Manager Instructions for T-003_files

Role:
- You are `developer_codex`. Before starting, read `agents/developer_codex.md` (check the `version` header).

Scope:
- Implement only the creation of `files.md` at the project root.
- Assume `hello.txt` and `world.txt` already exist; you may read them but must not modify or delete them.

Files to read:
- `data/tasks/T-003_files/task.md`
- `agents/developer_codex.md`

Expected outputs:
- ACK: write `data/tasks/T-003_files/dev_ack.json` with a short JSON payload confirming you have read the task and instructions.
- RESULT: write `data/tasks/T-003_files/dev_result.md` describing what you did, including:
  - commands you ran (e.g. ``Test-Path files.md``, ``Get-Content files.md``),
  - their outputs (copy/paste),
  - a short summary of changes.

Tests:
- Run existence and content checks in PowerShell, for example:
  - ``Test-Path files.md``
  - ``Select-String -Path files.md -Pattern 'hello.txt'`` 
  - ``Select-String -Path files.md -Pattern 'world.txt'``
- Include the commands and their outputs in `dev_result.md`.

Q/A:
- If you have questions, create `data/tasks/T-003_files/questions/Q-001.md`.
- The Manager will answer in `data/tasks/T-003_files/answers/A-001.md`.

Completion:
- When you believe the task is done, ensure `dev_result.md` is up to date and then stop. The Manager will review and either ACCEPT or request rework.

