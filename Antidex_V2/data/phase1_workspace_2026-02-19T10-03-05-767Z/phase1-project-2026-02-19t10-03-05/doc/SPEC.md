# SPEC

Context:
- This run configures a minimal Antidex workflow.
- The user request is: create `hello.txt`, then `world.txt`, then list them in `files.md`.
- The work is executed in three sequential tasks assigned to `developer_codex`.

Acceptance criteria:
- After task `T-001_hello`, a file `hello.txt` exists at the project root and contains exactly the text `hello` followed by a newline.
- After task `T-002_world`, a file `world.txt` exists at the project root and contains exactly the text `world` followed by a newline.
- After task `T-003_files`, a file `files.md` exists at the project root and lists `hello.txt` and `world.txt`, one filename per line (order: `hello.txt` first, then `world.txt`).
- Tasks are defined under `data/tasks/T-xxx_<slug>/` with a clear Definition of Done, assigned developer, and references to the requested proofs/tests.
- `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/INDEX.md`, and `data/pipeline_state.json` are consistent with this three-step workflow.
