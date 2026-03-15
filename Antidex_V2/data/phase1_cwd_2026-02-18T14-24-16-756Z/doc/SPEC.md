# SPEC

Context:
- This mini-project manages a three-step file creation pipeline in the project root:
  1) Create `hello.txt`.
  2) Create `world.txt`.
  3) Create `files.md` listing both `hello.txt` and `world.txt`.

Scope (current run):
- Only planning and task dispatch are performed in this phase (Manager role only).
- Actual file creation and verification will be done by `developer_codex` in separate tasks.

Acceptance criteria (end of run):
- T-001_hello: `hello.txt` exists at the project root with content agreed in the task (at minimum non-empty, text-based).
- T-002_world: `world.txt` exists at the project root with content agreed in the task (at minimum non-empty, text-based).
- T-003_files:
  - `files.md` exists at the project root.
  - `files.md` clearly lists both `hello.txt` and `world.txt` (e.g. as a Markdown bullet list).
  - Any simple tests/checks defined in `doc/TESTING_PLAN.md` and in the task are executed and their results are documented in the task result.
