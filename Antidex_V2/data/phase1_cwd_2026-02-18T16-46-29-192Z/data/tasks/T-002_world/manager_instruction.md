# Manager Instruction — T-002_world

Role: Developer Codex (`developer_codex`)

## Before you start

- Read `agents/developer_codex.md` (check the `version` field).
- Read `doc/DOCS_RULES.md`, `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, and `doc/DECISIONS.md`.

Task files:
- Task description: `data/tasks/T-002_world/task.md`
- Manager instruction: `data/tasks/T-002_world/manager_instruction.md`

## Work to perform

- Create `world.txt` at the project root (`cwd`), following the requirements in `task.md`.
- Ensure you do not create `files.md` in this task.
- Keep `hello.txt` from T-001 intact unless an update is explicitly required by `doc/TODO.md`; document any change.
- Update tests or simple checks as appropriate per `doc/TESTING_PLAN.md`.

## Proof / Outputs

- ACK: write `data/tasks/T-002_world/dev_ack.json` with basic metadata.
- RESULT: write `data/tasks/T-002_world/dev_result.md` (or `.json`) summarizing:
  - Files created/modified (especially `world.txt`).
  - How you verified the result (manual check, commands run).
  - Any limitations or follow-up notes.
- Tests:
  - Capture any verification commands (e.g. `ls`, `cat world.txt`) in `dev_result`.

## Q/A

- If you are blocked or need clarification, write:
  - `data/tasks/T-002_world/questions/Q-001.md`
- I will answer in:
  - `data/tasks/T-002_world/answers/A-001.md`

