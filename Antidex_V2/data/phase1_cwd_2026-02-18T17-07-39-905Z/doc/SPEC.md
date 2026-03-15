# SPEC

Context:
- Minimal workflow to create two text files `hello.txt` and `world.txt` plus a markdown file `files.md` that lists them.
- Each step (creating `hello.txt`, creating `world.txt`, creating `files.md`) must be handled as a separate development task: `T-001_hello`, `T-002_world`, `T-003_files`.
- The Manager plans and dispatches these tasks; `developer_codex` is responsible for implementation and tests.

Acceptance criteria:
- After all tasks are ACCEPTED, the project root contains `hello.txt`, `world.txt` and `files.md`.
- `files.md` lists the two filenames `hello.txt` and `world.txt` in a human-readable form.
- Tests defined in `doc/TESTING_PLAN.md` for these tasks are implemented and pass.
