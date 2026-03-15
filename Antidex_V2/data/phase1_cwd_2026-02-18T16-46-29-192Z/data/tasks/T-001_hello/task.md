# Task T-001_hello — Créer `hello.txt`

## Context

The user wants a simple sequence of file creations:
1) Create `hello.txt`.
2) Create `world.txt`.
3) Create `files.md` listing the two files.

This task covers step 1 only: creating `hello.txt`.

## Goal

Create the file `hello.txt` in the project root (`cwd`) with the expected content and ensure it is tracked in the testing evidence.

## Requirements

- Create a file named `hello.txt` at the project root.
- Content: a short “hello” message. If the user specifies content later in `doc/TODO.md`, that takes precedence; otherwise, a simple line such as `hello` is acceptable.
- Do not create `world.txt` or `files.md` in this task.
- Follow existing project conventions and any relevant instructions from `agents/developer_codex.md`.

## Definition of Done

- `hello.txt` exists at the project root.
- Content of `hello.txt` is consistent with the latest instructions in `doc/TODO.md` (or a reasonable default if none provided).
- `doc/TESTING_PLAN.md` checklist item for T-001 is satisfied.
- Evidence of the file creation and any verification steps is recorded in `data/tasks/T-001_hello/dev_result.*` (as per developer conventions).

## Assigned Developer

- `developer_codex`

