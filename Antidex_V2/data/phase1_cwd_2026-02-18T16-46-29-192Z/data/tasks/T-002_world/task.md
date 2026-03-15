# Task T-002_world — Créer `world.txt`

## Context

The overall user request is:
1) Create `hello.txt`.
2) Create `world.txt`.
3) Create `files.md` listing the two files.

This task covers step 2 only: creating `world.txt`.

## Goal

Create the file `world.txt` in the project root (`cwd`) with the expected content and ensure it is tracked in the testing evidence.

## Requirements

- Create a file named `world.txt` at the project root.
- Content: a short “world” message. If the user specifies content later in `doc/TODO.md`, that takes precedence; otherwise, a simple line such as `world` is acceptable.
- Do not create or modify `hello.txt` except if strictly necessary for consistency (and document any changes).
- Do not create `files.md` in this task.

## Definition of Done

- `world.txt` exists at the project root.
- Content of `world.txt` is consistent with the latest instructions in `doc/TODO.md` (or a reasonable default if none provided).
- `hello.txt` remains present (from T-001) and is not unintentionally modified.
- `doc/TESTING_PLAN.md` checklist item for T-002 is satisfied.
- Evidence of the file creation and any verification steps is recorded in `data/tasks/T-002_world/dev_result.*`.

## Assigned Developer

- `developer_codex`

