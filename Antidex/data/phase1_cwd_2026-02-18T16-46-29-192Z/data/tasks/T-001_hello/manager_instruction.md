# Manager Instruction — T-001_hello

Role: Developer Codex (`developer_codex`)

## Before you start

- Read `agents/developer_codex.md` (check the `version` field).
- Read `doc/DOCS_RULES.md`, `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, and `doc/DECISIONS.md`.

Task files:
- Task description: `data/tasks/T-001_hello/task.md`
- Manager instruction: `data/tasks/T-001_hello/manager_instruction.md`

## Work to perform

- Create `hello.txt` at the project root (`cwd`), following the requirements in `task.md`.
- Do not create `world.txt` or `files.md` in this task.
- Update tests or add simple checks if applicable, following `doc/TESTING_PLAN.md`.

## Proof / Outputs

- ACK: write `data/tasks/T-001_hello/dev_ack.json` with basic metadata (start time, files you plan to touch).
- RESULT: write `data/tasks/T-001_hello/dev_result.md` (or `.json`) summarizing:
  - Files created/modified (especially `hello.txt`).
  - How you verified the result (manual check, commands run).
  - Any limitations or follow-up notes.
- Tests:
  - If you run commands (e.g. `ls`, `cat hello.txt`), capture them in `dev_result` (with exit codes or short outputs).

## Q/A

- If you are blocked or need clarification, write a question file under:
  - `data/tasks/T-001_hello/questions/Q-001.md`
- I will answer in:
  - `data/tasks/T-001_hello/answers/A-001.md`

