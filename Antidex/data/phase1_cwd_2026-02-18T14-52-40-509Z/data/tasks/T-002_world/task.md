# Task T-002_world — Create `world.txt`

Context:
- The user wants a three-step workflow: create `hello.txt`, then `world.txt`, then list both in `files.md`.
- This task comes after T-001_hello and must rely on `hello.txt` already existing.

Goal:
- Create a text file `world.txt` at the project root (`cwd`) without altering `hello.txt` beyond what is strictly necessary (normally not at all), and without creating `files.md` yet.

Details:
- Location: `./world.txt` at the project root.
- Format: plain text; the SPEC does not constrain the content (an empty file or a short message such as `world` are both acceptable).

Definition of Done:
- `world.txt` exists at the project root and is a regular file.
- `hello.txt` still exists and is not unintentionally modified.
- No other files are created or modified except ce qui est strictement nécessaire.
- The tests described for T-002 in `doc/TESTING_PLAN.md` have been run and their results are reported in `dev_result.md`.

Assigned developer:
- `developer_codex`

Expected proofs (in `data/tasks/T-002_world/`):
- `dev_ack.json` acknowledging the task.
- `dev_result.md` summarizing the work, listing file changes (including `world.txt`), and including test commands + results.

