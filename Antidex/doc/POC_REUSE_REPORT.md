# Rapport — Reutilisation des POCs (Local_Codex_appserver / Local_Codex_dual_pipeline / Antigravity_POC)

But: documenter **concretement** comment reutiliser les 3 POCs existants pour construire `Antidex` (manager + dev Codex + dev Antigravity).

## 1) Local_Codex_appserver — Ce que ca apporte

### 1.1 Prouve / demontre
- Utiliser Codex **hors IDE** via `codex.exe app-server` (JSON-RPC sur stdin/stdout) + UI web locale.
- Gestion de threads persistants (`threadId`) et streaming des deltas.

### 1.2 Comment lancer (POC)
Depuis `Local_Agents/Local_Codex_appserver/`:
- `./start.ps1` (ouvre `http://127.0.0.1:3210` par defaut)
- ou `npm start`

### 1.3 Points techniques a reutiliser
- Client app-server: `Local_Agents/Local_Codex_appserver/server/codexAppServerClient.js`
  - `start({cwd})`, `initialize()`
  - `threadStart({cwd,sandbox,approvalPolicy,model})`
  - `threadResume({threadId,cwd,sandbox,approvalPolicy,model})`
  - `turnStart({threadId,prompt,approvalPolicy,model,effort})`
  - `turnInterrupt({threadId,turnId})`
  - `modelList()`
  - Gestion auto du champ `effort` si valeur non supportee (retry avec max supporte)
- Explorer serveur (pour UI): `Local_Agents/Local_Codex_appserver/server/fsApi.js`
- Gardes-fous env:
  - `CODEX_EXE` ou `PATH` ou fallback extension VS Code
  - `CWD_ROOTS` optionnel pour limiter les racines autorisees
  - `CODEX_PASS_OPENAI_API_KEY=1` si on veut transmettre `OPENAI_API_KEY` au process codex (sinon stripping par defaut)

### 1.4 Gotchas
- Par design du POC: `sandbox=danger-full-access` + `approvalPolicy=never` => pouvoir total sur le `cwd`.
- Les sessions/rollouts sont sous `~/.codex/sessions/...` (best-effort indexable par `threadId`).

## 2) Local_Codex_dual_pipeline — Ce que ca apporte

### 2.1 Prouve / demontre
- Orchestration sequentielle de **2 threads Codex** (Manager + Developer) au-dessus d'un seul `codex app-server`.
- Handoff via un marqueur fichier **dans le projet cible**: `data/pipeline_state.json`.
- UI web + SSE logs par role + logs browser.

### 2.2 Comment lancer (POC)
Depuis `Local_Agents/Local_Codex_dual_pipeline/`:
- `./start.ps1` (ouvre `http://127.0.0.1:3220` par defaut)
- ou `npm start`

### 2.3 Pieces a reutiliser
- Orchestrateur: `Local_Agents/Local_Codex_dual_pipeline/server/pipelineManager.js`
  - Bootstrapping de docs dans le `cwd` cible (`ensureProjectDocs`)
  - State machine: planning -> implementing -> reviewing -> (continue|completed)
  - Sync depuis `cwd/data/pipeline_state.json` (`developer_status`, `manager_decision`)
- API + SSE: `Local_Agents/Local_Codex_dual_pipeline/server/index.js`
  - `/api/pipeline/start|continue|stop|state|runs`
  - `/api/pipeline/stream/:runId?role=...` (SSE)
  - File viewer allowlist (doc/data/logs)
- Etat runtime (orchestrateur): `Local_Agents/Local_Codex_dual_pipeline/data/pipeline_state.json`

### 2.4 Comment l'adapter pour Antidex
Ajouter un 3e role "developer_antigravity" et remplacer la boucle "1 dev unique" par:
- Manager planifie -> genere liste de taches
- Pour chaque tache: Manager choisit dev (codex|antigravity) -> execution -> review Manager -> suite.
Le marqueur `cwd/data/pipeline_state.json` reste la cle de reprise, mais doit etre etendu pour tracer:
- le dev actif,
- l'id de tache en cours,
- les references vers les sorties Antigravity (runId/result.json).

## 3) Antigravity_POC — Ce que ca apporte

### 3.1 Prouve / demontre
- Envoyer un prompt a Antigravity via `antigravity-connector` (`POST /send`).
- Recuperer un resultat fiable via **protocole fichiers** (pas de lecture du chat):
  - `request.md` / `ack.json` / `result.tmp -> result.json` (atomic write)

### 3.2 Comment lancer (POC)
Depuis `Local_Agents/Antigravity_POC/`:
- CLI: `node src/cli.js --cwd C:\\path\\to\\project --task \"...\"`
- UI sender (manuel): `./start_ui.ps1` (ouvre `http://127.0.0.1:17400`)

Prerequis:
- `antigravity-connector` actif (souvent `http://127.0.0.1:17375`)
- `/diagnostics` doit contenir des commandes `antigravity.*`
- Pour injection robuste via CDP: lancer Antigravity avec `--remote-debugging-port=9000` (ref: `DEBUG_INJECTION_REPORT.md`)

### 3.3 Pieces a reutiliser
- Client connector: `Local_Agents/Antigravity_POC/src/connectorClient.js`
  - `/health`, `/diagnostics`, `/extensions`, `/send`
- Protocole run: `Local_Agents/Antigravity_POC/src/runProtocol.js`
  - `initRun({cwd, taskText})` -> cree `data/antigravity_runs/<runId>/...`
  - `buildPromptWithFileOutput(...)` -> prompt qui impose ack + atomic write
- Attente de resultat: `Local_Agents/Antigravity_POC/src/waitForResult.js`

### 3.4 Gotchas
- Si `/send` retourne 200 mais `ok:false`, c'est un echec.
- Sans `ack.json`, on peut perdre du temps si approvals/outils bloquent; l'ACK sert de "pre-check".
- "Continue thread" dans Antigravity n'est pas une selection par ID; c'est la conversation active.
- Politique threads (Antidex):
  - Par defaut, on part sur "reuse" pour les 2 developpeurs (Codex + Antigravity); le Manager ne bascule en `new_per_task` que pour gros projets ou degradation.
  - Pour Antigravity, `new_per_task` correspond a `newConversation=true` (nouvelle conversation par tache). `reuse` correspond a `newConversation=false` (mais reste best-effort, car cela depend de la conversation active).

## 4) Strategie de reutilisation dans Antidex (proposition)

Option A (rapide, comme `Local_Codex_dual_pipeline`):
- Reutiliser directement les modules via `require(\"../../...\")` (couplage inter-projets, mais rapide).

Option B (plus propre):
- Vendor/copier dans `Antidex/` les modules stables (`codexAppServerClient`, `fsApi`, `connectorClient`, `runProtocol`, `waitForResult`)
- Documenter clairement l'origine (dans ce rapport + `doc/DECISIONS.md`)

Dans les 2 cas, le coeur a implementer est:
- une boucle Manager -> (dev codex | dev AG) -> review -> ... **par tache**,
- avec un protocole fichiers strict (taches + preuves + marqueurs) pour la reprise et la verification.
