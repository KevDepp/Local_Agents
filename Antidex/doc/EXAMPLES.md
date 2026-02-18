# EXAMPLES — Antidex (concrets)

Objectif: fournir des exemples **copiables** pour verifier rapidement que le protocole fichiers est bien respecte (taches, Q/A, pipeline_state).

---

## 1) Une tache complete (structure + contenus)

### 1.1 Structure de fichiers (dans le projet cible `cwd/`)

Exemple pour une tache `T-001_add-health-endpoint`:

```text
cwd/
  data/
    pipeline_state.json
    tasks/
      T-001_add-health-endpoint/
        task.md
        manager_instruction.md
        dev_ack.json
        dev_result.md
        manager_review.md
        questions/
          Q-001.md
        answers/
          A-001.md
  doc/
    SPEC.md
    TODO.md
    TESTING_PLAN.md
    DECISIONS.md
    INDEX.md
  agents/
    manager.md
    developer_codex.md
    developer_antigravity.md
```

### 1.2 `data/tasks/T-001_add-health-endpoint/task.md`

```md
# T-001 — Add /health endpoint

Assigned developer: developer_codex
Thread mode: reuse
Scope budget: < 700 LOC estimated

Goal
- Add a GET /health endpoint that returns `{ ok:true }`.

Definition of Done (proof required)
- [ ] Endpoint returns 200 + JSON `{ ok:true }`
- [ ] Add API smoke test that checks /health
- [ ] Update docs index if new doc added

Notes
- Keep changes minimal.
```

### 1.3 `data/tasks/T-001_add-health-endpoint/manager_instruction.md`

```md
# Manager instruction — T-001

Read first (mandatory):
- agents/developer_codex.md (check version)
- doc/SPEC.md, doc/TODO.md, doc/TESTING_PLAN.md
- this task: data/tasks/T-001_add-health-endpoint/task.md

Work:
- Implement the endpoint in the target server.
- Add/extend a smoke test.

Write outputs:
1) ACK: data/tasks/T-001_add-health-endpoint/dev_ack.json
2) RESULT: data/tasks/T-001_add-health-endpoint/dev_result.md

If blocked:
- Write a short question to: data/tasks/T-001_add-health-endpoint/questions/Q-001.md
```

### 1.4 `data/tasks/T-001_add-health-endpoint/dev_ack.json` (ACK)

```json
{
  "task_id": "T-001_add-health-endpoint",
  "agent": "developer_codex",
  "status": "ack",
  "started_at": "2026-02-17T10:12:00.000Z",
  "notes": "Starting implementation."
}
```

### 1.5 `data/tasks/T-001_add-health-endpoint/dev_result.md` (RESULT)

```md
# Dev Result — T-001_add-health-endpoint

Summary
- Added GET /health endpoint returning `{ ok:true }`.
- Added API smoke test for /health.

Files changed
- server/index.js
- scripts/api-smoke-test.js

Tests
- Command: npm run test:api
- Result: PASS

Ecarts & rationale
- None.
```

### 1.6 `data/tasks/T-001_add-health-endpoint/manager_review.md`

```md
# Manager Review — T-001_add-health-endpoint

Status: ACCEPTED

Checks
- /health returns 200 JSON ok:true
- test:api passes

Notes
- OK to proceed to next task.
```

---

## 2) Exemple Q/A (clarification courte)

### 2.1 Question `data/tasks/T-001_add-health-endpoint/questions/Q-001.md`

```md
# Q-001 — Clarification: JSON shape

Context
- The spec says /health returns `{ ok:true }`.

Question
- Do we also include extra fields like version, uptime, or codex status?

Options
1) Minimal (recommended): `{ ok:true }` only.
2) Extended: `{ ok:true, version, uptime }`.

Recommendation
- Option 1 to keep the POC stable and avoid scope creep.
```

### 2.2 Reponse `data/tasks/T-001_add-health-endpoint/answers/A-001.md`

```md
# A-001 — Decision

Decision
- Option 1: minimal `{ ok:true }` only.

Impact
- Implement /health minimal.
- If we need more diagnostics later, create a separate endpoint (ex: /api/status).

Docs
- No SPEC change required.
```

---

## 3) Exemple `data/pipeline_state.json` rempli

Exemple (dans le projet cible `cwd/data/pipeline_state.json`):

```json
{
  "run_id": "c9d9b2b2-2e77-4e5a-8c9e-2d2f2e78f2c4",
  "iteration": 2,
  "phase": "implementing",
  "current_task_id": "T-001_add-health-endpoint",
  "assigned_developer": "developer_codex",
  "thread_policy": {
    "manager": "reuse",
    "developer_codex": "reuse",
    "developer_antigravity": "reuse"
  },
  "developer_status": "ongoing",
  "manager_decision": null,
  "summary": "T-001 in progress. ACK written. Waiting for RESULT.",
  "tests": {
    "ran": false,
    "passed": false,
    "notes": "Will run npm run test:api after implementation."
  },
  "updated_at": "2026-02-17T10:15:00.000Z"
}
```

Notes:
- `developer_status=blocked` est utilise si une question Q/A est ouverte.
- `developer_status=ready_for_review` quand le developpeur a livre le RESULT.
- `developer_status=failed` peut etre utilise si le watchdog a epuise les retries (voir `doc/ERROR_HANDLING.md`).
- `manager_decision=continue|completed|blocked` est ecrit par le Manager pendant la phase de review.

---

## 4) Exemple de tache Antigravity (protocole `data/antigravity_runs/`)

Objectif: illustrer une tache executee par Antigravity avec `request.md`, `ack.json`, `result.json` (atomic write) et un artefact (screenshot).

### 4.1 Structure de fichiers (dans le projet cible `cwd/`)

Exemple pour une tache `T-010_ui-smoke-screenshot` et un runId `AG-8f2c4b9d`:

```text
cwd/
  data/
    pipeline_state.json
    tasks/
      T-010_ui-smoke-screenshot/
        task.md
        manager_instruction.md
        manager_review.md
        dev_result.json            (pointeur vers le run Antigravity)
        questions/
        answers/
    antigravity_runs/
      AG-8f2c4b9d/
        request.md
        ack.json
        result.tmp                 (pendant l'ecriture)
        result.json                (final, apres rename)
        artifacts/
          screenshot_home.png
  doc/
  agents/
```

### 4.2 `data/tasks/T-010_ui-smoke-screenshot/task.md`

```md
# T-010 — UI smoke test + screenshot

Assigned developer: developer_antigravity
Thread mode: reuse
Scope budget: < 700 LOC estimated (AG task)

Goal
- Open the target web app home page.
- Take a screenshot and save it to the artifacts folder.

Definition of Done (proof required)
- [ ] `data/antigravity_runs/<runId>/ack.json` exists quickly
- [ ] `data/antigravity_runs/<runId>/result.json` is valid and status=done
- [ ] Screenshot file exists under `artifacts/`
- [ ] `data/tasks/T-010_ui-smoke-screenshot/dev_result.json` points to the runId and key paths
```

### 4.3 `data/tasks/T-010_ui-smoke-screenshot/manager_instruction.md`

```md
# Manager instruction — T-010

Read first (mandatory):
- agents/developer_antigravity.md (check version)
- doc/TESTING_PLAN.md (relevant checks)
- this task: data/tasks/T-010_ui-smoke-screenshot/task.md

Antigravity run protocol (MUST):
RunId: AG-8f2c4b9d
Paths (under cwd):
- data/antigravity_runs/AG-8f2c4b9d/request.md
- data/antigravity_runs/AG-8f2c4b9d/ack.json
- data/antigravity_runs/AG-8f2c4b9d/result.tmp -> rename -> result.json
- data/antigravity_runs/AG-8f2c4b9d/artifacts/screenshot_home.png

Task:
- Open the home page: http://127.0.0.1:3000/
- Take a screenshot and save it to the artifacts path above.

Outputs:
1) Write ACK immediately.
2) Write RESULT atomically (tmp then rename).
3) Also write a pointer file:
   data/tasks/T-010_ui-smoke-screenshot/dev_result.json
```

### 4.4 `data/antigravity_runs/AG-8f2c4b9d/request.md`

```md
Task:
Open http://127.0.0.1:3000/ and write a screenshot to:
data/antigravity_runs/AG-8f2c4b9d/artifacts/screenshot_home.png

Output protocol (MUST):
1) Immediately write ack JSON to: data/antigravity_runs/AG-8f2c4b9d/ack.json
2) Write final result as JSON to temp file: data/antigravity_runs/AG-8f2c4b9d/result.tmp
3) When finished, rename temp file to: data/antigravity_runs/AG-8f2c4b9d/result.json
```

### 4.5 `data/antigravity_runs/AG-8f2c4b9d/ack.json`

```json
{
  "status": "ack",
  "task_id": "T-010_ui-smoke-screenshot",
  "agent": "developer_antigravity",
  "started_at": "2026-02-17T11:00:00.000Z"
}
```

### 4.6 `data/antigravity_runs/AG-8f2c4b9d/result.json`

```json
{
  "run_id": "AG-8f2c4b9d",
  "status": "done",
  "started_at": "2026-02-17T11:00:00.000Z",
  "finished_at": "2026-02-17T11:02:10.000Z",
  "summary": "Opened home page and wrote screenshot artifact.",
  "output": {
    "url": "http://127.0.0.1:3000/",
    "artifacts": [
      "data/antigravity_runs/AG-8f2c4b9d/artifacts/screenshot_home.png"
    ]
  },
  "error": null
}
```

### 4.7 `data/tasks/T-010_ui-smoke-screenshot/dev_result.json` (pointeur)

```json
{
  "task_id": "T-010_ui-smoke-screenshot",
  "agent": "developer_antigravity",
  "run_id": "AG-8f2c4b9d",
  "ack_path": "data/antigravity_runs/AG-8f2c4b9d/ack.json",
  "result_path": "data/antigravity_runs/AG-8f2c4b9d/result.json",
  "artifacts_dir": "data/antigravity_runs/AG-8f2c4b9d/artifacts/",
  "summary": "Screenshot captured; see result.json for details."
}
```

### 4.8 `data/tasks/T-010_ui-smoke-screenshot/manager_review.md`

```md
# Manager Review — T-010_ui-smoke-screenshot

Status: ACCEPTED

Checks
- ack.json exists
- result.json valid, status=done
- screenshot file exists in artifacts

Ecarts & rationale
- None.
```
