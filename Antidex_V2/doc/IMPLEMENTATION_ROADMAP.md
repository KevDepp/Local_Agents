# Roadmap d'implémentation — Antidex

Ce document définit un plan d’action en 4 phases (0 à 3) pour transformer les POCs existants
(`Local_Codex_dual_pipeline` et `Antigravity_POC`) en un système Antidex complet et robuste.

Principe: chaque phase doit aboutir à un état **testable** et **utilisable**, avec un scénario de validation.
Les détails de protocoles et exigences UI sont dans `doc/SPEC.md` (et des exemples concrets dans `doc/EXAMPLES.md`).

## Règle de validation (obligatoire)

- **Après chaque phase**, le livrable doit être validé par des tests exécutés par **Codex (moi)** (unit/integration/e2e selon le cas) avant d’entamer la phase suivante.
- Les tests **UI** visés ici concernent la **web UI de l’orchestrateur Antidex** (pas l'application du projet cible). Ils doivent être décrits et exécutés **de façon exhaustive par Antigravity (AG)**, avec un rapport et des preuves (captures).
- Le détail des tests à exécuter est défini dans `doc/TESTING_PLAN.md` (ce roadmap indique seulement le “minimum de validation” par phase).

## Stratégie globale (4 phases)

- **Phase 0**: validation des prérequis externes (sanity checks).
- **Phase 1**: cœur fonctionnel “Manager + Dev Codex” (bootstrap + protocole fichiers + boucle + UI minimale).
- **Phase 2**: intégration Antigravity (connector + protocole AG + UI multi-rôles).
- **Phase 3**: UX/robustesse (pilotage utilisateur, TODO éditable+diff, task list, pause/continue, Q/A, crash recovery).

## Gestion des blocages (règle projet)

Si un critère de succès d’une phase échoue (ou si une sous-partie devient trop complexe):
1) documenter le blocage et l’analyse dans `doc/DECISIONS.md` (quoi / pourquoi / impact),
2) décider: corriger / simplifier / reporter,
3) ajuster la roadmap et les specs si nécessaire (en gardant les principes non négociables).

---

## Phase 0 — Validation des prérequis (sanity checks)

**Objectif**: valider rapidement que les dépendances externes et l’environnement permettent un run Antidex.

- Commande recommandée:
  - depuis `Local_Agents/Antidex_V2/`: `npm run preflight` (défauts)
  - options (recommandé): `node scripts/preflight.js --cwd <path> --connectorBaseUrl http://127.0.0.1:17375`
  - debug/itération: `--skipCodex`, `--skipConnector`, `--skipAg`

- [ ] `codex app-server` démarre et répond (smoke call via client).
- [ ] `antigravity-connector` est accessible et `/health` + `/diagnostics` OK.
- [ ] `/send` AG fonctionne sur un prompt minimal (création d’un `runId` et écriture `ack.json`/`result.json`).
- [ ] Accès filesystem depuis AG:
  - AG peut écrire dans un `cwd` de test `data/antigravity_runs/<runId>/result.json`.
- [ ] Les templates `agents/*.md` sont bootstrapés et lisibles dans le `cwd` (dont `AG_cursorrules.md`).

### Critère de succès Phase 0 (testable)
- **Test**: exécuter ces checks sur une machine “neuve” (ou après reboot) et obtenir OK partout.

---

## Phase 1 — Cœur orchestrateur (Manager + Dev Codex)

**Objectif**: une boucle séquentielle “planifier → dispatcher → implémenter → vérifier → continuer” qui fonctionne sur un `cwd` cible, avec UI minimale (démarrer + monitorer).

### 1.1 Base projet (orchestrateur)
- [ ] Initialiser backend `Antidex/server` (base: `Local_Codex_dual_pipeline/server`).
- [ ] Initialiser UI `Antidex/web` (base: `Local_Codex_dual_pipeline/web`).
- [ ] Mettre en place un store d’état côté orchestrateur (runId, cwd, phase, threadIds, etc.), **en plus** des marqueurs dans le projet cible.

### 1.2 Bootstrap du projet cible (cwd) — non destructif
- [ ] Implémenter le bootstrap dans le `cwd` cible (création si absent, ne pas écraser si présent):
  - `doc/` + `agents/` + `data/` (dont `data/tasks/`, `data/mailbox/`, `data/antigravity_runs/`, `data/AG_internal_reports/`, `data/chatgpt_consults/`)
  - copie des templates `doc/agent_instruction_templates/*` vers `cwd/agents/*` (remplacer `updated_at`, garder `version: 1`)
  - initialisation `data/pipeline_state.json` (marqueur + pointeurs, pas un log)
  - création non-destructive de `doc/GIT_WORKFLOW.md` (copie depuis Antidex `doc/GIT_WORKFLOW.md`)
- [ ] Vérifier la politique secrets (sans implémenter d’outillage avancé):
  - pas de copie de secrets dans le projet cible,
  - le chemin `../../secrets/secrets.json` est le seul point d’accès (si utilisé),
  - pas de leaks dans logs / artifacts.

### 1.3 Système d’instructions agents (agents/*.md)
- [ ] Bootstrap `agents/*.md` (templates) avec `version`/`updated_at`, y compris `agents/AG_cursorrules.md`.
- [ ] Injection systématique d’un header “READ FIRST” au début de chaque prompt (tous rôles):
  - quoi lire (instructions + docs + dossier de tâche),
  - quoi écrire (ACK/RESULT/Q-A/pipeline_state),
  - rappel “relire si `version` a changé”.

### 1.4 Protocole fichiers (Manager ↔ Dev Codex)
- [ ] Lecture/écriture robuste de `data/pipeline_state.json` (validation JSON + atomic write).
- [ ] Gestion des tâches “Codex” via un dossier stable par tâche:
  - `data/tasks/T-xxx_<slug>/task.md` (demande + DoD + thread_mode + pointeurs)
  - `data/tasks/T-xxx_<slug>/dev_ack.json`
  - `data/tasks/T-xxx_<slug>/dev_result.md` (inclut bloc obligatoire “Écarts & rationale”)
  - `data/tasks/T-xxx_<slug>/manager_review.md` (OK/Rework + raisons + next step)

### 1.5 Protocole Q/A (base, indispensable)
- [ ] Un développeur peut poser une question courte via `data/tasks/T-xxx_<slug>/questions/Q-*.md`.
- [ ] Le Manager répond via `data/tasks/T-xxx_<slug>/answers/A-*.md`.
- [ ] Gestion de `developer_status=blocked` + reprise après réponse (sans UI dédiée au début).

### 1.6 Git/GitHub (base)
- [ ] Implémenter la politique "1 tache acceptee = 1 commit" (declenchement apres ACCEPTED, hash note dans `manager_review.md`).
- [ ] Si pas de remote `origin`, support du flow:
  - Manager assigne a AG la creation du repo GitHub,
  - Manager/Dev Codex configure `origin` et pousse.

### 1.7 UI minimale (démarrer + monitorer)
- [ ] Écran “Start run”: prompt utilisateur + choix `cwd` (fs explorer) + sélection modèles (manager/dev codex).
- [ ] Monitoring: “run state” + logs SSE (Manager + Dev Codex).
- [ ] File viewer: ouvrir le dossier de tâche courant (`task.md`, `dev_result.md`, `manager_review.md`).

### Critère de succès Phase 1 (testable)
- **Test**: lancer Antidex sur un dossier de test vide.
- **Vérification**:
  1) bootstrap OK (squelette créé sans écraser).
  2) prompt multi-tâches: “Crée `hello.txt`, puis `world.txt`, puis liste-les dans `files.md`.”
  3) 3 tâches séquentielles `T-001_*`, `T-002_*`, `T-003_*` correctement exécutées (ACK/RESULT/REVIEW).
  4) fichiers présents + preuves, revue Manager OK, run “completed”.
 - **Tests à exécuter (obligatoires)**:
    - Codex: tests unit + integration pertinents (bootstrap + protocole fichiers + SSE).
    - AG: test UI “Phase 1” (start run + monitoring + file viewer) selon `doc/TESTING_PLAN.md`.

---

## Phase 2 — Intégration Antigravity (Dev AG)

**Objectif**: intégrer un 3e agent et permettre au Manager de choisir judicieusement entre Dev Codex et Dev AG, avec protocole fichiers + UI multi-rôles.

### 2.1 Client `antigravity-connector` + diagnostics
- [ ] Intégrer le client connector (base: `Antigravity_POC`).
- [ ] Health/diagnostics au démarrage (`/health`, `/diagnostics`) + gestion d’erreurs/timeouts.

### 2.2 Protocole AG (request/ack/result + pointeur obligatoire)
- [ ] Extension du dispatch: `assigned_developer = codex|antigravity` par tâche.
- [ ] Implémenter le protocole run AG côté fichiers:
  - créer `data/antigravity_runs/<runId>/request.md`
  - attendre (optionnel mais recommandé) `ack.json`
  - attendre `result.json` écrit atomiquement (`result.tmp` → rename)
  - gérer `artifacts/` (screenshots, exports)
- [ ] Exiger un pointeur **obligatoire** dans le dossier de tâche:
  - `data/tasks/T-xxx_<slug>/dev_result.json` → référence `runId` + chemins AG.

### 2.3 UI multi-rôles (3 agents)
- [ ] Configuration connector dans l’UI (base URL + panneau status `/health`/`/diagnostics` + options utiles).
- [ ] Monitoring SSE: ajouter Dev AG (logs/étapes).
- [ ] File viewer: afficher `data/antigravity_runs/<runId>/result.json` + `artifacts/` (images).
- [ ] Intervention utilisateur (Phase 2 - provisoire mais nécessaire):
  - ajouter un bouton UI "Modify TODO" (ou "Edit TODO") permettant d'ouvrir `doc/TODO.md` du projet cible pour le run sélectionné,
  - permettre `Save` puis `Continue with update` (sauvegarder TODO puis déclencher `Continue` sur le run courant),
  - objectif: permettre à l'utilisateur de modifier la demande en cours de run sans éditer à la main dans l'explorateur de fichiers.

### 2.4 Thread policy (base, exécution)
- [ ] Implémenter `thread_policy` dans `data/pipeline_state.json` et l’appliquer:
  - Manager: `reuse` (dans une session).
  - Dev Codex + Dev AG: `reuse` par défaut, override possible par tâche (`new_per_task`).
- [ ] Vérifier que les overrides sont visibles dans les fichiers de tâche et dans l’UI (sans forcément exposer les contrôles avancés).

### 2.5 Q/A (support inter-agents, incluant AG)
- [ ] Autoriser/traiter Q/A quand l’agent assigné est AG (questions via fichiers ou via `result.json` si pas d’accès FS).

### Critère de succès Phase 2 (testable)
- **Test**: scénario mixte AG + Codex.
- **Vérification** (exemple):
  1) T-001 (AG): récupérer une info via navigateur et produire `result.json` + 1 screenshot.
  2) T-002 (Codex): écrire un fichier de sortie à partir du résultat AG.
  3) Manager valide les deux tâches et documente tout écart.
 - **Tests à exécuter (obligatoires)**:
   - Codex: integration/e2e autour du connector + protocole fichiers AG (timeouts, erreurs, retries).
   - AG: test UI “Phase 2” (config connector + affichage runs/artefacts AG) selon `doc/TESTING_PLAN.md`.

---

## Phase 2.5 — Watchdog filesystem AG + Reload Window

**Objectif**: permettre a l'orchestrateur de detecter qu'AG est bloque (inactivite filesystem) et de le debloquer automatiquement via la commande Reload Window, sans intervention manuelle de l'utilisateur.

Reference complete: `doc/ERROR_HANDLING.md` (Annexe C).

### 2.5.1 Watchdog filesystem AG
- [ ] Implémenter la surveillance continue du `mtime` du répertoire `data/AG_internal_reports/` (poll toutes les ~2 min pendant une tâche AG).
- [ ] Si aucun fichier dans `data/AG_internal_reports/` n'a été modifié depuis **10 minutes**: déclencher le protocole Manager (interrompre l'attente, céder la main au Manager).
- [ ] Fournir au Manager dans son prompt de reprise: les derniers fichiers lus dans `data/AG_internal_reports/` + le delta de temps d'inactivité.

### 2.5.2 Reload Window (commande orchestrateur)
- [ ] Implémenter l'appel `POST /api/command { "command": "workbench.action.reloadWindow" }` vers le `antigravity-connector` depuis l'orchestrateur Codex.
- [ ] Attendre **2 minutes (120 secondes)** après le reload avant de relancer AG (`newConversation=true`).
- [ ] Limiter à **2 Reload Window par tâche** (au-delà: `developer_status=failed`).
- [ ] Journaliser chaque Reload dans `data/recovery_log.jsonl` (type: `ag_filesystem_timeout`, action: `reload_window`).

### 2.5.3 Prompt de relance AG (après Reload)
- [ ] Le Manager construit un prompt de relance complet: résumé de ce qui a été fait (rapports AG), ce qui reste à faire, fichiers à produire.
- [ ] Le prompt inclut un `turn_nonce` frais pour que l'orchestrateur détecte la fin du nouveau tour.

### Critère de succès Phase 2.5 (testable)
- **Test**: simuler un AG bloqué (ne rien écrire dans `data/AG_internal_reports/` pendant 10 min).
- **Vérification**:
  1) Le watchdog détecte l'inactivité et cède la main au Manager.
  2) Le Manager lit les rapports et décide d'un Reload Window.
  3) L'orchestrateur appelle `POST /api/command { "command": "workbench.action.reloadWindow" }`.
  4) AG est relancé sur un nouveau thread et complète la tâche.
  5) L'événement est tracé dans `data/recovery_log.jsonl`.
- **Tests à exécuter (obligatoires)**:
    - Codex: integration test "AG frozen simulation" (mtime hack + watchdog trigger + reload + relance).
    - AG: vérifier que la fenêtre Antigravity redémarre proprement après `reloadWindow`.

---

## Phase 2.6 — Correcteur (auto-fix Antidex)

**Objectif**: rendre Antidex capable de se corriger lui-même (auto-patch + restart + reprise) quand le pipeline se bloque a cause d'un bug ou d'un cas non prevu dans Antidex (orchestrateur/UI/protocoles internes).

### 2.6.1 Incidents (artefacts + detection)
- [ ] Standardiser un artefact d'incident (ex: `Local_Agents/Antidex_V2/data/incidents/INC-*.json`) avec: where/expected/observed/lastError/evidence/attempts.
- [ ] Declencher un incident sur:
  - erreur explicite (`status=failed`/exceptions/invariants),
  - stall watchdog (pas de progression dans les delais).
- [ ] Quand le Correcteur est desactive, indiquer clairement: "Correcteur desactive: il aurait intervenu ici."

### 2.6.2 Correcteur (agent Codex) + UI toggle
- [ ] Ajouter un agent Correcteur (thread Codex dedie, recommande en `reuse`) declenche a chaque incident.
- [ ] UI: ajouter une checkbox `enableCorrector` (ON par defaut) pour activer/desactiver l'auto-fix.

### 2.6.3 Auto-patch + restart + reprise (boucle robuste)
- [ ] Le Correcteur produit un patch; Antidex l'applique automatiquement (pas de validation humaine).
- [ ] Apres patch: smoke tests rapides, puis restart Antidex.
- [ ] Apres restart: recharger l'etat (store orchestrateur + `project_cwd/data/pipeline_state.json`) et reprendre au bon endroit.
- [ ] Anti-boucle: limiter les auto-fix (ex: 2 par incident, 5 par run) puis escalade utilisateur avec paquet diagnostic.

### Critère de succès Phase 2.6 (testable)
- **Test**: provoquer volontairement 2-3 incidents realistes (ex: validation trop stricte, JSON BOM, etat incoherent) et verifier:
  1) incident ecrit avec preuves,
  2) Correcteur applique un patch,
  3) Antidex redemarre,
  4) le run reprend et continue.
- **Test OFF**: avec `enableCorrector=false`, verifier que l'incident indique clairement que le Correcteur aurait intervenu et que le run ne s'arrete pas silencieusement.
- **Mode de demarrage (obligatoire pour ce test)**: demarrer Antidex via le supervisor (ex: `start-ui.cmd` ou `npm start`). Sans supervisor, le test doit au minimum prouver "incident + patch" mais pas "restart + reprise".
- **Test deterministe (recommande)**: `npm -C Local_Agents/Antidex_V2 run test:corrector:e2e` (valide restart+auto-resume sans dependance LLM).

---

## Phase 3 — UX + robustesse (pilotage, reprise, Q/A)

**Objectif**: rendre Antidex pilotable par l’utilisateur, robuste aux interruptions, et plus efficace (questions courtes, récap, reprise).

### 3.1 Pilotage utilisateur dans l’UI
- [ ] TODO éditable: afficher + modifier `doc/TODO.md` directement dans l’UI (Save).
- [ ] Diff “ce qui a changé”: détecter les changements externes (mtime/hash) et afficher un diff.
- [ ] Vue “liste des tâches”: scanner `data/tasks/*`, déduire statuts (ack/result/review/pointeur AG), liens vers preuves.
- [ ] Paramètres dynamiques du prompt: entrées UI (GitHub, ChatGPT, Ratio AG/Codex) à l'écran de Start/Continue pour piloter le Manager.

### 3.2 Contrôles run + reprise (découpage)

#### 3.2.a Resume simple (Pause/Resume)
- [ ] Implémenter `Pause` / `Resume` (sans nouvelle session).
- [ ] À `Resume`, relire `data/pipeline_state.json` + le dossier de tâche courant et reprendre proprement (pas de double-dispatch).

#### 3.2.b Continue avancé (Stop/Continue + crash recovery)
- [ ] Implémenter `Stop` (resumable) + `Continue` (nouvelle session pour tous les agents).
- [ ] Implémenter `Cancel` (terminal, non resumable).
- [ ] Générer et persister des **resume packets** (par rôle) et recontextualiser les agents sur `Continue`.
- [ ] Crash recovery: au boot, recharger l’état depuis store orchestrateur + `cwd/data/pipeline_state.json` + fichiers de tâches, puis permettre `Continue`.

### 3.3 Q/A (UI + ergonomie)
- [ ] UI: visualiser questions/réponses d’une tâche et aider l’utilisateur à répondre si demandé.

### 3.4 Thread policies (UI + exécution)
- [ ] Contrôles UI: thread policy defaults Dev Codex + Dev AG (`reuse|new_per_task`).
- [ ] Visibilité: afficher la policy effective par tâche (override possible par Manager).

### 3.5 Relecture doc par AG (qualité documentation)
- [ ] Ajouter une étape “doc review” (sur décision Manager): demander à Dev AG de relire/compléter la doc, puis validation Manager.

### 3.6 Robustesse runs longs (watchdog + recovery)
- [ ] Implémenter le watchdog orchestrateur (détection 10 min sans progrès, polling ~5 min) + retries (max 3) pour AG et Dev Codex.
- [ ] Implémenter le diagnostic “AG browser blocked” + pause 30 min + relance (si rate limit AG).
- [ ] Écrire `cwd/data/recovery_log.jsonl` (JSONL) + rendre visible l’historique et l’état dans l’UI (au minimum via logs; idéalement panneau statut).
- [ ] Alignement strict avec `doc/ERROR_HANDLING.md` + mise à jour `doc/SPEC.md` si ajustements nécessaires.

### Critère de succès Phase 3 (testable)
- **Test**: scénario long et interactif.
- **Vérification**:
  - modifier `doc/TODO.md` en cours de route (via UI et/ou éditeur externe) → le Manager intègre.
  - `Pause/Resume`, puis `Stop/Continue` → reprise avec resume packet.
  - crash (kill backend) → relance et reprise au bon endroit.
  - question courte (“Quelle ville ?”) → réponse → reprise et completion.
 - **Tests à exécuter (obligatoires)**:
   - Codex: integration/e2e “pause/resume/stop/continue” + crash recovery + thread policy.
   - AG: test UI “Phase 3” exhaustif (TODO editor+diff, task list, thread policy controls, pause/continue) selon `doc/TESTING_PLAN.md`.

---

## Phase 4 - Agent Observer (monitoring en lecture seule)

**Objectif**: permettre a l'utilisateur d'interroger en temps reel un agent dedie (en lecture seule) sur l'etat d'avancement du run, sans perturber le pipeline principal (Manager + Dev Codex + Dev AG).

Reference spec complete: `doc/SPEC.md` section 12.

### 4.1 Agent Observer (run AG parallele, read-only)
- [ ] Implementer l'Observer comme un run AG separe (newConversation=true), tournant en parallele.
- [ ] Prompt par defaut: lire `data/pipeline_state.json` + `data/tasks/*/` + logs et resumer l'etat du run.
- [ ] Instruction explicite read-only: **"Tu es en lecture seule. N'ecris aucun fichier dans le projet cible."**
- [ ] Output de l'Observer dans `data/AG_internal_reports/observer/` (dedie, hors protocole standard).

### 4.2 UI - Fenetre Chat Observer
- [ ] Ajouter une fenetre de chat separee dans l'UI Antidex pour l'Observer.
- [ ] Zone de saisie libre: poser n'importe quelle question sur l'etat du run.
- [ ] Message par defaut (si pas de question): "Donne l'etat actuel du developpement du projet dont le runId est <runId>.".
- [ ] Historique Q/R dans cette fenetre (distinct des logs SSE principaux).
- [ ] Indicateur clair "Observer (lecture seule)".

### Critere de succes Phase 4 (testable)
- **Test**: interroger l'Observer pendant un run actif.
- **Verification**:
  1) L'Observer repond sans modifier aucun fichier du projet cible.
  2) La reponse est coherente avec l'etat reel du run (tache, phase, iteration).
  3) Le run principal n'est pas affecte.
- **Tests a executer (obligatoires)**:
    - Codex: verifier isolation (l'Observer n'ecrit rien hors `data/AG_internal_reports/observer/`).
    - AG: test UI "Phase 4" (fenetre chat, Q libre, message par defaut) selon `doc/TESTING_PLAN.md`.
