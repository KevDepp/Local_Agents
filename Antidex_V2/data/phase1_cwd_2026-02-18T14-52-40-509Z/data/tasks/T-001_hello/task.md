# Task T-001_hello — Create `hello.txt`

Context:
- The user wants a three-step workflow: create `hello.txt`, then `world.txt`, then list both in `files.md`.
- This is the first step and must only create `hello.txt` so that later tasks can rely on it.

Goal:
- Create a text file `hello.txt` at the project root (`cwd`) without touching `world.txt` or `files.md`.

Details:
- Location: `./hello.txt` at the project root.
- Format: plain text; the SPEC does not constrain the content (an empty file or a short message such as `hello` are both acceptable).

Definition of Done:
- `hello.txt` exists at the project root and is a regular file.
- No other files are created or modified except what is strictly necessary for this task.
- The tests described for T-001 in `doc/TESTING_PLAN.md` have been run and their results are reported in `dev_result.md`.

Assigned developer:
- `developer_codex`

Expected proofs (in `data/tasks/T-001_hello/`):
- `dev_ack.json` acknowledging the task.
- `dev_result.md` summarizing the work, listing file changes (including `hello.txt`), and including test commands + results.

