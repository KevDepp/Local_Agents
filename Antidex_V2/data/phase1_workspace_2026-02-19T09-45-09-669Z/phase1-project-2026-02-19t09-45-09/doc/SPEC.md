# SPEC

Context:
- The user wants a very simple file-based workflow.
- The workflow must be executed as three sequential tasks managed by Antidex.
- Each task will be implemented by a developer (not by the Manager).

High-level requirements:
- Create a text file `hello.txt`.
- Create a text file `world.txt`.
- Create a Markdown file `files.md` that lists the two files above.
- The three steps must be modeled as separate tasks: `T-001_hello`, `T-002_world`, `T-003_files`.
- Tasks must run in order: first `T-001_hello`, then `T-002_world`, then `T-003_files`.

Acceptance criteria:
- After all tasks are ACCEPTED:
  - `hello.txt` exists at the project root with the expected content defined by the implementation task.
  - `world.txt` exists at the project root with the expected content defined by the implementation task.
  - `files.md` exists at the project root and lists (at minimum) `hello.txt` and `world.txt` in a human-readable way.
- The TODO backlog documents the three tasks with explicit priorities and execution order (1, 2, 3).
- `data/tasks/T-001_hello/`, `data/tasks/T-002_world/`, and `data/tasks/T-003_files/` exist with a clear Definition of Done.
- `data/pipeline_state.json` points to the current task while the pipeline is in the dispatching/execution phase.
