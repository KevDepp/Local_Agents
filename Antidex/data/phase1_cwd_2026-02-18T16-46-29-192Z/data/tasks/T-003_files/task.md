# Task T-003_files — Créer `files.md` listant `hello.txt` et `world.txt`

## Context

The user request is:
1) Create `hello.txt`.
2) Create `world.txt`.
3) Create `files.md` listing the two files.

This task covers step 3 only: creating `files.md` that lists `hello.txt` and `world.txt`.

## Goal

Create a markdown file `files.md` at the project root (`cwd`) that lists the two text files created in previous tasks.

## Requirements

- Ensure that `hello.txt` and `world.txt` already exist (from T-001 and T-002). If they are missing, document the issue in `dev_result` and coordinate with the Manager.
- Create `files.md` at the project root.
- The content should clearly list the two files. A simple format is acceptable, for example:
  - `- hello.txt`
  - `- world.txt`
- Do not modify `hello.txt` or `world.txt` except if explicitly required by updated instructions in `doc/TODO.md`.

## Definition of Done

- `files.md` exists at the project root.
- `files.md` lists `hello.txt` and `world.txt` clearly (one per line or bullet).
- `hello.txt` and `world.txt` remain present and intact.
- `doc/TESTING_PLAN.md` checklist item for T-003 is satisfied.
- Evidence of the file creation and any verification steps is recorded in `data/tasks/T-003_files/dev_result.*`.

## Assigned Developer

- `developer_codex`

