# SPEC

Context:
- This project is a minimal example to validate Antidex's task orchestration on a simple file-creation workflow in the current `cwd`.
- The user wants three sequential steps: create `hello.txt`, create `world.txt`, then list both files in `files.md`.

Functional requirements:
- The Manager creates three tasks: `T-001_hello`, `T-002_world`, and `T-003_files`, and dispatches them sequentially to `developer_codex`.
- `T-001_hello` creates a text file `hello.txt` at the project root. The exact content is not constrained by the SPEC (it may be empty or contain any short text).
- `T-002_world` creates a text file `world.txt` at the project root, after `hello.txt` exists. The exact content is not constrained by the SPEC.
- `T-003_files` creates a Markdown file `files.md` at the project root listing `hello.txt` and `world.txt` on separate lines (ideally as a Markdown bullet list) and preferably in that order.

Acceptance criteria:
- After all three tasks are ACCEPTED, the files `hello.txt`, `world.txt`, and `files.md` exist at the project root.
- `files.md` clearly mentions both `hello.txt` and `world.txt` at least once so they can be identified as the files created in the previous tasks.
- Each task has a Definition of Done and an assigned developer recorded under `data/tasks/T-xxx_<slug>/`.
