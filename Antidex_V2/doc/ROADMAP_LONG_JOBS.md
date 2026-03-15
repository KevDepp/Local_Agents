# Roadmap - Long Jobs (Antidex_V2)

Objectif: implementer le mode "long job" (calcul long en background + monitor LLM horaire + watchdog) et le valider sur le run:
- runId: `1c11dc2f-a9d3-4cac-a26d-eab866f267fd`
- tache cible: `T-006b_strength_gate`

Contrainte cle:
- le Manager doit utiliser ce mode sans qu'on le lui demande explicitement, en detectant automatiquement que la tache implique un calcul long.

Reference spec:
- `doc/LONG_JOBS_SPEC.md`
- `doc/SPEC.md` section "Long jobs"
- `doc/ERROR_HANDLING.md` section CODEX-3
- `doc/TESTING_PLAN.md` section "Long job background"

Status: **implemented** (2026-03-07).
Notes (implementation V1 vs initial roadmap):
- demarrage job via requete fichier `data/jobs/requests/*.json` (helper projet `tools/antidex.cmd job start ...`), pas via `POST /api/jobs/start`.
- API exposee pour UI/ops: `/api/jobs/state`, `/api/jobs/tail`, `/api/jobs/monitorNow`, `/api/jobs/restart`, `/api/jobs/stop`.
- le monitor ecrit aussi `monitor_reports/latest.{md,json}` en plus des `REP-*`.

## Phase 0 - Pre-requis et definitions

1. Nommer les concepts:
- run status: `waiting_job`
- job status: `queued|running|monitor_due|monitoring|completed|failed|stalled|canceled|restart_pending`
- incidents: `job/stalled|job/crash|job/monitor_missed|job/result_invalid|job/restart_failed`

2. Definir les seuils par defaut:
- "long compute threshold": 10-15 minutes
- report monitor: 60 minutes
- grace monitor: 10 minutes
- heartbeat/progress stall: configurable (par job) avec une valeur par defaut
- limite de relances automatiques: configurable (par job) avec une valeur par defaut

3. Clarifier l'enveloppe vs code metier:
- l'enveloppe Antidex lance/surveille un process
- le code metier (simulation, training, optimisation) est ecrit par `developer_codex` dans le projet cible

## Phase 1 - Backend: modele de donnees et persistance

1. Ajouter un store job persistant:
- ecrire `data/jobs/<job_id>/job.json`
- `stdout.log`, `stderr.log`, `events.jsonl`
- `heartbeat.json`, `progress.json`, `result.json`
- `monitor_reports/REP-*.md` et `monitor_reports/REP-*.json`

2. Boot / resume:
- au demarrage serveur, rescanner `data/jobs/*/job.json`
- retrouver jobs `running|monitor_due|monitoring`
- verifier si le process (pid) existe encore
- rattacher le job au run associe et recalculer `next_monitor_due_at`
- si pid absent et pas de `result.json` valide: incident `job/crash`

3. Modifier la machine d'etat run:
- ajouter `waiting_job` (run.status)
- pendant `waiting_job`, interdire tout timeout `turn/*` pour ce run
- pendant `waiting_job`, le prochain "tick" pipeline doit deleguer au watchdog job, pas a un dispatch developer

## Phase 2 - Backend: API jobs + commande "job start"

1. Endpoints:
- ecriture d'une requete `data/jobs/requests/REQ-*.json` (helper projet `tools/antidex.cmd job start ...`) -> supervisor cree job + lance le process
- `GET /api/jobs/:jobId` (etat + pointers)
- `GET /api/runs/:runId/jobs` (liste)
- `POST /api/jobs/:jobId/stop` (stop gracieux puis kill si besoin)
- `POST /api/jobs/:jobId/restart` (relance avec commande originale ou variante preapprouvee)
- `POST /api/jobs/:jobId/monitor` (force monitor maintenant)
- `GET /api/jobs/:jobId/logs?stream=...` (optionnel; sinon viewer fichier simple)

2. Execution de process:
- lancer une commande en background (process detache)
- rediriger stdout/stderr vers fichiers du job
- ecrire `job.json` avec pid et timestamps
- re-synchroniser `run.status = waiting_job`

3. Helper "job start" (projet cible):
- fournir un helper local `tools/antidex.cmd job start ...` qui ecrit `data/jobs/requests/REQ-*.json`
- ou, a defaut, ajouter un endpoint et l'utiliser depuis l'UI (bouton "Start long job")

Note: dans V1, le chemin le plus simple est de ne pas creer une CLI globale, mais d'utiliser une API + UI, puis d'ajouter la CLI plus tard.

## Phase 3 - Monitor LLM horaire (Codex)

1. Scheduler:
- pendant `waiting_job`, programmer un monitor "due" toutes les `report_every_minutes`
- si `due_at + grace` depasse sans nouveau `REP-*`: incident `job/monitor_missed`

2. Prompt monitor:
- lire `job.json`, `heartbeat.json`, `progress.json`, dernier stdout tail, `result.json` si present
- ecrire un rapport `REP-*.md` et `REP-*.json` avec:
  - statut, progression, anomalies, decision, rationale

3. Pouvoir du monitor:
- `continue` (rien a faire)
- `stop_job` (si derive/crash detecte)
- `restart_same_command`
- `restart_preapproved_variant` (uniquement si liste preapprouvee dans `job.json`)
- `wake_developer_now` (si interpretation humaine/code necessaire)
- `escalate_manager` (si decision strategique)

4. Limites:
- imposer `max_auto_restarts` par job
- eviter des boucles "monitor -> restart -> monitor" infinies sans escalade

## Phase 4 - Watchdog long jobs (sans faux incidents)

1. Signaux:
- mtime `heartbeat.json` / `progress.json`
- existence + validite `result.json`
- presence de `monitor_reports/REP-*` dans la fenetre attendue

2. Reactions:
- `job/stalled`: reveiller monitor si possible; sinon incident + corrector
- `job/crash`: incident + corrector
- `job/monitor_missed`: incident et reveil **correcteur externe** en priorite
- `job/result_invalid`: reveil dev ou manager selon gravite

3. Integration correcteurs:
- pendant `waiting_job`, ne jamais declencher correcteur sur `turn/*`
- declencher correcteur sur `job/*` uniquement

## Phase 5 - Prompts agents (auto-detection par le Manager)

1. Template `agents/manager.md` (Antidex_V2 templates):
- Ajouter une regle: si une tache implique un calcul > 10-15 min, imposer "mode long job".
- Heuristiques minimales:
  - keywords: benchmark, tournament, self-play, strength gate, train, optimize, grid search, monte carlo
  - presence d'un parametre de taille: `games`, `episodes`, `samples`, `budget_ms` eleve, etc.
  - tache kind: si `task_kind` signale evaluation/bench (ex: `ai_strength_gate`)
- Regle spec: `tools/antidex.cmd job start` = enveloppe uniquement; dev doit coder le calcul.

2. Template `agents/developer_codex.md`:
- Ajouter un protocole "long job":
  - ecrire le code metier
  - lancer job via API/CLI
  - ecrire les artefacts attendus
  - ne pas attendre dans un tour

3. Nouveau template `agents/monitor_codex.md` (ou section dediee):
- protocole rapport horaire
- decisions autorisees
- contraintes de relance

4. Bootstrap:
- mettre a jour Antidex pour copier ces templates dans les projets cibles au demarrage.

## Phase 6 - UI Antidex_V2

1. Panneau "Long Job" dans la page run:
- etat du job, commande, duree, ETA, dernier heartbeat/progress
- dernier rapport monitor (texte)
- prochain check-in

2. Actions:
- Force monitor now
- Stop job
- Restart job
- Ouvrir stdout/stderr/result

3. UX:
- pendant `waiting_job`, afficher "aucun agent actif, calcul en background"
- pas de "flicker": privilegier SSE, backstop polling lent

## Phase 7 - Test sur run `1c11dc2f...` (T-006b)

1. Preparation:
- s'assurer que la tache `T-006b_strength_gate` est toujours current
- s'assurer que le projet cible contient les scripts/commandes d'arene (ai-lab) utilisables comme job

2. Manager auto:
- sur detection que `T-006b` est un long calcul, le Manager doit demander au dev:
  - de lancer un long job pour les benchmarks (maxn vs mcts, budget 250ms, sizes 2p/4p/6p)
  - de configurer:
    - report monitor 60 min
    - heartbeat/progress
    - expected artifacts `strength_gate.json/md`

3. Nominal:
- dev lance job, run passe `waiting_job`
- monitor ecrit un rapport a H+1 (visible UI)
- job termine, reveil dev, update `dev_result.md`, passe `ready_for_review`
- Manager review et decide rework/accept selon gate

4. Non nominal:
- simuler job crash -> incident `job/crash`
- simuler monitor missing -> incident `job/monitor_missed` + correcteur externe

## Phase 8 - Acceptance / Done

La feature est consideree validee si:
- un benchmark de plusieurs heures tourne sans tour LLM ouvert
- le run est stable en `waiting_job` sans timeouts `turn/*`
- l'UI montre les rapports du monitor toutes les heures
- le monitor peut stopper/restart dans les limites
- les incidents `job/*` declenchent les correcteurs appropries
- le run `1c11dc2f...` ne boucle plus a vide sur `T-006b` et converge vers:
  - un PASS gate, ou
  - un rapport final + plan correctif borne, puis blocage/review explicite (pas une boucle infinie)
