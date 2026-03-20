# TODO â€” Antidex (Hybrid pipeline)

Format: `- [ ] P0|P1|P2 (Owner) Task (proof: files/tests/logs)`

## P0 â€” A trancher (spec/protocol)

- [x] P0 (Both) Valider le nom du dossier + convention de nommage (proof: `doc/DECISIONS.md`)
- [x] P0 (Both) Figer le protocole fichiers cote projet cible: `pipeline_state.json` + dossiers de taches + mailboxes + fichiers d'instructions (proof: `doc/SPEC.md`, `doc/DECISIONS.md`)
- [x] P0 (Codex) Specifier le mode "long job" pour `developer_codex`: enveloppe reusable, etat `waiting_job`, monitor Codex horaire, watchdog job, UI et correcteurs (proof: `doc/LONG_JOBS_SPEC.md`, `doc/SPEC.md`, `doc/ERROR_HANDLING.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`)
- [ ] P0 (Both) Definir "Definition of Done" par tache (preuves obligatoires) (proof: `doc/SPEC.md`, `doc/TESTING_PLAN.md`)

## Prochaine implementation apres stabilisation

- [ ] P0 (Codex) Ajouter un **auditeur externe periodique** read-only, distinct du Correcteur, avec rollout `passive` puis `enforcing` via whitelist de signatures a forte confiance. L'auditeur doit ecrire `data/external_auditor/<runId>/AUD-*.{json,md}` + `latest.*`, recommander un incident sans corriger lui-meme, et laisser au Guardian/orchestrateur la revalidation puis le handoff vers le Correcteur externe. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `server/index.js`, `web/app.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Recadrer l'**auditeur externe periodique** comme **agent dedie** et observateur generaliste: il doit pouvoir produire des anomalies observees hors signatures connues, et ne pas etre limite dans sa perception par une whitelist de bugs pre-etiquetes. Les signatures connues/predicats locaux ne doivent borner que l'**action automatique** (incident auto, recovery auto-cloturable), pas ce que l'auditeur a le droit de voir ou rapporter. (proof: `doc/SPEC.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`)
- [ ] P0 (Codex) Donner a l'auditeur un **contexte complet Antidex + projet cible** en tant qu'agent, comme les autres agents Antidex. Contrairement au Manager, l'auditeur doit comprendre a la fois le fonctionnement d'Antidex (orchestrateur, jobs, incidents, correcteur, guardian, docs de robustesse) et l'etat du projet cible courant. L'implementation backend ne doit fournir que l'orchestration, le packaging de contexte et la revalidation locale; elle ne doit pas remplacer le raisonnement principal de l'auditeur. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Ajouter une **memoire vivante des bugs/patterns** alimentee par Antidex lui-meme, separee en `scope=antidex|project`, avec etats `observed|corrected|validated|reopened` et liens vers incidents, audits, correctifs et validations. L'auditeur doit ecrire `observed|validated|reopened`; le Correcteur doit ecrire `corrected`. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `doc/SPEC.md`, `doc/DECISIONS.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Faire passer la memoire des bugs en mode **agent-authored, backend-committed**: l'auditeur doit proposer explicitement ses `memory_updates` dans `agent_report.json`, le Correcteur doit proposer explicitement ses `memory_updates` (au minimum `corrected`) dans un artefact dedie, et le backend doit seulement valider/committer ces transitions au lieu de les reconstituer librement. (proof: `server/pipelineManager.js`, `doc/agent_instruction_templates/auditor.md`, `doc/SPEC.md`, `doc/DECISIONS.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Relier les anomalies nouvelles observees par l'auditeur a un mecanisme de **promotion vers l'automatisation forte**: une anomalie doit pouvoir evoluer de `observed` vers pattern confirme puis potentiellement auto-actionnable quand Antidex dispose d'une classe canonique, d'une revalidation locale robuste et d'un branchement `enforcing`. Cette promotion ne doit pas refermer la perception de l'auditeur a un catalogue fixe. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `doc/SPEC.md`, `doc/DECISIONS.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Completer le flux `incident -> correcteur -> restart -> reprise` par une **verification de recovery**: `fix_status=success` ne doit plus fermer le cas a lui seul. L'auditeur periodique doit ensuite classer la recovery en `recovery_cleared|recovery_not_cleared|recovery_inconclusive|manager_action_required`, avec revalidation locale des predicates binaires. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `server/index.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Ajouter des **predicats de guerison par signature d'incident** et un etat `recovery verification pending`, pour distinguer "patch applique" de "run revenu sain". La fermeture automatique ne doit arriver qu'apres disparition revalidee de la signature d'origine + progres observable post-reprise. (proof: `server/pipelineManager.js`, `doc/SPEC.md`, `doc/CORRECTOR_FIX_PATTERNS.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Ajouter un **preflight Correcteur** et un **preflight reprise**: verifier avant auto-fix et avant auto-continue que l'environnement est executable (serveur sain, guardian/supervisor si requis, pas de tour concurrent, incident encore valide, contexte run/job/docs reconciliable). En cas d'echec, sortir explicitement en `environment_not_recoverable` plutot qu'en faux `success`. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `server/index.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Distinguer les **lanes de sortie de crise** du couple auditeur+correcteur: `auto_resume_safe`, `manager_action_required`, `environment_not_recoverable`, `recovery_not_cleared`, `recovery_inconclusive`. Le pipeline ne doit plus tasser ces cas sous un simple `blocked|stopped`. (proof: `server/pipelineManager.js`, `doc/SPEC.md`, `doc/ERROR_HANDLING.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Codex) Ajouter une **reprise surveillee post-fix**: apres restart et `Continue` best-effort, Antidex doit verifier l'apparition d'un progres mesurable (etat, timeline, turn, artefacts). Si la preuve n'est pas encore disponible, classer `recovery_inconclusive` et attendre les audits periodiques normaux, sans micro-boucle d'audits rapproches. (proof: `server/pipelineManager.js`, `scripts/guardian.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)
- [ ] P0 (Both) Specifier puis faire appliquer une **compaction de contexte pilotee par les agents**: le Manager doit savoir quand une tache est devenue trop bruyante, creer/maintenir `data/tasks/<task>/context_checkpoint.md`, distinguer ce qui reste directif vs ce qui devient seulement consultable, et releguer les anciennes tentatives dans `data/tasks/<task>/archive/` sans perte d'historique. Le protocole doit couvrir: criteres de declenchement, format du checkpoint, statut des documents archives, ordre de lecture pour Manager/Developer, et tracabilite dans `doc/DECISIONS.md` / `doc/INDEX.md`. (proof: `doc/SPEC.md`, `doc/DECISIONS.md`, `doc/agent_instruction_templates/manager.md`, `doc/agent_instruction_templates/developer_codex.md`)
- [ ] P1 (Codex) Ajouter des **helpers optionnels** de compaction/archivage explicitement invoques par les agents (scripts ou routines simples), sans logique autonome de tri: preparation d'un `context_checkpoint.md`, deplacement de fichiers superseded vers `archive/`, generation d'un index d'archive. Ces helpers doivent rester des outils au service du Manager, pas une source de decision parallele. (proof: `scripts/*`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`)

## P0 â€” Implementation (orchestrateur)

- [x] P0 (Codex) Rendre `npm run test:pw` robuste sans dependre de `npx` quand `Antidex_V2/node_modules` manque temporairement (proof: `scripts/run-playwright.js`, `package.json`)
- [x] P0 (Codex) Empecher l'etat incoherent `stopped + waiting_job` et les long jobs fantomes apres `corrector/restart_required` (proof: `server/pipelineManager.js`, verification API sur run reel)
- [x] P0 (Codex) Garder visible le dernier diagnostic de long job apres crash/fin et corriger le libelle trompeur `Long job finished` (proof: `server/pipelineManager.js`, `web/app.js`)
- [x] P0 (Codex) Fiabiliser le premier lancement long-job Windows: requetes structurees `command_argv`, spawn sans shell quand possible, warmup monitor anti-faux-positifs et smoke test dedie (proof: `server/pipelineManager.js`, `scripts/long-job-smoke-test.js`, `Games/odyssee-grenouilles/ai-lab/tools/antidex.js`)
- [x] P0 (Codex) Durcir les definitions de long jobs Windows: eviter `npm run ...` fragile, exiger un wrapper protocolaire (`heartbeat/progress/result`), et distinguer `result.json` terminal en echec d'un crash brut (proof: `server/pipelineManager.js`, `doc/LONG_JOBS_SPEC.md`, `Games/odyssee-grenouilles/ai_lab/scripts/run_medium_sanity_long_job.mjs`)
- [x] P0 (Codex) Recuperer proprement les `waiting_job` stale, exiger des requetes protocol-aware, et faire primer une nouvelle requete `REQ-*` sur tout vieux job mort (proof: `server/pipelineManager.js`, run reel `1c11dc2f...`)
- [x] P0 (Codex) Reconciler `pipeline_state.json` quand un long job a deja un `result.json` terminal mais que le fichier reste bloque en `developer_status=waiting_job` (proof: `server/pipelineManager.js`, `scripts/long-job-smoke-test.js`, run reel `1c11dc2f...`)
- [x] P0 (Codex) Clarifier la semantique `Stop pipeline` vs `Stop long job`: conserver un job vivant visible quand le pipeline est arrete, et ne pas relancer implicitement le pipeline lors d'un `Stop long job` sur run deja `stopped|paused` (proof: `server/pipelineManager.js`, `web/app.js`, `web/index.html`)
- [x] P0 (Codex) Consolider la memoire decisionnelle des long jobs par tache (`long_job_history.json|md`), l'injecter dans les prompts Manager/Developer et l'exposer dans l'API/UI jobs pour eviter les reruns decides sur donnees trop dispersees (proof: `server/pipelineManager.js`, `scripts/long-job-smoke-test.js`, `web/app.js`, `doc/SPEC.md`, `doc/LONG_JOBS_SPEC.md`, `doc/agent_instruction_templates/*.md`)
- [x] P0 (Codex) Ajouter un handoff canonique post-long-job (`latest_long_job_outcome.json|md`) et le faire primer dans le prompt developer apres `wake_developer`, avec nettoyage de `pipeline_state.json.summary/tests.notes` pour eviter les reruns decides sur un melange de contexte frais/stale (proof: `server/pipelineManager.js`, `scripts/long-job-smoke-test.js`, `doc/SPEC.md`, `doc/LONG_JOBS_SPEC.md`, `doc/DECISIONS.md`)
- [x] P0 (Both) Phase 1 demarree (2026-02-18): fork base dual_pipeline vers Antidex/server + Antidex/web (proof: tree)
- [x] P0 (Codex) Fork base `Local_Codex_dual_pipeline` -> nouveau backend + UI (proof: server/web structure dans `Antidex/`)
- [x] P0 (Codex) Phase 0 preflight (sanity checks): `npm run preflight` (ou `node scripts/preflight.js ...`) (proof: `Antidex/scripts/preflight.js` + report JSON)
- [x] P0 (Codex) Implementer la communication par fichiers:
  - `data/tasks/T-xxx_<slug>/...` (ACK vs RESULT)
  - `data/mailbox/to_*` + `data/mailbox/from_*` (pointeurs)
  - sync robust dans `data/pipeline_state.json` (proof: tests + doc)
- [x] P0 (Codex) Implementer systeme "instructions agents":
  - bootstrap `agents/manager.md`, `agents/developer_codex.md`, `agents/developer_antigravity.md` dans le projet cible (avec `version`/`updated_at`, Base + Overrides)
  - injecter un header "READ FIRST" au debut de chaque prompt (proof: logs + spec)
  - bootstrap non destructif: ne pas ecraser `agents/*.md` si deja presents (sauf si explicitement demande), et permettre au Manager de les modifier en cours de run (proof: tests + doc)
- [x] P0 (Codex) Exposer `manager_review.md` au developpeur quand il existe (eviter rework sans feedback) (proof: `server/pipelineManager.js`)
- [x] P0 (Codex) Implementer la politique threads:
  - Manager thread toujours reuse
  - Dev Codex + Dev AG: reuse par defaut, `new_per_task` sur decision Manager (proof: etat run + logs)
- [x] P0 (Codex) Ajouter role `developer_antigravity`:
  - client connector (`/health`, `/diagnostics`, `/send`)
  - run protocol fichiers (`data/antigravity_runs/<runId>/...`)
  - timeouts + erreurs + preuves (proof: tests unitaires + doc)
- [x] P0 (Codex) Etendre l'orchestrateur: selection du dev par tache + boucle "tache par tache" + verification Manager (proof: run e2e sur projet cible test)
- [x] P0 (Codex) Bootstrapping du projet cible (cwd) â€” squelette non destructif:
  - creer `doc/` + `agents/` + `data/` (tasks/mailbox/antigravity_runs) si absents
  - initialiser `data/pipeline_state.json`
  - copier les templates `doc/agent_instruction_templates/*` vers `cwd/agents/*` (remplacer `updated_at`, garder `version: 1`)
  - creer `cwd/doc/GIT_WORKFLOW.md` (copie depuis Antidex_V2 `doc/GIT_WORKFLOW.md`) si absent
  - ne pas ecraser si deja present; log "created vs existing" (proof: test integration + spec)
- [x] P0 (Codex) Marqueur projet Antidex + migrations (layout/versioning):
  - creer/maintenir `data/antidex/manifest.json` (marker + `project_id` + `layout_version`)
  - tracer les upgrades dans `data/antidex/migrations.jsonl`
  - migration non destructive (idempotente) si conventions evoluent (proof: tests + `doc/SPEC.md`)
- [x] P0 (Codex) UI: ajouter config Antigravity (URL connector, options) + monitoring 3 roles (proof: manuel)
- [x] P0 (Codex) Support "pilotage utilisateur":
  - exposer `doc/TODO.md` dans l'UI (lecture + refresh) + **edition** (editor + Save)
  - afficher un **diff** si `doc/TODO.md` a change (sur disque vs derniere version chargee)
  - ajouter une vue "liste des taches" (scan `data/tasks/*` + statuts + liens vers preuves)
  - exposer la **thread policy** (dev Codex + dev AG) et rendre visible la policy effective par tache
  - ajouter les controles `Pause` / `Resume` / `Stop` / `Continue` (proof: manuel + spec)
  - garantir que le Manager relit `doc/TODO.md` avant dispatch et apres chaque tache (proof: logs + spec)
- [x] P0 (Codex) Support "questions rapides" (Q/A) entre agents:
  - fichiers `data/tasks/.../questions/` + `answers/` + pointeurs mailbox (proof: spec + tests)
  - status `developer_status=blocked` quand une clarification est requise (proof: logs + e2e)
- [x] P0 (Codex) Git/GitHub workflow (projet cible):
  - policy "1 tache acceptee = 1 commit" (commit apres ACCEPTED; hash dans `manager_review.md`)
  - detection repo git / remote `origin`
  - si pas sur GitHub: tache AG "create repo" + config remote + push (proof: `doc/GIT_WORKFLOW.md` + test manuel)

## P1 â€” Qualite / ergonomie

- [ ] P1 (Codex) UI: Ajouter les paramÃ¨tres dynamiques (GitHub, ChatGPT, Ratio AG/Codex) et les injecter dans le prompt du Manager (proof: champs UI fonctionnels + verification payload backend)
- [ ] P1 (Codex) Logs browser: afficher aussi les runs Antigravity (runId -> result.json) (proof: UI)
- [ ] P1 (Codex) Reprise robuste apres crash: recharger etat depuis store + marqueurs projet cible (proof: test manuel)

## P1 â€” Robustesse (error handling, runs longs)

- [x] P1 (Codex) Implementer le mode long job `developer_codex`: API `/api/jobs/*`, dossier `data/jobs/<job_id>/...`, etat run `waiting_job` et reprise apres restart (proof: `server/pipelineManager.js`, `server/index.js`, `web/app.js`, `web/index.html`, `doc/LONG_JOBS_SPEC.md`)
- [x] P1 (Codex) Implementer le monitor Codex horaire des long jobs: rapports `monitor_reports/REP-*` + `latest.*`, decisions bornees (`continue|stop|restart|wake_developer|escalate_manager`) et reveil developer en fin de job (proof: `server/pipelineManager.js`, `web/app.js`, `doc/LONG_JOBS_SPEC.md`)
- [x] P1 (Codex) Implementer le watchdog long jobs: incidents `job/*` + reveil Correcteur externe si rapport monitor manquant (proof: `server/pipelineManager.js`, `doc/ERROR_HANDLING.md`)

- [ ] P1 (Codex) AG watchdog: ACK best-effort (activity -> proceed) + auto-resend once on first ACK timeout (proof: server/pipelineManager.js)

- [ ] P1 (Codex) AG watchdog: seuil de stall plus long en phase waiting_result (ACK observe) + env ANTIDEX_AG_STALL_RESULT_MS (proof: server/pipelineManager.js)

- [x] P1 (Codex) AG: prompt avec chemins absolus + tolérer ACK manquant si RESULT valide (proof: server/pipelineManager.js)

- [x] P1 (Codex) AG watchdog: override per-task via `ag_expected_silence_ms`/`ag_expected_silence_minutes` in task.md or manager_instruction.md for long browser-only tasks. (proof: server/pipelineManager.js)

- [x] P1 (Codex) Watchdog AG: inclure le seuil effectif + un rappel d'override dans la question `Q-watchdog` pour faciliter le déblocage. (proof: server/pipelineManager.js)

- [x] P1 (Codex) AG watchdog: ne pas declencher le Corrector sur `ag/watchdog` (action Manager via Q-watchdog). (proof: server/pipelineManager.js)
- [x] P1 (Codex) Long jobs: sur `job/crash`, tenter 1 auto-restart puis bloquer Manager avec `Q-job-crash`; ne pas declencher le Corrector. (proof: server/pipelineManager.js)

- [x] P1 (Codex) Guardrail dispatch vs AG stalls: si agRetryCounts>=3, bloquer via "AG disabled" avant tout `dispatch_loop` generique. (proof: server/pipelineManager.js)

- [x] P1 (Codex) Corrector: si supervisor absent, stopper le run apres fix et demander restart manuel (eviter loop d'incidents). (proof: server/pipelineManager.js)
- [x] P1 (Codex) Corrector: si supervisor absent, ne pas lancer l'auto-fix et demander restart sous supervisor. (proof: server/pipelineManager.js)
- [x] P1 (Codex) Corrector externe (Guardian, Antidex_V2): sur incident, stopper le run + ecrire `data/external_corrector/pending.json`; un daemon externe declenche `POST /api/corrector/run_pending` + Continue best-effort. (proof: `scripts/guardian.js`, `server/pipelineManager.js`, `server/index.js`, `start-ui-guardian.cmd`, `doc/SPEC.md`)
- [x] P1 (Codex) Corrector: un "Run stopped" (stop/pause utilisateur) ne doit jamais declencher le Corrector, meme si `lastError.where=manager/user_command` ou `auto`. (proof: server/pipelineManager.js)
- [x] P1 (Codex) User command queue V2: permettre un 2e `Send to manager` pendant qu'un `pendingUserCommand` est encore en cours, puis fusionner les messages suivants dans un seul bundle `queuedUserCommand` traite avant tout dispatch developer. (proof: `server/pipelineManager.js`, `playwright-tests/ui-send-to-manager.spec.js`, `doc/SPEC.md`)

- [ ] P1 (Codex) Manager review: si ACCEPTED + continue vers une nouvelle tache, exiger que `task.md` + `manager_instruction.md` de la tache suivante existent (sinon blocage avec question actionnable). (proof: server/pipelineManager.js + test)

- [x] P1 (Codex) TODO rebase: si la 1ere tache TODO non faite n'a pas de spec, bloquer le Manager avec Q-missing-task-spec et **ne pas** declencher le Correcteur (guardrail attendu). (proof: server/pipelineManager.js)

- [x] P1 (Codex) Guardrail loop: en answering `Q-loop`, exiger un changement d'etat (developer_status=ongoing/ready_for_review OU manager_decision=blocked/completed). (proof: server/pipelineManager.js)

- [x] P1 (Codex) Turn inactivity: suspendre le timeout d'inactivite pendant une commande longue (commandExecution) et s'appuyer sur le hard-timeout. (proof: server/pipelineManager.js)
- [x] P1 (Codex) Developer postconditions: si `dev_ack.json` + `dev_result.*` existent mais `developer_status` reste `ongoing`/manquant, auto-promote vers `ready_for_review` ou `waiting_job` selon evidence long job. (proof: server/pipelineManager.js)
- [x] P1 (Codex) Long job scope mismatch: si une requete long job est hors scope (2p vs 3p), bloquer via question Manager + nettoyer la requete invalide (pas d'echec dur). (proof: server/pipelineManager.js)
- [x] P1 (Codex) Developer questions: accepter `developer_status=blocked` si un `questions/Q-*.md` est nouveau (plus recent que `answers/A-*.md`), sans exiger `dev_result.*`. (proof: server/pipelineManager.js)

- [x] P1 (Codex) Review loop: reset du compteur apres un review valide (decision + state coherents) pour eviter des gardes-fous apres plusieurs cycles legitimes. (proof: server/pipelineManager.js)
- [x] P1 (Codex) Review loop: apres reponse Manager a `Q-review-loop`, reset compteur + ne pas auto-promouvoir sur `dev_ack.json` (exiger `dev_result.*`/result.json plus recent que `manager_review.md`). (proof: server/pipelineManager.js)
- [x] P1 (Codex) Dispatch loop: apres un review valide, reset le compteur de dispatch pour la tache (guardrail `dispatch_loop` ne doit pas pre-empter les cycles de rework deja reviews). (proof: server/pipelineManager.js)
- [x] P1 (Codex) Guardrail de reorientation outcome-driven: `Goal check` obligatoire sur REWORK benchmark/gate/tuning/research/manual_test + signal developer `What this suggests next` + rebase automatique au premier TODO non coche apres review. (proof: `server/pipelineManager.js`, `doc/SPEC.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`)

- [ ] P1 (Codex) Implementer protocole ChatGPT Consult dans l'orchestrateur:
  - detection automatique du seuil "6 iterations completees" et creation de la tache `T-xxx_chatgpt_review_iter_N`
  - verifier que `data/chatgpt_consults/` existe dans le bootstrap du projet cible (creer si absent)
  - verifier presence du fichier resultat apres la tache AG de review (proof: integration test)
  - script `code_bundle_packer.py` documente dans les instructions AG (chemin absolu reference)
  (ref: `doc/SPEC.md` section 13 + instructions agents)

- [ ] P1 (Codex) Implementer watchdog orchestrateur (poll ~5 min, seuil 10 min) (proof: logs + `data/recovery_log.jsonl`)
- [ ] P1 (Codex) **Watchdog filesystem AG** (Phase 2.5): surveiller mtime de `data/AG_internal_reports/` toutes les ~2 min; si inactivite >10 min en cours de tache AG, ceder la main au Manager (ref: `doc/ERROR_HANDLING.md` Annexe C)
- [ ] P1 (Codex) **Reload Window AG** (Phase 2.5): implementer `POST /api/command {command: workbench.action.reloadWindow}` vers connector; max 2 reloads par tache; journaliser dans `data/recovery_log.jsonl` (ref: `doc/ERROR_HANDLING.md` Annexe C)
- [ ] P1 (Codex) AG-1: detection blocage (ack manquant / heartbeat inactif) + retry x3 + mise en etat `failed` (proof: test simulation)
- [ ] P1 (Codex) AG-2: diagnostic "ALIVE + BROWSER_BLOCKED" + pause 30 min + relance (proof: test simulation)
- [ ] P1 (Codex) CODEX-1: detection blocage dev (ack/result + mtime projet) + retry x3 + mise en etat `failed` (proof: test simulation)
- [ ] P1 (Codex) CODEX-2: rate limit/tokens => arret gracieux + notification utilisateur + etat repris via `Continue` (proof: mock/manuel)
- [ ] P1 (Codex) UI monitoring: afficher derniere activite + tentative courante + access `recovery_log.jsonl` (proof: UI)

## P1 â€” Validation AG

- [ ] P1 (AG) Valider acces filesystem + ecriture des fichiers `data/antigravity_runs/*` dans un projet cible reel (proof: `result.json` + notes dans `doc/DECISIONS.md`)
- [ ] P1 (AG) Executer les tests UI **exhaustifs** de l'orchestrateur Antidex (proof: `data/AG_internal_reports/ui_orchestrator_test_report_*.md` + captures)
- [ ] P1 (AG) (Optionnel) Valider tests UI finaux sur une app web cible simple (proof: artefacts + notes)
- [ ] P1 (AG) Relecture documentation (doc review): relire SPEC/TODO/TESTING_PLAN/DECISIONS/INDEX d'un projet cible et proposer des corrections/clarifications (proof: changements docs + notes dans `doc/DECISIONS.md`)
- [ ] P1 (AG) (Owner: Manager + AG) Créer les **Instructions de Déploiement** officielles. Demander à AG de naviguer sur le site d'un provider VPS pour comprendre les étapes de location d'un serveur (pour l'instant sans aller jusqu'au paiement réel, utiliser juste les infos du site). AG doit documenter précisément ces étapes. Le Manager utilisera cette documentation pour rédiger l'instruction canonique de déploiement qui sera fournie aux futurs agents lors de la phase de déploiement d'un projet. Il faudra préciser "jusqu'où" AG est autorisé à aller par défaut. (proof: `doc/instructions_deploiement.md` + notes)

## P2 â€” Phase 4 (Agent Observer)

- [ ] P2 (Codex) Implementer l'Agent Observer: run AG parallele read-only, prompt par defaut, output dans `data/AG_internal_reports/observer/` (ref: `doc/SPEC.md` section 12 + `doc/IMPLEMENTATION_ROADMAP.md` Phase 4)
- [ ] P2 (Codex) UI Observer: fenetre chat separee dans l'UI Antidex (Q libre + message par defaut + historique Q/R + indicateur "lecture seule")


