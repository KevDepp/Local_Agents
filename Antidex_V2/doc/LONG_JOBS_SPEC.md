# Long Jobs Spec - Antidex_V2

But: definir un mode standard pour les calculs longs pilotes par `developer_codex` sans garder un tour LLM ouvert pendant des heures.

Statut:
- scope V1: `developer_codex` uniquement
- `developer_antigravity` hors scope dans cette version
- implementation livree dans `Antidex_V2` (orchestrateur + UI + API) — 2026-03-07

## 1. Objectif

Certaines taches ne sont pas de simples edits de code:
- benchmark massif
- simulation longue
- hyperparameter search
- optimisation iterative
- entrainement ML

Dans ces cas, garder le Developer Codex "dans un tour" pendant 1h a 10h est mauvais:
- consommation de tokens inutile
- timeouts fragiles
- mauvaise reprise apres crash
- observabilite mediocre

Le mode "long job" separe:
- le **code metier** du calcul, ecrit par le dev dans le projet cible
- l'**enveloppe Antidex**, reutilisable, qui lance/surveille/reprend le calcul

Le helper `tools/antidex.cmd job start` ne fait jamais le calcul lui-meme. Il ecrit une requete de job; l'orchestrateur lance ensuite une commande ou un script deja ecrit par le dev.

## 2. Quand utiliser ce mode

Le Manager doit demander explicitement le mode long job si la sous-tache dev:
- risque de depasser 10 a 15 minutes
- produit des artefacts intermediaires avant le resultat final
- peut raisonnablement etre executee comme un process autonome
- a un sens clair sans intervention LLM continue

Exemples:
- arene de benchmarks
- self-play / Monte Carlo
- tuning de coefficients
- entrainement avec checkpoints

Contre-exemples:
- simple migration de code
- petites commandes de test/build
- debug interactif court

## 3. Principe d'architecture

Le flux cible est:
1. Le Manager decide qu'une tache doit passer en mode long job.
2. Le Developer Codex ecrit ou complete le code metier necessaire dans le projet cible.
3. Le Developer Codex lance un job via l'enveloppe Antidex.
4. Le tour LLM du developer se termine rapidement.
5. Antidex met le run en `waiting_job`.
6. Le process de calcul tourne en background.
7. Un monitor Codex horaire relit les artefacts du job et ecrit un rapport.
8. A la fin du job, Antidex reveille le developer pour interpreter le resultat et iterer ou passer en review.

Consequence importante:
- pendant `waiting_job`, il ne doit y avoir **aucun timeout de tour LLM** puisqu'aucun agent ne doit etre "en train de penser"
- les garde-fous passent du monde "turn/*" au monde "job/*"

## 4. Contrat manager -> developer

Quand le Manager demande un long job, `manager_instruction.md` doit contenir au minimum:
- la raison de l'usage du mode long job
- la commande ou le type de commande attendu
- les artefacts de progression obligatoires
- les artefacts finaux obligatoires
- la frequence du monitor LLM
- les regles d'arret automatique
- les limites de relance automatique
- les criteres de succes et d'echec

Exigence explicite de spec:
- le Manager doit indiquer que `tools/antidex.cmd job start` fournit seulement l'enveloppe
- tout code metier specifique au calcul doit etre ecrit par le dev

## 5. Contrat developer

Avant d'appeler `tools/antidex.cmd job start`, le Developer Codex doit:
- ecrire le code metier du calcul dans le projet cible
- s'assurer que la commande est executable sans supervision LLM
- definir des fichiers de progression stables
- definir un resultat final machine-readable
- definir, si possible, des checkpoints de reprise

Le dev doit produire ou garantir:
- une commande unique reproductible
- un fichier de progression (`progress.json` ou equivalent)
- un heartbeat de job
- un resultat final atomique (`result.json`)
- des logs stdout/stderr
- sur Windows, une commande qui evite les couches CLI fragiles (`npm run ...`, quoting shell imbrique) quand l'outil cible parse deja ses propres flags

Le dev ne doit pas:
- laisser Antidex deviner la progression a partir de sorties non structurees uniquement
- garder un long tour ouvert pour "attendre"

Commande pratique (Windows, projet cible):
- prefere `--script` ou un argv structure apres `--`, pour eviter la casse des guillemets imbriques sous Windows
- `tools\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 --script .\\scripts\\bench.cmd`
- `tools\\antidex.cmd job start --run-id <RID> --task-id <TID> --expected-minutes 120 -- node .\\scripts\\bench.js --seed 1`
- `--command \"<cmd>\"` reste un mode legacy pour cas simples, mais ne doit plus etre la forme recommandee sur Windows
- si un benchmark est deja encapsule dans `npm run ...`, verifier explicitement que les flags arrivent intacts au process final; sinon lancer directement `node`, `tsx`, ou un wrapper JS qui pilote l'outil et ecrit `heartbeat/progress/result`

## 6. Envelope Antidex reutilisable

L'enveloppe reusable doit fournir:
- lancement du process en background
- capture stdout/stderr
- pid + statut du process
- suivi des heartbeats / progress
- checkpoints de reprise si le code metier les supporte
- reveil monitor horaire
- reveil developer a la fin
- UI de suivi
- incidents standardises

L'enveloppe ne fournit pas:
- l'algorithme de simulation
- le modele ML
- la logique de tuning
- la semantique metier du calcul

## 7. Dossier et fichiers standard

Pour chaque job:
- `data/jobs/<job_id>/job.json`
- `data/jobs/<job_id>/request.json` (copie de la requete consommee)
- `data/jobs/<job_id>/stdout.log`
- `data/jobs/<job_id>/stderr.log`
- `data/jobs/<job_id>/heartbeat.json`
- `data/jobs/<job_id>/progress.json`
- `data/jobs/<job_id>/result.json`
- `data/jobs/<job_id>/monitor_reports/REP-<timestamp>.md`
- `data/jobs/<job_id>/monitor_reports/REP-<timestamp>.json`
- `data/jobs/<job_id>/monitor_reports/latest.md`
- `data/jobs/<job_id>/monitor_reports/latest.json`

Selon le calcul, le code metier peut aussi produire:
- `checkpoints/`
- `artifacts/`
- `metrics/`

Memoire consolidee par tache:
- `data/tasks/<task_id>/long_job_history.json`
- `data/tasks/<task_id>/long_job_history.md`
- `data/tasks/<task_id>/latest_long_job_outcome.json`
- `data/tasks/<task_id>/latest_long_job_outcome.md`

But:
- condenser les tentatives long-job d'une meme tache dans une vue unique
- eviter les decisions manager/dev basees sur des artefacts disperses ou stale
- rendre explicites: ce qui a ete lance, ce qui a termine, ce qui a crash, et quelle conclusion manager est courante

Regle:
- ces fichiers sont regeneres par l'orchestrateur depuis les artefacts source (`request.json`, `job.json`, `result.json`, `monitor_reports/latest.*`, `manager_review.md`)
- ils ne remplacent pas les artefacts bruts; ils servent de memoire de decision lisible par les agents
- `long_job_history.json` doit au minimum contenir:
  - `schema = antidex.long_job.history.v1`
  - `generated_at`, `run_id`, `task_id`
  - `current_pipeline` (`run_status`, `developer_status`, `manager_decision`, `active_turn_role`, `summary`)
  - `counts` (`attempts_total`, `terminal_attempts`, `successful_attempts`)
  - `latest_attempt`
  - `latest_manager_review`
  - `attempts[]`
- chaque `attempts[]` doit au minimum contenir:
  - `attempt_index`, `job_id`, `request_created_at`, `started_at`, `ended_at`
  - `launch_kind`, `script_path`, `command`, `command_argv`
  - `job_status`, `result_status`, `display_status`
  - `pid`, `pid_alive`, `active`
  - `result_summary`, `result_error`
  - `outputs[]`
  - `latest_monitor`
  - `refs`
- si `manager_review.md` cite un `job_id`, l'orchestrateur doit rattacher cette review a la tentative correspondante dans l'historique
- la version markdown doit rester courte et directement exploitable par un agent:
  - etat pipeline courant
  - derniere evaluation manager
  - liste chronologique inversee des tentatives avec statut/resultat/refs

Handoff canonique post-long-job:
- `latest_long_job_outcome.*` est un artefact **operationnel** distinct de `long_job_history.*`
- il est regenere a chaque resultat terminal (`done|error|failed|stopped|canceled`) quand Antidex decide `wake_developer`
- il doit contenir au minimum:
  - `schema = antidex.long_job.outcome.v1`
  - `generated_at`, `run_id`, `task_id`
  - `current_pipeline`
  - `latest_terminal_attempt`
  - `previous_terminal_attempt` (resume minimal si present)
  - `delta_vs_previous_terminal_attempt`
  - `developer_action_now`
  - `forbidden_next_action_now`
  - `output_refs[]`, `key_results[]`
- sa version markdown doit etre breve et imperative:
  - quel job vient de finir
  - quels artefacts lire
  - quels resultats clefs ont ete observes (`wins_by_seat`, `illegal_moves`, `generated_at`, etc.) meme si le wrapper ecrit ces champs au niveau racine de `result.json` (`output` + `summary`) plutot que sous `outputs[]`
  - ce qui a change ou non depuis la tentative terminale precedente
  - si `manager_instruction.md` ou `manager_review.md` sont plus vieux que ce resultat terminal, il faut l'indiquer explicitement comme contexte stale
  - si ces docs manager sont stale et qu'un nouveau rerun semble encore necessaire, le handoff doit demander au developer de poser une question manager plutot que d'inferer un rerun depuis des Q/A historiques ou des diagnostics `2p`
  - ce que le developer doit faire **maintenant**
  - ce que le developer ne doit **pas** faire avant d'avoir consomme le resultat

Resume packet developer:
- quand Antidex ecrit un resume packet apres `stop|pause|continue_new_session|thread_start_*`, il doit d'abord reconcilier un eventuel `result.json` terminal pour eviter un snapshot stale `waiting_job`
- pour `developer_codex`, le resume packet doit lister explicitement, dans cet ordre:
  1. `latest_long_job_outcome.md`
  2. `long_job_history.md`
  3. `manager_instruction.md`
  4. `manager_review.md`

## 8. `job.json` minimal

Schema implemente (V1):
- `schema`: `antidex.long_job.v1`
- `job_id`, `run_id`, `task_id`
- `created_at`, `started_at`, `updated_at`
- `status`: `running|done|error|stopped`
- `pid`
- `command`
- `expected_minutes` (optionnel)
- `monitor_every_minutes` (optionnel; defaut serveur: `ANTIDEX_LONG_JOB_MONITOR_EVERY_MINUTES`)
- `monitor_grace_minutes` (optionnel; defaut serveur: `ANTIDEX_LONG_JOB_MONITOR_GRACE_MINUTES`)
- `restart_count`
- chemins relatifs des artefacts (`stdout_log`, `stderr_log`, `request_path`, `heartbeat_path`, `progress_path`, `result_path`)

## 9. Etats standard

Etat de run Antidex:
- `implementing`
- `waiting_job`
- `reviewing`
- `blocked`
- `stopped`
- `failed`
- `completed`

Etat de job:
- `queued`
- `running`
- `monitor_due`
- `monitoring`
- `paused_for_review`
- `completed`
- `failed`
- `stalled`
- `canceled`
- `restart_pending`

Etat du monitor:
- `idle`
- `due`
- `running`
- `late`
- `failed`

## 10. API cible

API implemente (serveur Antidex_V2):
- `GET /api/jobs/state?runId=...` -> job actif si present, sinon dernier job connu (`lastJobId`) + `job.json` + dernier rapport monitor (json + md), plus un resume du pipeline (`status`, `developerStatus`, `activeTurnRole`) pour afficher proprement les cas `pipeline stopped / job still running`
- `GET /api/jobs/tail?runId=...&stream=stdout|stderr&bytes=...` -> tail logs
- `POST /api/jobs/monitorNow` {runId, reason?} -> force un tour monitor LLM + applique sa decision
- `POST /api/jobs/restart` {runId, reason?} -> kill + relance la commande courante (rotation logs)
- `POST /api/jobs/stop` {runId, reason?} -> kill le job. Si le pipeline est actif, reveille le developer; si le pipeline est deja `stopped|paused|canceled`, il reste dans cet etat

## 11. Sequence nominale

Sequence attendue:
1. Le Manager demande explicitement le mode long job.
2. Le dev code le calcul si necessaire.
3. Le dev ecrit une requete sous `data/jobs/requests/` (helper: `tools\\antidex.cmd job start ...`).
4. Antidex cree `data/jobs/<job_id>/job.json` et lance le process.
5. Antidex passe le run en `waiting_job`.
6. Le dev termine son tour sans attendre le calcul.
7. Le process tourne en fond.
8. Le monitor Codex ecrit un rapport toutes les heures.
9. Si le job finit correctement, Antidex reveille le dev.
10. Le dev lit les artefacts et decide:
   - `ready_for_review`
   - nouveau long job
   - escalation Manager

Priorite de lecture apres `wake_developer`:
1. resume packet developer
2. `data/tasks/<task>/latest_long_job_outcome.md`
3. `data/tasks/<task>/long_job_history.md`
4. `data/tasks/<task>/manager_instruction.md`
5. `data/tasks/<task>/manager_review.md`

Rationale:
- `manager_instruction.md` et `manager_review.md` peuvent etre stale entre la fin d'un job et la prochaine vraie review manager
- `latest_long_job_outcome.md` sert a eviter qu'un resume frais soit contredit par des documents plus anciens mais plus directifs

Semantique pipeline/job:
- `Stop pipeline` n'implique pas `Stop long job`
- un long job vivant doit rester rattache au run pour l'observabilite meme si le pipeline est `stopped|paused`
- l'utilisateur doit pouvoir arreter explicitement le job via l'UI/API sans relancer implicitement le pipeline
- un `Continue` ulterieur doit reprendre a partir de l'etat reel: soit surveiller un job vivant, soit re-dispatch developer si l'ancien `waiting_job` etait stale
- si `monitor_reports/latest.*` manque pour un job terminal ou mort, l'API/UI doit fournir un monitor synthetique minimal au lieu d'afficher `(no monitor report yet)`

Si le job ecrit un `result.json` terminal en echec (`error|failed|stopped|canceled`):
- Antidex ne doit pas le classer comme "crash brut"
- Antidex doit reveiller le developer avec le dernier diagnostic visible
- le developer doit inspecter `result.json` + logs puis corriger ou relancer

Robustesse supplementaire issue du debug V2:
- une requete long-job fraiche `REQ-*.json` doit primer sur tout vieux job mort; l'auto-restart d'un ancien job ne doit pas court-circuiter un nouveau lancement deja demande
- `developer_status=waiting_job` doit echouer en postcondition si la requete/job n'est pas protocol-aware (`launch_kind=script`, `script_path`, ou argv vers `scripts/`)
- un `waiting_job` sans job vivant et sans requete pending doit etre recupere vers `implementing/ongoing`
- un ancien `job.json` stale `running` ne doit jamais suffire a valider qu'un long job est encore vivant
- tout rerun doit etre justifiable a partir de `long_job_history.md`; si rien n'a change depuis la derniere tentative terminale, un rerun massif est presume non pertinent
- apres un `wake_developer`, `data/pipeline_state.json.summary` et `tests.notes` doivent etre recontextualises vers "terminal result to consume now", pas laisser un vieux message de type "waiting for ... job to complete"

## 12. Monitor LLM horaire

Le monitor est un petit tour Codex distinct du developer principal.

Cadence par defaut:
- 60 minutes

Le monitor lit:
- `job.json`
- `heartbeat.json`
- `progress.json`
- derniers logs
- artefacts intermediaires
- resultat final s'il existe

Le monitor ecrit:
- `monitor_reports/REP-*.md`
- `monitor_reports/REP-*.json`
- `monitor_reports/latest.md`
- `monitor_reports/latest.json`

Le rapport doit contenir:
- statut actuel du calcul
- progression observee
- estimation de temps restant si possible
- anomalies detectees
- decision
- rationale courte

Decisions autorisees du monitor:
- `continue`
- `stop_job`
- `restart_same_command`
- `restart_preapproved_variant`
- `wake_developer_now`
- `escalate_manager`

Limitation importante:
- le monitor ne doit pas inventer une nouvelle strategie librement
- si un changement de commande n'est pas dans une liste preapprouvee par le dev/Manager, il doit reveiller le developer ou escalader au Manager

## 13. Rapport monitor obligatoire

Regle validee:
- l'UI Antidex_V2 doit afficher le contenu du dernier rapport monitor
- l'absence de rapport monitor dans la fenetre attendue est une anomalie critique

Parametres recommandables:
- `report_every_minutes = 60`
- `monitor_grace_minutes = 10`

Si aucun rapport n'est ecrit avant `due_at + grace`:
- incident `job/monitor_missed`
- reveil du Correcteur externe (si mode Guardian actif), sinon Correcteur interne

## 14. Watchdog long job

Le watchdog long job remplace les timeouts de tour pendant `waiting_job`.

Il surveille:
- processus du job
- `heartbeat.json`
- `progress.json`
- rapports du monitor

Incidents standard:
- `job/stalled`: pas de heartbeat/progress depuis le seuil attendu
- `job/crash`: process termine sans `result.json` valide
- `job/monitor_missed`: pas de rapport LLM a l'heure
- `job/result_invalid`: resultat final invalide ou incomplet
- `job/restart_failed`: ordre de restart impossible a executer

Reaction par defaut:
- `job/stalled` -> reveil du monitor si possible, sinon incident + Correcteur
- `job/crash` -> incident + Correcteur
- `job/monitor_missed` -> Correcteur externe en priorite (si actif), sinon interne
- `job/result_invalid` -> reveil developer ou Manager selon la gravite

Guardrails additionnels:
- le premier monitor ne doit pas partir avant une fenetre d'initialisation (`ANTIDEX_LONG_JOB_INITIAL_MONITOR_DELAY_MS`, defaut 5 min)
- si le pid est vivant, sans `result.json`, et encore dans une fenetre de warmup silencieux (`ANTIDEX_LONG_JOB_SILENT_WARMUP_MS`, defaut 10 min), une decision monitor `stop|restart|wake_developer|escalate_manager` doit etre differee tant qu'il n'y a pas de preuve explicite d'echec
- les faits calcules par l'orchestrateur (`elapsed_minutes`, `pid_alive`, tailles des logs, presence heartbeat/progress/result`) sont autoritaires et doivent etre fournis au monitor pour eviter les erreurs d'interpretation de timestamps

## 15. Relation avec les correcteurs

Regles:
- pendant `waiting_job`, aucun correcteur ne doit etre declenche a cause d'un timeout `turn/*`
- seuls les incidents `job/*` ou un crash serveur doivent compter

Correcteur interne:
- peut traiter une incoherence legere d'etat
- peut relancer un monitor rate
- peut reouvrir une etape developer si la machine d'etat est saine

Correcteur externe:
- doit etre reveille si:
  - le serveur crash
  - le monitor horaire n'ecrit plus ses rapports
  - un incident `job/monitor_missed` ou `job/crash` persiste
  - le run reste `waiting_job` mais l'etat job est incoherent

## 16. Reprise apres crash serveur

Au redemarrage Antidex doit:
- rescanner `data/jobs/*/job.json`
- retrouver les jobs `running|monitor_due|monitoring`
- verifier si le process existe encore
- recalculer `next_monitor_due_at`
- remettre le run associe en `waiting_job` si le job tourne encore

Si le process n'existe plus:
- ne pas reprendre silencieusement
- creer un incident `job/crash` ou `job/stalled`

## 17. UI Antidex_V2

L'UI doit afficher un panneau "Long Job" par run:
- job_id
- task_id
- commande
- statut
- heure de depart
- duree ecoulee
- ETA estimee
- dernier heartbeat
- dernier progress
- dernier rapport monitor
- decision monitor courante

Actions manuelles:
- `Force monitor now`
- `Stop job`
- `Restart job`
- `Open stdout`
- `Open stderr`
- `Open result`
- `Escalate to manager`

Pendant `waiting_job`, l'UI doit afficher clairement:
- "aucun agent n'est actif"
- "calcul en background"
- "prochain rapport monitor a ..."
- si un historique de tache existe, le panneau doit pouvoir renvoyer vers `data/tasks/<task_id>/long_job_history.md`

## 18. Prompting / instructions agents

Feature implementee: les instructions agents doivent couvrir le protocole Long Job.

Manager:
- reconnaitre les taches > 10-15 min
- exiger le mode long job
- decrire commande, artefacts, cadence monitor, criteres d'arret
- lire `data/tasks/<task_id>/long_job_history.md` avant de demander un rerun
- expliciter ce qui change par rapport a la derniere tentative terminale
- eviter de demander un nouveau 200-game rerun si aucune hypothese/correction nouvelle n'est identifiee

Developer Codex:
- ecrire le code metier du calcul
- ecrire une requete de job (`tools\\antidex.cmd job start ...` ou JSON sous `data/jobs/requests/`)
- ne pas attendre dans un long tour
- declarer les artefacts attendus
- lire `data/tasks/<task_id>/long_job_history.md` avant tout rerun
- dans `dev_result.md`, expliquer ce qui change par rapport a la derniere tentative terminale

Monitor Codex:
- lire l'etat du job
- ecrire un rapport horaire
- stopper/restart dans les limites autorisees

## 19. Regles pour les boucles de type strength gate

Cas cible: benchmark/tuning repetitif tant que les seuils ne sont pas atteints.

La boucle doit etre explicite et bornee:
- liste de candidats a tester
- budgets autorises
- nombre maximal de relances automatiques
- condition d'arret "succes"
- condition d'arret "echec avec plan correctif"

Le monitor peut:
- continuer un calcul en cours
- stopper un calcul manifestement non conforme
- relancer une variante preapprouvee

Le monitor ne doit pas:
- boucler indefiniment
- consommer des tours a vide

Si aucun candidat ne passe apres les essais autorises:
- reveiller le developer pour `dev_result.md`
- puis review Manager

## 20. Acceptance criteria

La feature sera consideree correcte si:
- un dev peut lancer un calcul de plusieurs heures sans garder un tour LLM ouvert
- le run passe en `waiting_job`
- l'UI montre le job et les rapports horaires
- le monitor horaire ecrit bien ses rapports
- le monitor peut stopper/restart dans son perimetre
- un job termine reveille correctement le dev
- un job crashe declenche un incident `job/*`
- un rapport horaire manquant declenche le Correcteur externe
- aucun timeout `turn/*` ne perturbe un run sain en `waiting_job`

## 21. Hors scope V1

- support `developer_antigravity`
- orchestration GPU distante
- scheduling multi-machines
- priorisation globale entre plusieurs jobs simultanes
- tuning libre du monitor sans garde-fous

## 22. References

- `doc/SPEC.md`
- `doc/ERROR_HANDLING.md`
- `doc/TESTING_PLAN.md`
- `doc/DECISIONS.md`
