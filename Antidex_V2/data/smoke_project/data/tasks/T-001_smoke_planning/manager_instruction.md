# Manager Instruction — T-001_smoke_planning

Role: Developer Codex (`developer_codex`)

## Before you start

1. Read `agents/developer_codex.md` and note its `version`.
2. Read this file and `data/tasks/T-001_smoke_planning/task.md`.

## Goal

Demonstrate the basic Developer Codex workflow on `smoke_project` using the planning artifacts created by the Manager, without implementing any real application logic.

## What to do

- Acknowledge the task:
  - Create `data/tasks/T-001_smoke_planning/dev_ack.json` with:
    - `developer_id`: `"developer_codex"`
    - `task_id`: `"T-001_smoke_planning"`
    - `agent_version`: value read from `agents/developer_codex.md`
    - `timestamp`: ISO 8601 string
    - short `summary` of your understanding.
- Perform a minimal smoke action:
  - Example: list the repo structure, or run existing tests if they exist, but do not add real features.
- Record the result:
  - Create `data/tasks/T-001_smoke_planning/dev_result.md` with:
    - Commands you ran (if any).
    - Outputs or observations.
    - Files you touched (if any), and why.
    - Any questions or uncertainties.

## Where to write

- ACK: `data/tasks/T-001_smoke_planning/dev_ack.json`
- RESULT: `data/tasks/T-001_smoke_planning/dev_result.md`
- Q/A (if needed):
  - Ask via `data/tasks/T-001_smoke_planning/questions/Q-001.md`
  - Manager will answer in `data/tasks/T-001_smoke_planning/answers/A-001.md`

## Tests / proof required

- Include in `dev_result.md`:
  - The exact commands you ran (even if they are just simple listings).
  - The outputs (or a concise summary) sufficient for the Manager to verify the smoke.

