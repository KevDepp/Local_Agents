# Testing Plan â€” Antidex (Hybrid pipeline)

Note: ce document dÃ©crit les tests de l'**orchestrateur Antidex** (backend + UI Antidex).
Les tests du **projet cible** (le logiciel que Antidex est en train de dÃ©velopper) doivent Ãªtre dÃ©crits et suivis dans
le `doc/TESTING_PLAN.md` du projet cible (crÃ©Ã©/maintenu par le Manager dans le `cwd`).

## Unit (Codex)
- Protocole fichiers: generation paths + validation JSON minimal.
- Parser/sync `data/pipeline_state.json` (developer_status, manager_decision, etc.).
- Watchdog AG: ACK best-effort:
  - ne pas "inferer" un ACK a partir de simples mtimes sous `data/antigravity_runs/<runId>/`,
  - sur timeout ACK: tenter une re-dispatch (nouveau thread) 1x avant escalation,
  - tolere ACK manquant si RESULT valide.
- Watchdog AG: waiting_result applique ANTIDEX_AG_STALL_RESULT_MS (threshold plus long apres ACK).
- Watchdog AG: override par tache via `ag_expected_silence_ms`/`ag_expected_silence_minutes` et extension du seuil en waiting_result.
- Watchdog AG: message `Q-watchdog` inclut le seuil effectif + rappel d'override pour taches browser-only longues.
- AG watchdog: incident `ag/watchdog` doit rester une action Manager (Q-watchdog) et **ne pas** declencher le Corrector.
- Guardrail dispatch vs AG stalls: si agRetryCounts>=3, l'orchestrateur doit emettre "AG disabled" avant tout `dispatch_loop` generique.
- Guardrail loop: answering `Q-loop` exige un changement d'etat (developer_status=ongoing/ready_for_review OU manager_decision=blocked/completed).
- Continue recovery: apres `Stop` puis `Continue pipeline`, reset des compteurs transients (retry/dispatch) pour la tache courante, pour eviter un re-blocage immediat.
- Builder prompt AG: inclut chemins absolus (ack/result/pointer/marker/heartbeat) et tolère ACK manquant si RESULT valide.
- Turn inactivity: une commande longue (commandExecution) sans output pendant > inactivity threshold ne doit pas declencher `turn/inactivity`; le hard-timeout reste actif.
- Developer postconditions: si `dev_ack.json` + `dev_result.*` existent mais `developer_status` reste `ongoing`/manquant, l'orchestrateur auto-promote vers `ready_for_review` (ou `waiting_job` si requete/job long job detecte) et journalise dans `data/recovery_log.jsonl`.
- Long job scope mismatch: si une requete long job cible un mode joueur hors scope (ex: 2p vs 3p attendu), l'orchestrateur bloque avec question Manager, supprime la requete invalide, et ne fait pas echouer le tour.
- Review loop: apres un review valide (decision + state coherents), le compteur de reviews pour la tache est remis a zero.
- Review loop: apres reponse Manager a `Q-review-loop`, le compteur est remis a zero; la reprise auto apres REWORK exige `dev_result.*` (ou result.json AG) plus recent que `manager_review.md` et ignore `dev_ack.json` seul.
- Review Manager freshness: verifier qu'un tour `reviewing` passe si `manager_review.md` contient `Turn nonce: <turn_nonce>` du tour courant, meme si le `mtime` n'a pas bouge comme attendu.
- Dispatch loop: apres un review valide (ACCEPTED/REWORK), le compteur de dispatch pour la tache est remis a zero afin que `dispatch_loop` ne bloque pas des cycles de rework deja reviews.
- Rebase TODO apres REWORK (meme tache): si le Manager ecrit `manager_decision=continue` + `developer_status=ongoing` sur la tache courante, la rebase TODO ne doit pas rebasculer en `ready_for_review` juste parce qu'un ancien `dev_result.md` existe deja.
- REWORK outcome-driven stale evidence: si `manager_review.md` est `REWORK` sur une tache outcome-driven, ni le Developer ni le Manager answering ne doivent pouvoir remettre `developer_status=ready_for_review` tant que les reports/resultats references par la tache n'ont pas ete regeneraes apres ce `manager_review.md`.
- REWORK outcome-driven dev_result freshness: si `dev_result.md|json` cite un report `reports/*.json`, ce report doit lui aussi etre plus recent que `manager_review.md`; reecrire `dev_result.*` en citant un report stale ne doit pas permettre `ready_for_review`.
- REWORK outcome-driven planning opt-in: si `manager_instruction.md` ou `manager_review.md` contient `Reviewed evidence may be reused for planning this step: yes`, le prompt developer doit rappeler que l'artefact deja reviewe peut servir a choisir la prochaine modification, mais qu'une preuve fraiche reste obligatoire avant `ready_for_review`.
- Rebase TODO hors REWORK manager: un rebase normal (`user_command_processed`, resume, etc.) peut encore promouvoir `ready_for_review` si des artefacts `dev_result.*` valides existent deja.
- Auto-promotion developer_status: un ancien long job terminal ne doit jamais re-promouvoir `waiting_job` juste parce que `job.json` est encore `running`; il faut une requete pending protocol-aware ou un vrai job vivant sans `result.json` terminal.
- Auto-promotion outcome-driven: l'auto-promotion `ongoing -> ready_for_review` doit repasser par le meme guardrail de fraicheur que le post-check developer; sur `REWORK`, l'orchestrateur ne peut pas auto-promouvoir `ready_for_review` avec des preuves stale.
- Guardrail REWORK outcome-driven:
  - si la tache est `benchmark|gate|tuning|research|ai_baseline_fix|manual_test`, un `REWORK` sans bloc `Goal check:` doit echouer,
  - `Goal check` doit contenir `Final goal`, `Evidence that invalidates`, `Failure type`, `Decision`, `Why this is the right level`,
  - `Failure type` doit etre valide (`local_task_issue|measurement_or_protocol_issue|upstream_plan_issue`).
- Guardrail REWORK reorientation:
  - si `Failure type=upstream_plan_issue`, `doc/TODO.md` doit changer dans le tour ET le premier item TODO non coche ne doit plus etre la tache courante,
  - sinon la review echoue.
- Guardrail REWORK rerun local:
  - si `Failure type!=upstream_plan_issue`, `manager_review.md` doit contenir `Rerun justification:` avant de permettre un rerun local.
- Signal developer outcome-driven:
  - `developer_codex`: `dev_result.md` doit contenir `What this suggests next:` + les 5 labels requis quand `developer_status=ready_for_review`,
  - `developer_antigravity`: `result.json.output.what_this_suggests_next.*` doit etre present pour les taches outcome-driven.
- Builder prompts:
  - prompt developer (Codex): inclut `manager_review.md` quand le fichier existe (sinon ignore),
  - prompt AG: si `manager_review.md` existe et `Decision: REWORK`, le dispatch mentionne explicitement REWORK et inclut `manager_review.md` dans la liste de lecture.
- Protocole taches: creation/validation dossier `data/tasks/T-xxx_<slug>/...` + schemas ACK/RESULT.
- Protocole mailbox: generation/validation des pointeurs `data/mailbox/to_*/*.pointer.json`.
- Runner Antigravity: creation run dir, prompt builder, waitForAck/result.
- Turn soft-timeout (commandExecution):
  - si une commande depasse `ANTIDEX_TURN_SOFT_TIMEOUT_MS_COMMAND`, l'orchestrateur emet un warning mais **n'interrompt pas** le tour,
  - optionnel: si `ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS_COMMAND` est configure et qu'aucune activite n'est observee pendant
    `ANTIDEX_TURN_SOFT_STALL_GRACE_MS` apres soft-timeout, escalation en incident `where=turn/soft_timeout` + `developer_status=blocked`.
- Turn timeout anti-limbo:
  - sur `turn/inactivity` ou `turn/hard_timeout`, le run doit etre en `developer_status=blocked` (developer) ou `status=failed` (non-developer),
    jamais en `developer_status=ongoing` avec juste `lastError`.
- Corrector: un "Run stopped" (stop/pause utilisateur) ne doit pas declencher le Corrector, meme si `lastError.where=manager/user_command` ou `auto`.
- Guardrail missing current_task_id:
  - si `current_task_id` manque dans `data/pipeline_state.json`, l'orchestrateur met `developer_status=blocked` + incident `where=guardrail/missing_current_task_id`.
- Long jobs: `job/crash` tente 1 auto-restart; si echec, bloque Manager avec `Q-job-crash` et **ne** declenche pas le Corrector.
- Long job background (developer_codex):
  - ecrire une requete sous `data/jobs/requests/REQ-*.json` (helper: `tools\\antidex.cmd job start ...`) -> l'orchestrateur cree `data/jobs/<job_id>/job.json`, lance le process et fait passer le run en `waiting_job`
  - pendant `waiting_job`, aucun timeout `turn/*` ne doit etre emis pour le developer tant que le job est sain
  - le watchdog job emet `job/stalled` / `job/crash` / `job/monitor_missed` selon les signaux observes
  - le monitor Codex ecrit `monitor_reports/REP-*.md` + `latest.*` a la cadence attendue et peut emettre `continue|stop|restart|wake_developer|escalate_manager`
  - si un rapport monitor manque a l'echeance + grace, le Correcteur externe doit etre reveille
  - si le pipeline est `stopped` pendant qu'un long job reste vivant, `GET /api/jobs/state` doit encore remonter le job actif et l'UI doit permettre `Stop long job`
  - `POST /api/jobs/stop` pendant `pipeline.status=stopped|paused|canceled` doit tuer le job sans relancer implicitement le pipeline
  - `Continue` sur un ancien `waiting_job` sans job vivant ni requete pending doit recuperer vers un vrai nouveau tour developer
  - si `result.json` terminal existe deja pour le dernier job mais que `data/pipeline_state.json` est reste en `developer_status=waiting_job`, une simple sync doit remettre le fichier en `developer_status=ongoing` avant toute reprise
- si `job.json` est reste `running` mais que `result.json` est terminal et le pid est mort, l'API/UI long-job doit afficher le statut terminal reel (`done`/`error`/`stopped`), pas `running`
- si `job.json` ou `monitor_reports/latest.*` sont encore stale (`running/continue`) alors que `result.json` est terminal, une simple sync/API read doit re-ecrire ces artefacts en etat terminal canonique au lieu de seulement masquer l'incoherence a l'affichage
  - un vieux `job.json` stale `running` + `result.json` terminal + pid mort ne doit pas valider `developer_status=waiting_job`; seule une vraie requete pending ou un vrai job encore vivant doit passer
  - si aucun `monitor_reports/latest.*` n'existe pour un job terminal, l'API/UI doit exposer un monitor synthétique minimal (`status`, `decision`, `summary`) au lieu de `(no monitor report yet)`
- apres un `result.json` terminal + `wake_developer`, l'orchestrateur doit regenerer `data/tasks/<task>/latest_long_job_outcome.json|md`
- le prompt developer doit lire `latest_long_job_outcome.md` avant `manager_instruction.md`
- `latest_long_job_outcome.*` doit inclure les resultats clefs du `result.json` reel, y compris quand le wrapper ecrit `output` + `summary` au niveau racine au lieu de `outputs[]`
- un `stop` suivi d'un resume packet ne doit pas figer un snapshot stale `waiting_job` si un `result.json` terminal existe deja
- si le developer conclut `blocked` apres avoir consomme `latest_long_job_outcome.*`, le pipeline doit enchainer vers `manager/answering` et ne doit pas ouvrir d'incident Corrector `developer_status is blocked`
  - `pipeline_state.json.tests.notes` ne doit plus dire "waiting for ..." quand le dernier job est deja terminal; il doit indiquer que le resultat terminal doit etre consomme par le developer
  - si un ancien job mort existe mais qu'une nouvelle requete `REQ-*.json` est creee, l'orchestrateur doit demarrer le nouveau job et ne pas auto-redemarrer l'ancien
  - a chaque sync/entree review/entree developer/demarrage-fin-stop job, l'orchestrateur doit regenerer `data/tasks/<task_id>/long_job_history.json|md`
  - `long_job_history.json` doit consolider au minimum attempts, latest_manager_review et le monitor synthetique d'un job terminal sans `latest.*`
  - si `manager_review.md` cite explicitement un `job_id`, l'historique doit rattacher cette review a la tentative correspondante
  - `GET /api/jobs/state` doit renvoyer `taskHistory.markdown|json` quand l'historique existe
  - l'UI long-job doit afficher la reference `history=.../long_job_history.md` dans le resume meta quand l'historique existe

## Commandes rapides (Codex) â€” orchestrateur Antidex
- Phase 2 (connector + protocole fichiers AG) en mode deterministe: `npm run test:phase2`
  - note: par defaut, ce test force `ANTIDEX_FAKE_CODEX=1` (override possible via env).
- UI orchestrateur (Playwright) en mode deterministe: `npm run test:pw`
  - le wrapper `scripts/run-playwright.js` cherche d'abord `Antidex_V2/node_modules`, puis un fallback compatible dans `../Antidex/node_modules`.
  - verifier aussi le cas `corrector/restart_required` sur long job: `status=stopped`, `developerStatus` ne redevient pas `waiting_job`, et le panneau long-job n'affiche plus de job actif fantome.

## Integration (Codex)
- API backend:
  - start/pause/resume/stop/continue/cancel
  - SSE stream par role
- Robustesse (watchdog/recovery):
  - simuler absence d'ACK/RESULT et verifier detection timeout (seuil 10 min) + retry + ecriture `data/recovery_log.jsonl`
  - simuler `BROWSER_BLOCKED` pour AG et verifier pause 30 min + relance (ou mock timer)
  - simuler un long job sain: run -> `waiting_job` -> rapport monitor -> `result.json` -> reveil developer
  - simuler un long job sans heartbeat/progress -> incident `job/stalled`
  - simuler un monitor manquant -> incident `job/monitor_missed` + pending marker pour Correcteur externe
  - lancer `npm run test:longjobs` pour couvrir helper projet -> requete `command_argv` -> spawn background -> `result.json` -> reveil developer
  - verifier explicitement le cas Windows initial: `--script` / argv structure ne doivent pas etre tronques, et un job silencieux mais vivant ne doit pas etre reveille avant la fin de la fenetre de warmup
  - simuler un `REWORK` outcome-driven avec `Failure type=upstream_plan_issue`: verifier que le run est rebased vers le premier item TODO non coche apres review valide
- Git/GitHub workflow:
  - repo git present: apres ACCEPTED, 1 commit est cree et le hash est note dans `manager_review.md`
  - pas de remote `origin`: declencher une tache AG "create repo" et verifier que l'URL est recuperable et que `git remote add origin` + `git push` fonctionnent (ou qu'une erreur d'auth est transformee en `blocked` avec message clair)
- Bootstrapping projet cible:
  - mode "nouveau projet": `workspace_cwd` + `createProjectDir=true` -> `project_cwd` cree en sous-dossier et `doc/` n'apparait pas a la racine du workspace
  - creation `doc/*` + `agents/*` + `data/pipeline_state.json`
  - creation `data/antidex/manifest.json` (marker + `layout_version`)
  - migrations non destructives: simuler un manifest ancien + verifier ajout de fichiers manquants sans ecrasement
  - creation `data/tasks/` + `data/mailbox/`
  - index docs a jour
  - non destructif: un fichier existant n'est pas ecrase (ex: `agents/*.md`, `doc/TODO.md`)
  - templates: `cwd/agents/*.md` ont `version: 1` et `updated_at` remplace (pas `<ISO>`)
- Politique threads:
  - Manager: reuse dans une session; apres Stop/Continue, un nouveau thread est acceptable si resume packet OK
  - Dev Codex/AG en reuse par defaut
  - Basculer une tache en `new_per_task` et verifier que l'orchestrateur demarre un nouveau thread/conversation pour cette tache
- Pilotage utilisateur:
  - modifier `doc/TODO.md` pendant un run (ajout/modif d'une demande) et verifier que le Manager le prend en compte au cycle suivant (preuve: review/decision + mise a jour taches)
  - UI: bouton "Send to manager" (override) -> creation `data/user_commands/CMD-*.md` + execution step Manager `user_command` + mise a jour TODO/taches avant de continuer (preuve: Playwright `playwright-tests/ui-send-to-manager.spec.js`)
    - cas run `completed`: l'override doit soit re-ouvrir du travail (au moins 1 item TODO non coché avec owner), soit confirmer explicitement `manager_decision=completed` (sinon l'orchestrateur doit retry/bloquer)
    - cas echec postconditions apres retries: si Correcteur est active, un incident `manager/user_command` doit etre ecrit et le Correcteur peut etre declenche (sinon rester bloque avec erreur actionnable)
    - cas double envoi: si un 2e message arrive pendant qu'un `pendingUserCommand` est encore en cours, Antidex doit creer un `queuedUserCommand`; si un 3e/4e message arrive avant livraison, ils doivent etre fusionnes dans le meme bundle et traites juste apres le 1er message, avant tout dispatch developer
    - cas `Save + Continue` sans vrai changement de contenu TODO: ne doit pas re-injecter un `user_command` `todo_updated`
    - cas `Save + Continue` avec vrai changement de contenu TODO: doit injecter exactement 1 reconcile Manager `todo_updated`
  - TODO rebase: apres un `user_command` qui ajoute une tache TODO sans spec, l'orchestrateur rebascule vers la tache, cree `Q-missing-task-spec`, passe `developer_status=blocked` et **ne declenche pas** le Correcteur; le Manager doit creer `task.md` + `manager_instruction.md` puis `Continue`.
  - UI: editer `doc/TODO.md` dans l'UI et verifier que le diff "sur disque" fonctionne (modifier via editeur externe pendant que l'UI est ouverte)
  - Review Manager outcome-driven: verifier que le prompt fournit un template `manager_review.md` avec `Goal check:` + `Rerun justification:` deja presents, et qu'un retry pour label manquant ne fait pas apparaitre un faux dispatch developer
- UI: vue "liste des taches" derivee de `data/tasks/*` (statuts + navigation vers preuves)
- UI: controles thread policy (dev Codex + dev AG) et visibilite de la policy effective par tache
- UI long job:
  - panneau job visible avec statut, duree, ETA, dernier heartbeat/progress, dernier rapport monitor
  - indicateur explicite "aucun agent actif, calcul en background" pendant `waiting_job`
  - apres crash/fin, le panneau conserve le dernier job connu (`lastJobId`) et son `latest.md`; il ne doit pas repasser a vide tant qu'un dernier job existe
  - apres `wake_developer` sur crash, le resume pipeline doit parler de `crashed`/`ended`, jamais de `finished` si le rapport monitor dit `crashed`
  - apres `result.json.status=error|failed`, le pipeline doit reveiller le developer sans classer le job en `crashed`
  - actions manuelles distinctes `Stop pipeline` vs `Stop long job`; l'UI doit afficher explicitement le cas `pipeline=stopped, long_job=running`
  - actions manuelles `Force monitor now`, `Stop long job`, `Restart job`, `Open stdout/stderr/result`
- Questions rapides (Q/A):
  - developer ecrit `questions/Q-001.md` et passe `developer_status=blocked`
  - manager repond via `answers/A-001.md` et relance le developer
- Manager review guardrail:
  - scenario ACCEPTED + continue vers une nouvelle tache sans `task.md`/`manager_instruction.md` -> la review doit echouer et bloquer avec un message actionnable
- Pause/Resume/Stop/Continue:
  - Pause pendant un tour Codex (best-effort interrupt), puis Resume et verification que l'orchestrateur reprend au bon endroit
  - Stop puis Continue (nouvelle session): verifier que les agents sont recontextualises via resume packet (preuve: logs + pointeurs vers fichiers)

## E2E (Codex + AG)
Preconditions:
- `codex app-server` disponible (extension VS Code Codex ou `codex.exe`)
- `antigravity-connector` disponible sur `http://127.0.0.1:17375` (Antigravity)
- Pour injection fiable: Antigravity lance avec `--remote-debugging-port=9000`

Scenario minimal:
1. Lancer l'orchestrateur (UI web).
2. Choisir un `cwd` de test (petit projet fixture).
3. Prompt: demande simple (ex: ajouter une fonction + test).
4. Manager planifie, puis assigne au dev Codex 1 tache, verification OK.
5. Assigner une tache Antigravity (ex: ouvrir un site et ecrire un resultat.json) et verifier `result.json`.
6. En cours de run, l'utilisateur edite `doc/TODO.md` (ajoute une exigence) via l'UI (et/ou via editeur externe) puis verifier que le Manager la detecte et l'integre dans les taches suivantes.
6b. En cours de tache, le developer pose une question courte; le manager repond; le developer reprend et termine la tache.
7. Thread policy check:
    - run court: reuse par defaut (un seul thread dev par role)
    - run plus long: forcer `new_per_task` sur une tache, verifier qu'un nouveau thread/conversation est utilise pour cette tache
7b. Pause/Resume puis Stop/Continue:
    - Pause, Resume et verifier etat correct
    - Stop puis Continue et verifier recontextualisation + reprise correcte
8. Completion: manager_decision=completed, docs coherentes.

## Robustesse (E2E / manuel)
- AG stuck: lancer une tache AG et forcer aucun fichier `ack.json`/heartbeat pendant >10 min (ou mock) -> verifier retries x3 + `developer_status=failed` + decision Manager.
- Codex dev stuck: lancer une tache Codex et forcer aucun `dev_ack.json`/modifs pendant >10 min (ou mock) -> verifier retries x3 + `developer_status=failed`.
- Recovery log: verifier que chaque detection/retry est trace dans `data/recovery_log.jsonl` et visible via logs UI.

## Correcteur (auto-fix Antidex) â€” Tests E2E (supervisor requis)

Objectif: valider le chemin **end-to-end**:
`incident detecte -> Correcteur declenche -> patch -> restart (exit 42) -> auto-resume -> reprise du run`.

### Test deterministe (recommande, reproductible)

Ce test ne depend pas du comportement LLM: il utilise un mode test qui simule un "fix" reussi, afin de valider
l'infrastructure (incidents, restart supervisor, auto-resume).

- Commande: `npm -C Local_Agents/Antidex_V2 run test:corrector:e2e`
- Ce que le test verifie:
  - creation d'un `INC-*.json` + `INC-*_result.json` dans `Local_Agents/Antidex_V2/data/incidents/` (via `ANTIDEX_DATA_DIR` temp),
  - ecriture d'un marqueur `data/corrector_test/fix_*.json`,
  - restart detecte (PID change sur `/health`),
  - `data/auto_resume/pending.json` est consomme apres restart,
  - le run n'est pas laisse en `status=failed` apres la reprise.

### Test "reel" (LLM) (manuel)

Ce test verifie que le Correcteur (agent Codex) peut **reellement** patcher Antidex pour debloquer un run.
Il est moins deterministe et peut consommer plus de tokens.

- Pre-requis: Antidex demarre via supervisor (`start-ui.cmd` ou `npm start`).
- Methode:
  1) Provoquer un incident reproductible (ex: guardrail strict, validation trop stricte, etat incoherent).
  2) Verifier qu'un incident `INC-*.json` est ecrit.
  3) Observer les events "Corrector agent starting" puis "Restarting server via code 42...".
  4) Apres restart, verifier que le run reprend.

Cas sans supervisor:
- Lancer Antidex sans `ANTIDEX_SUPERVISOR=1`, provoquer un incident et verifier que le Corrector est **triggered**.
  - Si un restart est requis, le run doit se mettre en stop avec un message clair "restart requis" (pas de boucle d'incidents).

## Correcteur externe (Guardian) â€” Tests manuels (Antidex_V2)

Objectif: valider le chemin "incident -> marker pending -> Corrector declenche via API -> reprise" en mode `ANTIDEX_EXTERNAL_CORRECTOR=1`.

- Pre-requis: demarrer Antidex_V2 via Guardian (`start-ui-guardian.cmd` ou `npm -C Local_Agents/Antidex_V2 run start:guardian`).
- Methode:
  1) Lancer un run (n'importe lequel) et recuperer son `runId`.
  2) Provoquer un incident (synthetique) via l'API: `POST /api/test/triggerCorrector` (payload: `{ "runId": "...", "where": "guardrail/review_loop", "message": "synthetic incident (guardian)" }`).
  3) Verifier que `data/external_corrector/pending.json` apparait puis est renomme en `handled_*.json`.
  4) Verifier qu'un `INC-*.json` est present dans `data/incidents/`.
  5) Verifier dans les logs Guardian qu'il a appele `POST /api/corrector/run_pending`.
  6) Si restart (code 42): verifier respawn, puis auto-resume via `data/auto_resume/pending.json`.

## Auditeur externe periodique (prochaine implementation) â€” Tests attendus

Objectif: valider le chemin `audit read-only -> rapport -> (optionnel) recommandation d'incident -> incident officiel -> Correcteur`.

### A) Mode passive (obligatoire en premier)
- Pre-requis:
  - `ANTIDEX_EXTERNAL_AUDITOR=1`
  - `ANTIDEX_AUDITOR_MODE=passive`
- Cas a verifier:
  1) Run sain en cours:
     - un `AUD-*.json` + `AUD-*.md` est ecrit sous `data/external_auditor/<runId>/`
     - `latest.json` + `latest.md` pointent vers le dernier rapport
     - aucune creation d'incident
     - aucun `data/external_auditor/pending.json`
  2) Run avec signature connue mais sans enforcement:
     - conclusion `suspicious` ou `incident_recommended`
     - recommendation visible dans le rapport
     - aucun stop automatique
  3) Run `paused|stopped|completed`:
     - pas de nouvel incident automatique
     - pas de Correcteur declenche

### B) Mode enforcing (whitelist restreinte)
- Pre-requis:
  - `ANTIDEX_EXTERNAL_AUDITOR=1`
  - `ANTIDEX_AUDITOR_MODE=enforcing`
  - whitelist limitee a 1-2 signatures MVP
- Cas a verifier:
  1) `job/active_reference_incoherent`:
     - l'auditeur ecrit un rapport `incident_recommended`
     - `data/external_auditor/pending.json` apparait
     - le Guardian / backend revalide puis cree un `INC-*.json`
     - le run est stoppe proprement
     - le flux correcteur externe reprend via `data/external_corrector/pending.json`
  2) `review/stale_loop_high_confidence`:
     - l'incident n'est ouvert que si la preuve locale est revalidable
     - pas de double incident pour la meme signature avant cooldown

### C) Dedup / cooldown
- Ouvrir deux fois la meme signature sur le meme run sans nouvelle preuve:
  - un seul incident officiel doit etre cree pendant la fenetre de cooldown
- Changer un element cle (nouveau job, nouveau task id, nouveau result):
  - une nouvelle recommendation doit redevenir possible

### D) Read-only safety
- Pendant un audit sur run actif:
  - aucun fichier du projet cible ne doit etre modifie
  - aucun fichier `server/`, `web/`, `scripts/` Antidex ne doit etre modifie
  - seules les sorties `data/external_auditor/*` sont autorisees
  - aucun appel a `Pause/Stop/Continue` n'est emis directement par l'auditeur

### E) UI / observabilite
- Verifier qu'un utilisateur peut voir:
  - le dernier rapport d'audit
  - le mode `passive|enforcing`
  - si une recommendation d'incident est en attente de revalidation

## UI orchestrateur Antidex (AG) â€” tests manuels exhaustifs

Owner: **AG** (le test UI doit etre execute par Antigravity).

But: valider que l'UI de l'orchestrateur (web UI locale Antidex) permet de piloter et comprendre un run, et que les
fonctions d'intervention utilisateur (TODO editable + diff, task list, thread policy, pause/continue) sont fiables.

Artefacts attendus (dans le `cwd` de test utilise):
- un rapport: `data/AG_internal_reports/ui_orchestrator_test_report_<timestamp>.md`
- des captures: `data/AG_internal_reports/artifacts/ui_orchestrator/<timestamp>/*.png`
- une liste d'anomalies (dans le rapport) avec reproduction steps.

Checklist (a executer apres chaque phase qui modifie l'UI):

### A) Ecran Start / Configuration
- Verifier champ prompt (multiligne, copier/coller long texte).
- Verifier selection `cwd` via l'explorateur (cas normal + cas chemin invalide + droits insuffisants).
- Verifier selection des modeles (manager/dev codex) et affichage des valeurs effectives.

### B) Configuration Antigravity connector (si Phase 2+)
- Verifier edition `connectorBaseUrl`.
- Verifier panneau status: `/health` + `/diagnostics` (affichage lisible, erreurs bien expliquees).
- Simuler connector down (URL invalide): l'UI doit afficher une erreur actionable (pas juste "failed").

### C) Controles run (Start/Pause/Resume/Stop/Continue/Cancel)
- `Start`: lancement run + affichage runId + phase initiale.
- `Pause`: aucun nouvel agent ne doit etre lance; l'UI doit afficher "paused".
- `Resume`: reprise au bon endroit.
- `Stop`: arret session + etat resumable ("stopped").
- `Continue`: reprise en nouvelle session; verifier qu'un resume packet est utilise (preuve via logs/indication UI).
- `Cancel`: arret terminal; verifier que l'UI indique "canceled" et qu'un nouveau run est necessaire.

### D) Monitoring / Logs (SSE)
- Verifier affichage des logs par role (Manager / Dev Codex / Dev AG).
- Verifier que les logs continuent apres un refresh navigateur (reconnexion SSE) ou qu'un message clair explique la limitation.
- Verifier que l'etat run (phase/task/developer_status) se met a jour en temps reel.
- Verifier absence d'effet "flicker" / rafraichissement agressif (polling backstop limite quand SSE est actif).

### E) File viewer / Navigation
- Ouvrir la tache courante: `task.md`, `dev_ack.json`, `dev_result.*`, `manager_review.md`.
- Ouvrir `data/pipeline_state.json`.
- Si une tache AG a ete executee: ouvrir `data/antigravity_runs/<runId>/result.json` + afficher au moins 1 artifact (png).

### F) TODO (editable + diff)
- Ouvrir `doc/TODO.md` (du projet cible), verifier refresh.
- Charger un run existant via "Load selected": verifier que le TODO est visible (scroll/focus) et que le header indique un chargement reussi.
- Modifier dans l'UI puis Save: verifier que le fichier sur disque change.
- Verifier que l'indicateur `TODO: done/total` fonctionne aussi avec des listes numerotees (ex: `1. [x] ...`).
- Modifier `doc/TODO.md` via un editeur externe pendant que l'UI est ouverte:
  - l'UI doit detecter le changement (warning) et proposer un diff.
  - verifier que le diff est lisible et que les conflits sont geres (au minimum message clair).

### G) Vue "liste des taches"
- Verifier que `data/tasks/*` est liste et que les statuts derives sont coherents:
  - tache en cours / ready_for_review / accepte / rework / blocked.
- Si `doc/TODO.md` contient un ordre different (ex: gate task inseree): verifier que l'UI rend visible cet ordre (les IDs apparaissent dans l'ordre du TODO quand possible).
- Ouvrir une tache depuis la liste et naviguer vers les preuves.

### H) Thread policy controls
- Changer les defaults `reuse|new_per_task` (dev codex + dev AG).
- Lancer une tache avec `new_per_task` et verifier que l'UI rend visible la policy effective (et que l'orchestrateur l'applique).

### I) Pause/Continue + reprise (qualite)
- En cours de run: `Pause` puis `Resume` et verifier la coherence (pas de double-dispatch, pas de tache sautee).
- `Stop` puis `Continue`: verifier reprise correcte et absence de perte de contexte.
- Scenario crash recovery (si disponible): tuer backend, relancer, puis `Continue` et verifier reprise.

### J) Garde-fous directionnels long-job
- Tache reframee `3p`: verifier qu'un wrapper `2p` (`*_2p_job.cmd`) est refuse en postcondition developer et au demarrage job.
- Tache `3p` avec consigne explicite `EASY 3p control first`: verifier qu'un wrapper `MEDIUM` est refuse tant que `reports/easy_vs_easy_sanity_3p.json` manque.
- Verifier qu'un wrapper `3p` correct reste accepte et lance bien le job.
