# SPEC

Last updated: 2026-02-18.

Context:
- This project uses Antidex task orchestration on the current `cwd`.
- For this run, the user wants three simple file-creation steps, each mapped to a separate task:
  - `T-001_hello` – create `hello.txt` at the project root.
  - `T-002_world` – create `world.txt` at the project root.
  - `T-003_files` – create `files.md` listing `hello.txt` and `world.txt`.
- Tasks are executed sequentially in the order 1 → 2 → 3 by `developer_codex`.

Acceptance criteria:
- After `T-001_hello`, a text file `hello.txt` exists at the project root.
- After `T-002_world`, a text file `world.txt` exists at the project root.
- After `T-003_files`, a Markdown file `files.md` exists at the project root containing a list that references both `hello.txt` and `world.txt`.
- All three tasks are tracked in `doc/TODO.md`, have corresponding entries under `data/tasks/`, and pass the simple file-existence checks defined in `doc/TESTING_PLAN.md`.
