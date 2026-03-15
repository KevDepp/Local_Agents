# SPEC

Context:
- Simple file-creation workflow managed by Antidex.
- The user wants three sequential steps:
  1) Create `hello.txt`.
  2) Create `world.txt`.
  3) Create `files.md` listing the two files.

Acceptance criteria:
- `hello.txt` exists with appropriate content as defined in its task.
- `world.txt` exists with appropriate content as defined in its task.
- `files.md` exists and lists `hello.txt` and `world.txt` as specified in its task.
- Tasks are executed in order T-001, T-002, T-003.
- All work is tracked through `data/tasks/T-001_hello`, `T-002_world`, `T-003_files`.
