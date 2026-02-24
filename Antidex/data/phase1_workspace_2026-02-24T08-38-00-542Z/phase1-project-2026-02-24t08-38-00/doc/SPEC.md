# SPEC

Context:
- User request (2026-02-24): create `hello.txt`, then `world.txt`, then list both in `files.md`.
- Each step must be a separate task (T-001, T-002, T-003).

Acceptance criteria:
- `hello.txt` exists at the project root after T-001 is completed.
- `world.txt` exists at the project root after T-002 is completed.
- `files.md` exists at the project root after T-003 is completed and lists `hello.txt` and `world.txt`.
