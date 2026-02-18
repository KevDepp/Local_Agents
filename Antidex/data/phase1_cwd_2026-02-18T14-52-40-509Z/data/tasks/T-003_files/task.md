# Task T-003_files — Create `files.md` listing `hello.txt` and `world.txt`

Context:
- The user wants a three-step workflow: create `hello.txt`, then `world.txt`, then list both in `files.md`.
- This task depends on both `hello.txt` and `world.txt` already existing (from T-001_hello and T-002_world).

Goal:
- Create a Markdown file `files.md` at the project root that lists `hello.txt` and `world.txt`.

Details:
- Location: `./files.md` at the project root.
- Format: Markdown.
- Recommended content: a short list where each line mentions one file, for example:
  - `- hello.txt`
  - `- world.txt`
- The exact wording around the filenames is not constrained by the SPEC as long as the two filenames are clearly present.

Definition of Done:
- `files.md` exists at the project root and is a regular file.
- `files.md` clearly mentions both `hello.txt` and `world.txt` (ideally as a bullet list and preferably in that order).
- `hello.txt` et `world.txt` existent toujours et ne sont pas modifiés de manière inattendue.
- The tests described for T-003 in `doc/TESTING_PLAN.md` have been run and their results are reported in `dev_result.md`.

Assigned developer:
- `developer_codex`

Expected proofs (in `data/tasks/T-003_files/`):
- `dev_ack.json` acknowledging the task.
- `dev_result.md` summarizing the work, listing file changes (including `files.md`), and including test commands + results.

