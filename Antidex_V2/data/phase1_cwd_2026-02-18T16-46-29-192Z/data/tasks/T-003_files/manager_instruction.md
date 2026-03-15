# Manager Instruction — T-003_files

Role: Developer Codex (`developer_codex`)

## Before you start

- Read `agents/developer_codex.md` (check the `version` field).
- Read `doc/DOCS_RULES.md`, `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, and `doc/DECISIONS.md`.

Task files:
- Task description: `data/tasks/T-003_files/task.md`
- Manager instruction: `data/tasks/T-003_files/manager_instruction.md`

## Work to perform

- Verify that `hello.txt` and `world.txt` exist from previous tasks.
- Create `files.md` at the project root (`cwd`) listing both files, following the requirements in `task.md`.
- Do not modify `hello.txt` or `world.txt` unless explicitly required; document any such change in `dev_result`.
- Update any simple checks/tests as appropriate per `doc/TESTING_PLAN.md`.

## Proof / Outputs

- ACK: write `data/tasks/T-003_files/dev_ack.json` with basic metadata.
- RESULT: write `data/tasks/T-003_files/dev_result.md` (or `.json`) summarizing:
  - Files created/modified (especially `files.md`).
  - How you verified the result (manual check, commands run).
  - Any limitations or follow-up notes.
- Tests:
  - Capture verification commands (e.g. `ls`, `cat files.md`) in `dev_result`.

## Q/A

- If you are blocked or need clarification, write:
  - `data/tasks/T-003_files/questions/Q-001.md`
- I will answer in:
  - `data/tasks/T-003_files/answers/A-001.md`

