# SPEC â€” Antidex (Manager + Dev Codex + Dev Antigravity)

## 0) Contexte et objectif

Ce sous-projet (dans `Local_Agents/Antidex_V2/`) vise a **combiner**:
- `Local_Agents/Local_Codex_dual_pipeline/` (orchestration de 2 threads Codex: manager + developer),
- `Local_Agents/Antigravity_POC/` (envoi de prompts a Antigravity via `antigravity-connector` + protocole de sortie par fichiers),
et a s'appuyer sur les briques de `Local_Agents/Local_Codex_appserver/` (client `codex app-server` + UI/browser POC) comme reference.

Le produit final attendu est une **interface web locale** dans laquelle l'utilisateur saisit un prompt (cahier des charges) pour un **agent Manager**. Le Manager:
- fait le plan de travail,
- decoupe en taches (la "taille" cible sera fournie plus tard),
- choisit le bon "developpeur" pour chaque tache: soit **un agent Codex** (developer Codex), soit **Antigravity** (developer AG),
- assigne les taches **une par une** (pipeline sequentiel) et ne passe a la suivante qu'apres verification,
- verifie que c'est bien fait; sinon renvoie un message clair de rework,
- documente ce qui est fait au fur et a mesure,
- met en evidence les deviations/choix pris differents du plan initial,
- gere les tests (et exige des preuves).

### Source de verite
Si ce document diverge d'anciens documents pre-POC (ex: le `.docx` fourni), **les consignes ecrites dans ta demande** priment.

## 1) Roles

### 1.1 Utilisateur
- Fournit le prompt initial (cahier des charges).
- Peut arreter/reprendre un run.
- Observe les sorties et l'etat.

### 1.2 Manager (Codex)
Role central pour garantir que le developpement ne s'arrete pas avant d'etre termine.
- Planification: produit/maintient SPEC/TODO/TESTING_PLAN/DECISIONS + INDEX dans le projet cible.
- Dispatch: choisit le developpeur (Codex vs Antigravity) par tache.
- Verification: relit, lance/valide les tests, demande des corrections si besoin.
- TraÃ§abilite: documente les choix et deviations.

### 1.3 Developer Codex
Agent Codex dedie a l'implementation de taches de code.
- Lit les instructions et les fichiers de planification.
- Implemente, ajoute des tests, met a jour la doc.
- Produit une sortie "ready for review" via fichier(s) convenus.

### 1.4 Developer Antigravity (AG)
Agent Antigravity dedie aux taches pertinentes pour AG:
- actions via browser (config GitLab/Supabase, creation de cles API, inscriptions, e-mails, etc.),
- tests UI finaux si l'application cible a une UI web,
- taches non triviales de debug/recherche qui beneficient du browser.

AG communique principalement par **fichiers** (protocole `result.json`), et peut modifier le projet cible si l'environnement Antigravity a acces au filesystem du projet.

## 2) Principes clefs (non-negociables)

1) **Pipeline sequentiel**: une tache a la fois, avec verification avant de continuer.
2) **Communication par fichiers**: tout echange important (instructions, taches, resultats, decisions) doit etre ecrit dans des fichiers stables.
3) **Instructions par agent**: chaque agent a un fichier d'instructions; le Manager peut les modifier; a chaque interaction le Manager rappelle:
   - "lis les instructions dans <path>",
   - "ecris ton resultat dans <path> (ou mets a jour <path>)".
4) **Docs comme produit**: le projet doit etre comprehensible via la documentation, a tout moment.
5) **Tests geres par le Manager**: definition, execution/verification, preuve (logs, commandes, resultats).
6) **Deviations explicites**: tout ecart vs plan initial doit etre surligne et explique.
7) **Pilotage utilisateur en cours de run**:
   - L'utilisateur peut consulter a tout moment l'etat du projet via `doc/TODO.md` (doit rester lisible et explicite).
   - L'utilisateur peut modifier `doc/TODO.md` pendant l'execution (ajouter/modifier une demande).
   - Le Manager doit relire `doc/TODO.md` regulierement (au minimum avant chaque dispatch et apres chaque tache) et integrer ces changements (mise a jour plan/taches/docs + decisions si necessaire).
8) **Requalification par les preuves**: si les preuves montrent qu'un compromis global est mauvais, il est legitime de requalifier le probleme et de changer la representation de la solution.

## 3) Architecture cible (high-level)

### 3.1 Composants (reutilisation des POCs)

- Backend Node (base: `Local_Codex_dual_pipeline/server/`)
  - 1 process `codex app-server` pilote via `CodexAppServerClient` (de `Local_Codex_appserver/server/codexAppServerClient.js`)
  - 2 threads Codex: `managerThreadId` et `codexDeveloperThreadId`
  - 1 client HTTP vers `antigravity-connector` (base: `Antigravity_POC/src/connectorClient.js`)
  - Un orchestrateur de pipeline "3 roles" (Manager + 2 developpeurs)
  - SSE streaming des sorties par role
  - Store d'etat du run (dans le projet orchestrateur) + marqueurs dans le projet cible

- UI web locale (base: `Local_Codex_dual_pipeline/web/`)
  - prompt utilisateur
  - selection du `cwd` cible via un explorateur serveur (`fsApi`)
  - config Manager model / Dev Codex model
  - config Antigravity connector (URL, options)
- monitoring (etat run + logs par role)
  - UX: action "Load selected" charge TODO/taches et **amene le TODO a l'ecran** (scroll + focus) pour eviter la confusion (le select run est plus bas que le panneau TODO)
  - UX: limiter le polling (backstop) quand SSE est actif pour eviter l'effet "rafraichissement/flicker" dans le navigateur
  - UX: indicateur de progression TODO compatible avec formats courants (`- [ ]`, `1. [ ]`, `[ ]`) et liste des taches affichee dans l'ordre du `doc/TODO.md` quand possible
- UX long jobs: le panneau "Long job (background compute)" doit continuer a afficher le **dernier job connu** (dernier rapport monitor + meta) meme apres la fin/crash du job; l'absence d'`activeJob` ne doit pas vider le diagnostic le plus recent
- UX long jobs: le resume de reveil developer doit employer une formulation fidele a l'etat observe (`completed`, `crashed`, `stopped`, ou neutre `ended`), jamais annoncer `finished` si le dernier monitor a conclu a un crash
- UX long jobs: `Stop pipeline` et `Stop long job` sont deux actions distinctes. Un run `stopped|paused` peut garder un long job vivant, visible et controlable dans l'UI tant que le process existe encore.
- UX long jobs: l'API/UI doivent exposer un lien stable vers `data/tasks/<task_id>/long_job_history.md` quand cet historique existe, afin que le panneau long-job renvoie vers la memoire canonique des tentatives precedentes et de leurs conclusions.
- UX long jobs: apres un `wake_developer`, Antidex doit generer un handoff canonique `data/tasks/<task_id>/latest_long_job_outcome.md|json` et le faire lire au developer **avant** `manager_instruction.md` / `manager_review.md`, pour eviter qu'un resume frais soit ecrase par des consignes stale.
- Ce handoff doit resumer les resultats clefs du `result.json` reel (`wins_by_seat`, `illegal_moves`, `generated_at`, etc.) meme quand ils sont ecrits au niveau racine (`output` + `summary`) plutot que sous `outputs[]`.
- Si `manager_instruction.md` / `manager_review.md` sont plus vieux que le resultat terminal courant, le handoff doit le dire explicitement pour que le developer traite ces docs comme contexte stale et consomme d'abord le resultat.
- Dans ce cas, le developer ne doit pas inventer un nouveau rerun depuis des Q/A historiques ou des diagnostics `2p`; si une nouvelle experience semble encore necessaire apres consommation du resultat, il doit poser une question manager.
- Les resume packets `stop|pause|continue_new_session` doivent etre ecrits apres reconciliation terminale, afin de ne pas republier un faux contexte `waiting_job` alors qu'un long job est deja terminal.

### 3.2 Distinction importante
Il y a:
- **le projet orchestrateur** (ce repo `Antidex/`) qui contient le backend + UI,
- **le projet cible** (un `cwd` choisi) sur lequel les agents travaillent (code+docs).

## 4) Protocole fichiers (projet cible)

### 4.1 Dossiers/artefacts minimum dans le projet cible
Dans le `cwd` cible, le systeme doit garantir (creer si absent):
- `doc/` avec:
  - `doc/DOCS_RULES.md` (pointeur vers `Local_Agents/doc/DOCS_RULES.md`)
  - `doc/INDEX.md`
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`
  - `doc/DECISIONS.md`
- `agents/` (instructions par agent):
  - `agents/manager.md`
  - `agents/developer_codex.md`
  - `agents/developer_antigravity.md`
- `data/` (coordination + preuves):
  - `data/pipeline_state.json` (marqueur runtime/handshake â€” source de verite pour la reprise)
  - `data/tasks/` (1 dossier par tache; voir 4.3)
  - `data/mailbox/` (notifications "to/from" par agent; voir 4.3)
  - `data/antigravity_runs/` (runs AG via protocole fichiers; voir 4.4)

Note: les noms exacts des fichiers d'instructions sont a figer (voir "Questions ouvertes").
Note (important): `doc/TODO.md` est le fichier "etat des taches" consultable/modifiable par l'utilisateur pendant le run. Le Manager doit le maintenir a jour et en tenir compte.

### 4.2 `data/pipeline_state.json` (cible) â€” schema minimal propose
Objectif: reprise d'un run, coordination, et marqueur "Agent On going"/"done".

Champs minimum (proposition):
```json
{
  "run_id": "uuid",
  "iteration": 1,
  "phase": "planning|dispatching|implementing|reviewing|completed|blocked",
  "current_task_id": "T-001_setup",
  "assigned_developer": "developer_codex|developer_antigravity",
  "thread_policy": {
    "manager": "reuse",
    "developer_codex": "reuse|new_per_task",
    "developer_antigravity": "reuse|new_per_task"
  },
  "developer_status": "idle|ongoing|ready_for_review|blocked",
  "manager_decision": "continue|completed|blocked|null",
  "summary": "short",
  "tests": { "ran": true, "passed": false, "notes": "..." },
  "updated_at": "2026-02-15T00:00:00.000Z"
}
```

Regles:
- JSON valide, indente, termine par newline.
- Ce fichier n'est pas un log; c'est un **marqueur** de coordination (mais il doit etre reference dans `doc/INDEX.md` du projet cible).
- Politique "new thread vs resume thread":
  - `thread_policy.manager` est **toujours** `"reuse"`: le Manager garde le meme thread pour tout le projet/run.
  - Pour `developer_codex` et `developer_antigravity`, le Manager peut choisir `"reuse"` ou `"new_per_task"`.
  - Valeur par defaut: `"reuse"` (on ne renouvelle les threads que pour des projets "gros" ou si la qualite se degrade).
  - Pour Antigravity, `"reuse"` correspond a `newConversation=false` et `"new_per_task"` a `newConversation=true` (attention: voir limites en section 7).

### 4.3 Taches + mailboxes (proposition)
Pour rendre la coordination robuste, chaque tache est un **dossier stable**:
- `data/tasks/T-001_<slug>/task.md` (demande + Definition of Done + developpeur assigne + thread_mode + budget de scope)
- `data/tasks/T-001_<slug>/manager_instruction.md` (instruction canonique envoyee au developpeur)
- `data/tasks/T-001_<slug>/dev_ack.json` (B: ACK â€” "j'ai recu et je commence")
- `data/tasks/T-001_<slug>/dev_result.md` ou `data/tasks/T-001_<slug>/dev_result.json` (C: RESULT â€” livraison + preuves; ecriture atomique recommandee)
- `data/tasks/T-001_<slug>/manager_review.md` (feedback + accept/rework + deviations)
  - Important: chaque tour "Manager review" doit **modifier** ce fichier (pas de re-use silencieux d'un vieux REWORK/ACCEPTED).
- `data/tasks/T-001_<slug>/latest_long_job_outcome.md` et `latest_long_job_outcome.json` (handoff systeme canonique apres un long job terminal; optionnels hors taches avec long job)

Note UX: la liste des taches affichee dans l'UI est derivee des dossiers sous `data/tasks/`, mais Antidex peut masquer
des dossiers "placeholder" systeme (ex: `T-xxx_slug`) qui ne representent pas de vraies taches.

Regle de decoupage (taille des taches):
- Le Manager doit viser des taches ou il estime que le developpeur ecrira **< 700 lignes** (ordre de grandeur) sur la tache.
- Ce critere ne doit pas casser la coherence: le decoupage doit rester logique (pas de micro-taches artificielles).

Definitions (important):
- **B (ACK)**: un marqueur rapide qui confirme la prise en charge (ne prouve pas que c'est fini).
- **C (RESULT)**: la livraison finale de la tache, avec preuves (fichiers modifies, commandes/tests, logs, etc.).

Regle supplementaire pour les taches avec long job:
- `latest_long_job_outcome.*` n'est **pas** un document manager; c'est un artefact systeme genere par Antidex.
- Son but est de dire au developer, immediatement apres `wake_developer`, quel est le **dernier fait terminal** a consommer.
- Si le developer consomme ce handoff puis demande une clarification (question `Q-*.md` + `developer_status=blocked`), Antidex doit router ce `blocked` vers un tour Manager `answering`; ce n'est pas un incident Corrector.
- Ce fichier prime sur un `manager_instruction.md` ou `manager_review.md` stale pour la phase "consommer le resultat du job qui vient de finir".
- Le manager conserve la responsabilite strategique; l'orchestrateur ne reecrit pas ses reviews/instructions a sa place.

### 4.3.0 bis Compaction de contexte pilotee par les agents (prochaine implementation)
Objectif: eviter qu'une tache longue accumule trop de tentatives, reviews, Q/A et artefacts stale qui restent
lisibles comme si tout etait encore directif.

Principe directeur:
- Antidex ne doit pas "penser a la place" des agents via une auto-compaction opaque.
- La compaction est un **acte explicite de pilotage**, decide principalement par le Manager.
- L'orchestrateur peut fournir des emplacements, des formats et plus tard des helpers simples, mais pas une logique
  autonome qui decide seule ce qui doit etre oublie ou ignore.

Quand le Manager doit envisager une compaction:
- plusieurs tentatives/reworks ont eu lieu sur la meme tache et les documents racine racontent des etats differents,
- une meme tache a accumule plusieurs reruns/benchmarks et il devient difficile de savoir quelle tentative est la
  derniere vraiment pertinente,
- des Q/A, reviews ou `dev_result.*` anciens restent techniquement vrais comme historique mais ne doivent plus guider
  l'action immediate,
- le Developer ou le Manager perd du temps a relire/rafraichir des artefacts stale au lieu d'avancer sur la prochaine
  hypothese utile.

Artefacts prevus:
- `data/tasks/<task_id>/context_checkpoint.md`
- `data/tasks/<task_id>/archive/`

Role de `context_checkpoint.md`:
- C'est le **resume canonique de travail** de la tache apres compaction.
- Il ne remplace pas `task.md` ni `manager_instruction.md`; il les complete quand l'historique est devenu trop bruyant.
- Il doit etre redige par un agent (en pratique le Manager, ou un Developer si le Manager le lui demande explicitement),
  jamais "devine" silencieusement par l'orchestrateur.

Structure minimale recommandee de `context_checkpoint.md`:
- `Checkpointed at:`
- `Why this checkpoint exists:`
- `Current objective:`
- `Still directive:`
- `No longer directive:`
- `Key attempts so far:`
- `What was learned:`
- `Next expected action:`
- `Open question for next review:` (optionnel)

Role de `archive/`:
- Conserver les documents/tentatives supersedes **sans les supprimer**.
- Les fichiers archives restent consultables pour forensics/historique, mais ne doivent plus etre lus comme
  instructions directes par defaut.
- L'archive peut contenir d'anciens `manager_review.md`, `dev_result.*`, Q/A, notes de rerun, ou sous-dossiers
  d'artefacts devenus secondaires pour la conduite immediate de la tache.

Separation entre "directif" et "consultable":
- Restent **directifs** a la racine de `data/tasks/<task>/`:
  - `task.md`
  - `manager_instruction.md`
  - `manager_review.md` (dernier review valide)
  - `latest_long_job_outcome.*` si present
  - `context_checkpoint.md` si present
  - le `dev_result.*` courant
- Deviennent **consultables** (mais non directifs) une fois archives:
  - anciennes reviews,
  - anciens `dev_result.*`,
  - Q/A closes et supersedees,
  - notes de reruns/hypotheses qui ne doivent plus guider l'action immediate.

Regles de lecture:
- Si `context_checkpoint.md` existe, Manager et Developer doivent le lire avant de s'appuyer sur des documents plus
  anciens ou sur l'archive.
- Si un document archive contredit `manager_instruction.md` ou `context_checkpoint.md`, le document archive ne doit
  pas l'emporter.
- L'archive reste utile pour comprendre le cheminement, pas pour redefinir implicitement la suite.

Regles de tracabilite:
- Toute compaction/archivage important doit etre mentionne dans `doc/DECISIONS.md`.
- Si la compaction change la facon de lire la tache, `doc/INDEX.md` doit rester coherent.
- La compaction ne doit pas effacer l'historique; elle doit le **reclassifier**.

Outillage futur (optionnel):
- Des scripts/helpers peuvent exister plus tard pour aider a produire `context_checkpoint.md` ou deplacer des fichiers
  vers `archive/`.
- Ces helpers doivent etre **explicitement appeles** par un agent.
- Ils ne doivent pas devenir une source de decision parallele.

Mailboxes (notifications, optionnelles mais recommandees pour simplifier l'orchestrateur):
- `data/mailbox/to_developer_codex/` et `data/mailbox/from_developer_codex/`
- `data/mailbox/to_developer_antigravity/` et `data/mailbox/from_developer_antigravity/`
Chaque notification est un petit JSON "pointer" vers la tache, par ex:
- `data/mailbox/to_developer_codex/T-001.pointer.json` -> `{ "task_id":"T-001", "task_dir":"data/tasks/T-001_<slug>/", "must_read":[...], "updated_at":"<ISO>" }`

Regle d'or: la **source de verite** du contenu est toujours `data/tasks/...` (la mailbox ne contient que des pointeurs).

### 4.3.1 Override utilisateur: "Send to manager" (user_commands)
Objectif: permettre a l'utilisateur d'injecter une instruction prioritaire (ex: "change request") pendant ou apres un run,
pour que le Manager la **reconcilie** avec `doc/TODO.md` avant toute suite du pipeline.

Protocole (projet cible):
- Le backend cree un fichier `data/user_commands/CMD-<timestamp>.md` (message utilisateur + exigences).
- Le Manager doit repondre en ecrivant `data/user_commands/CMD-<timestamp>_response.md`.
- Pendant un override, l'orchestrateur bloque la progression (equivalent `developer_status=blocked`) et execute un tour Manager
  `step=user_command` avant tout autre dispatch/review.
- UI: le bouton "Send to manager" envoie ce message prioritaire et relance l'auto-run.

Note robustesse:
- L'override peut etre envoye meme si un run est deja "en cours": il est queue et traite au prochain point de controle
  (avant tout dispatch/review suivant).
- Mode queue V2:
  - Antidex maintient au plus 1 `pendingUserCommand` (message actuellement en cours de traitement par le Manager)
    et 1 `queuedUserCommand` (message a traiter juste apres).
  - Si un 2e message arrive alors qu'un `pendingUserCommand` existe deja, Antidex cree `queuedUserCommand`
    au lieu de l'ignorer.
  - Si d'autres messages arrivent tant que `queuedUserCommand` existe deja, Antidex les **fusionne** dans ce meme
    `queuedUserCommand` (un seul bundle a traiter), au lieu de creer plusieurs tours Manager consecutifs.
  - Le fichier `data/user_commands/CMD-<timestamp>.md` d'un message queue peut donc representer soit un message simple,
    soit un bundle contenant plusieurs messages utilisateur livres ensemble au Manager.
  - Regle de livraison: apres traitement reussi du `pendingUserCommand`, l'orchestrateur doit promouvoir
    `queuedUserCommand -> pendingUserCommand` et executer ce tour Manager **avant tout dispatch developer**.
  - Objectif UX: si l'utilisateur envoie plusieurs messages rapproches pendant un override, aucun message ne doit etre
    perdu; le Manager doit recevoir d'abord le message deja en cours, puis le bundle des follow-ups.
- TODO editable + `Save + Continue`:
  - Un edit explicite de `doc/TODO.md` via l'UI doit **toujours** rester supporte.
  - Pour eviter les reconciliations dupliquees, Antidex garde un accuse explicite du dernier TODO deja reconcilie
    (`lastReconciledTodoFingerprint`, base sur le contenu du TODO).
  - Sur `Save + Continue` ou reprise apres edit disque, Antidex ne cree un `user_command` `todo_updated`
    que si le fingerprint courant differe du dernier fingerprint reconcilie.
  - Donc:
    - `Save + Continue` apres une vraie modification de TODO relance bien un reconcile Manager,
    - `Save + Continue` sans changement reel de contenu n'injecte pas un 2e reconcile identique,
    - aucune vraie modification du TODO ne doit etre ignoree silencieusement.
- Postcondition (robustesse UX): apres `step=user_command`, le Manager doit soit:
  - creer au moins 1 tache actionable via `doc/TODO.md` (au moins 1 item **non coche** avec un owner entre parentheses), soit
  - confirmer explicitement la fin en mettant `manager_decision=completed` dans `data/pipeline_state.json`.
  Sinon, l'orchestrateur considere que l'override n'a pas ete integre et retry/bloque.
- Rebase TODO: si l'orchestrateur rebascule vers la 1ere tache TODO non faite et que les fichiers
  `data/tasks/<task_id>/task.md` et/ou `data/tasks/<task_id>/manager_instruction.md` manquent, il doit:
  - ignorer les lignes "exemple de format" (ex: owner avec un `|` comme `(developer_codex|developer_antigravity)` ou placeholder `T-xxx_slug`),
  - bloquer le Manager (developer_status=blocked) + ecrire une question d'action,
  - exiger la creation des fichiers manquants + mise a jour de `data/pipeline_state.json`,
  - **ne pas** declencher le Correcteur (cause attendue = action Manager, pas bug orchestrateur).
  - Recuperation: si un bug precedent a laisse `current_task_id` sur un placeholder (ex: `T-xxx_slug`) ou une tache dont le spec manque,
    alors sur `Resume/Continue` l'orchestrateur doit tenter un **auto-rebase** vers la 1ere vraie tache TODO non cochee.
- Corrector (optionnel): si le Manager echoue les postconditions apres les retries, Antidex peut declencher un incident
  `where=manager/user_command` et lancer le Correcteur (si active) pour patcher Antidex lui-meme (prompts/postconditions/UX).
- Stop utilisateur: un "Run stopped" (pause/stop explicite) **ne doit jamais** declencher le Correcteur, meme si `lastError.where=manager/user_command` ou `auto`; l'incident reste ecrit pour traceabilite.

### 4.3.2 Correcteur: interne "mince" vs externe (Guardian)
Objectif: quand Antidex se bloque (incident/guardrail), produire des artefacts exploitables et relancer proprement, sans "re-complete" silencieux.

Modes:
- Mode "in-process" (historique): Antidex declenche le Correcteur dans le meme process serveur.
- Mode "external corrector" (Antidex_V2): Antidex **n'execute pas** le Correcteur directement. Il:
  - ecrit un incident `data/incidents/INC-*.json` + bundle,
  - ecrit un marker stable: `data/external_corrector/pending.json`,
  - met le run en `status=stopped` et `developer_status=blocked`.

Daemon externe (Guardian):
- Le Guardian (`node scripts/guardian.js`, `npm run start:guardian`, ou `start-ui-guardian.cmd`) surveille `data/external_corrector/pending.json` et appelle `POST /api/corrector/run_pending`.
- Apres declenchement du Correcteur, le Guardian fait un `Continue pipeline` best-effort si le run reste `stopped|failed` (il respecte un `paused` utilisateur).
- Si le Correcteur requiert un restart, le serveur sort avec le code **42** (mode supervisor) et le Guardian respawn. L'auto-resume du serveur utilise `data/auto_resume/pending.json`.

API:
- `POST /api/corrector/run_pending` (pas de body requis): declenche le Correcteur sur le dernier incident pointe par `data/external_corrector/pending.json`.

### 4.3.2.0 Auditeur externe periodique (prochaine implementation)

Objectif: ajouter une surveillance proactive des runs pour detecter des incoherences structurelles **avant**
qu'elles ne deviennent un incident explicite visible uniquement a l'utilisateur. L'auditeur ne remplace ni
le monitor long-job ni le Correcteur; il joue le role de **sentinelle read-only**.

Separation des roles (obligatoire):
- **Auditeur externe**: lit, diagnostique, ecrit un rapport, et peut recommander un incident.
- **Correcteur**: patch Antidex **seulement apres** un incident officiel.
- **Guardian**: orchestre les boucles externes (serveur, pending corrector, futur tick auditeur).

Invariants:
- L'auditeur ne doit **jamais** modifier le projet cible (`cwd`) ni le code Antidex pendant qu'un run est actif.
- L'auditeur ne doit **jamais** appeler directement `Pause`, `Stop`, `Continue`, `Restart`, ni ecrire
  `data/external_corrector/pending.json`.
- L'auditeur n'ouvre pas lui-meme un incident "brut". Il produit un **rapport d'audit** + une
  **recommandation d'incident**; l'orchestrateur/Guardian transforme ensuite cette recommandation en incident
  officiel apres une revalidation minimale.
- Si un `pending corrector` existe deja, l'auditeur ne doit pas lancer un second flux concurrent.
- Si le run est `paused|stopped|canceled|completed`, l'auditeur n'ouvre pas de nouvel incident; il peut au plus
  ecrire un rapport passif si cela aide le diagnostic.

Perimetre initial:
- Detecter les incoherences **Antidex/orchestrateur/UI/jobs**, pas les "mauvais choix metier" du projet cible.
- Priorite aux signatures a **forte confiance** deja observees sur des runs reels.
- Toute signature non suffisamment robuste doit rester en mode "rapport seulement" (pas d'incident automatique).

Artifacts d'audit:
- Dossier par run: `data/external_auditor/<runId>/`
- Rapport JSON horodate: `AUD-<timestamp>.json`
- Rapport Markdown horodate: `AUD-<timestamp>.md`
- Pointeurs stables: `latest.json`, `latest.md`
- Si l'auditeur recommande un incident: ecrire aussi un marker stable
  `data/external_auditor/pending.json` contenant la recommendation en attente de revalidation.

Schema minimal de `AUD-*.json`:
```json
{
  "schema": "antidex.external_auditor.v1",
  "at": "<ISO>",
  "run_id": "<runId>",
  "auditor_mode": "passive|enforcing",
  "conclusion": "healthy|suspicious|incident_recommended",
  "confidence": "low|medium|high",
  "summary": "short human summary",
  "recommended_action": "none|observe|open_incident",
  "suggested_incident_where": "<guardrail/...|job/...|state/...|ui/...|review/...>",
  "suggested_incident_message": "<short message>",
  "findings": [
    {
      "code": "state/status_mismatch",
      "severity": "info|warn|error",
      "summary": "short",
      "evidence": ["<path or API field>", "<path or API field>"],
      "why_it_matters": "short",
      "confidence": "low|medium|high"
    }
  ],
  "evidence_paths": ["<abs or rel paths>"],
  "api_snapshots": {
    "pipeline_state": "<inline summary only>",
    "jobs_state": "<inline summary only>"
  }
}
```

Format minimal de `AUD-*.md`:
- statut / conclusion / confiance
- resume
- findings ordonnes par severite
- recommendation
- liens vers preuves

Cadence:
- Mode initial: toutes les **15 minutes** par run actif.
- Backoff progressif si plusieurs audits consecutifs sont `healthy`:
  - 0..2 succes consecutifs: 15 min
  - 3..5 succes consecutifs: 30 min
  - 6..11 succes consecutifs: 60 min
  - 12+ succes consecutifs: 120 min
- Tout nouvel incident, restart, changement de task, passage `waiting_job`, ou reprise utilisateur remet le backoff
  a 15 min.

Modes:
- `passive` (defaut au premier deploiement): ecrit seulement les rapports; **aucun incident** automatique.
- `enforcing`: autorise l'ouverture d'incident **uniquement** pour une whitelist de signatures a forte confiance.

Sources que l'auditeur doit lire:
- API live:
  - `/api/pipeline/state?runId=...`
  - `/api/jobs/state?runId=...`
  - `/api/pipeline/runs`
- Artefacts run:
  - `Local_Agents/Antidex_V2/data/runs/<runId>/timeline.jsonl`
  - `Local_Agents/Antidex_V2/data/runs/<runId>/summary.txt` si present
  - `Local_Agents/Antidex_V2/data/logs/run_<...>*.log` (tail borne)
- Etat projet cible:
  - `data/pipeline_state.json`
  - `data/tasks/<current_task>/task.md`
  - `data/tasks/<current_task>/manager_instruction.md`
  - `data/tasks/<current_task>/manager_review.md`
  - `data/tasks/<current_task>/dev_result.*`
- Jobs:
  - `data/jobs/<jobId>/job.json`
  - `result.json`, `heartbeat.json`, `progress.json`
  - `monitor_reports/latest.json|md`
- Historique:
  - derniers incidents `data/incidents/INC-*.json`
  - derniers audits `data/external_auditor/<runId>/latest.*`
- Docs de contexte Antidex:
  - `doc/SPEC.md`
  - `doc/ERROR_HANDLING.md`
  - `doc/CORRECTOR_RUNBOOK.md`
  - `doc/CORRECTOR_FIX_PATTERNS.md`
  - `doc/DECISIONS.md`
  - `doc/INDEX.md`

Signatures MVP autorisees en mode `enforcing` (whitelist initiale):
1) `state/status_mismatch_durable`
   - ex: `status=waiting_job|implementing|reviewing` mais aucun `activeTurn`, aucun lock, aucune evolution de timeline
     pendant une fenetre de grace suffisante.
2) `job/active_reference_incoherent`
   - ex: job marque `running`/actif alors que `result.json` terminal existe deja ou que le pid est mort.
3) `job/monitor_terminal_mismatch`
   - ex: `result.json.status=done|error|failed|stopped` mais `monitor_reports/latest.*` dit encore `running` durablement.
4) `review/stale_loop_high_confidence`
   - ex: meme task, memes artefacts, questions `Q-loop`/`Q-manager-re` repetitives, aucun `dev_result.*` plus recent,
     aucune progression reelle de task/state.
5) `ui_or_api/stale_projection`
   - ex: projection API durablement incoherente avec les artefacts source (cas d'etat connu comme `stopped + waiting_job`,
     `activeJob` fantome, etc.).

Signatures explicitement **hors MVP enforcing**:
- "le Manager pense trop longtemps"
- "le developer n'a pas encore assez avance"
- "la tache semble mauvaise"
- "la review n'est pas convaincante"
- tout jugement metier sur la qualite du projet cible sans incoherence structurelle claire

Regle d'ouverture d'incident:
- `passive`: ne jamais ouvrir d'incident.
- `enforcing`: ouvrir un incident seulement si:
  - `confidence=high`,
  - la signature appartient a la whitelist MVP,
  - la meme signature n'a pas deja ete ouverte tres recemment pour ce run sans nouvel element,
  - aucun correcteur n'est deja pending,
  - le run n'est pas dans un etat terminal ou explicitement pause par l'utilisateur.

Dedup / cooldown:
- Cle de dedup minimale: `runId + finding.code + currentTaskId + activeJobId(lastJobId si null) + summary hash`
- Cooldown par signature sur un run: 30 min minimum avant de rouvrir le meme incident, sauf si la preuve change
  (nouveau job, nouveau task id, nouveau turn, nouveau result).

Handoff vers le Correcteur:
1) l'auditeur ecrit `AUD-*` + `latest.*`
2) si `incident_recommended` et mode `enforcing`, il ecrit `data/external_auditor/pending.json`
3) le Guardian (ou une route backend dediee) relit ce marker et revalide minimalement la recommandation
4) Antidex ecrit alors un incident officiel `INC-*` + bundle
5) Antidex stoppe le run proprement
6) le flux actuel `external_corrector/pending.json -> /api/corrector/run_pending` reprend sans changement conceptuel

Contrainte de revalidation avant incident officiel:
- l'orchestrateur/Guardian ne doit pas faire confiance aveuglement au rapport LLM.
- Il doit revalider localement les predicates simples et binaires quand ils existent:
  - existence de `result.json`,
  - pid vivant ou non,
  - `activeTurn` present ou non,
  - deltas timeline/mtime,
  - presence d'un `pending corrector`,
  - statut terminal ou non.

Integration Guardian:
- Le Guardian garde la responsabilite du tick periodique et du scheduling.
- Il ne doit lancer **qu'un audit a la fois**.
- Il doit ignorer l'auditeur tant qu'un correcteur externe est pending ou en cours.
- Il doit tracer dans ses logs:
  - debut audit
  - conclusion
  - recommandation
  - eventuelle ouverture d'incident

Variables d'env proposees:
- `ANTIDEX_EXTERNAL_AUDITOR=1|0`
- `ANTIDEX_AUDITOR_MODE=passive|enforcing`
- `ANTIDEX_AUDITOR_INTERVAL_MS` (defaut 900000)
- `ANTIDEX_AUDITOR_MIN_INTERVAL_MS`
- `ANTIDEX_AUDITOR_MAX_INTERVAL_MS`
- `ANTIDEX_AUDITOR_COOLDOWN_MS`
- `ANTIDEX_AUDITOR_MAX_LOG_BYTES`
- `ANTIDEX_AUDITOR_ENABLED_CODES` (liste blanche optionnelle)

UI / observabilite (obligatoire a terme):
- afficher le dernier rapport d'audit par run (statut, resume, conclusion)
- afficher si l'auditeur est en mode `passive` ou `enforcing`
- afficher si une recommandation d'incident est en attente de revalidation

Strategie de rollout (obligatoire):
1) phase A: `passive` seulement, sans stop automatique
2) phase B: `enforcing` restreint a 1-2 signatures tres fiables
3) phase C: extension progressive de la whitelist si les faux positifs restent faibles

Critere d'acceptation de cette future implementation:
- l'auditeur n'introduit pas de races visibles avec le pipeline actif
- il produit des rapports actionnables lisibles par l'utilisateur
- en mode `passive`, aucun run sain n'est stoppe
- en mode `enforcing`, les incidents ouverts automatiquement sont re-validables par predicates locaux simples
- le Correcteur recupere le contexte de l'auditeur via le bundle d'incident sans inventer de nouveaux chemins paralleles

Note robustesse (turn safety):
- Si un tour Codex lance une commande longue (commandExecution en cours), le timeout **inactivity** doit etre suspendu
  tant que la commande tourne; seul le hard-timeout doit servir de garde-fou contre les runs infinis.
- Pour eviter de couper des calculs longs encore en cours, Antidex supporte un **soft timeout** (non fatal) pour les commandes:
  - Apres `soft_timeout`, l'orchestrateur **n'interrompt pas** le tour. Il emet un warning "watch mode".
  - Optionnel: si un `inactivity timeout` est configure pour les commandes (`ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS_COMMAND`) et qu'aucune activite
    n'est observee pendant `TURN_SOFT_STALL_GRACE_MS` apres le soft timeout, l'orchestrateur escalade en incident (`where=turn/soft_timeout`),
    met `developer_status=blocked` et declenche la boucle Manager/Corrector.
- Toute erreur de tour (inactivity/hard/soft-stall) ne doit **jamais** laisser le run en "limbo":
  - le run doit etre mis en `developer_status=blocked` (si role=developer) ou `status=failed` (sinon),
  - et `data/pipeline_state.json` doit refleter `developer_status=blocked` pour que `Continue`/auto-run declenche l'incident.

Note robustesse (long jobs):
- `job/crash`: tenter **1 auto-restart** du job si possible (restart_count < 1).
- Si le restart echoue (ou crash reapparait), bloquer le Manager avec une question `Q-job-crash` + `developer_status=blocked`.
- `job/crash` est une action Manager (diagnostic/restart/scope change) et ne doit pas declencher le Corrector automatiquement.
- lancement Windows: le protocole long-job doit persister une forme structuree `command_argv` quand la requete vient de `--script`, `--command-argv-json` ou d'arguments apres `--`; `--command` reste legacy et ne doit pas etre la voie recommandee pour des commandes avec quoting imbrique
- monitor long-job: ne jamais reveiller/arreter un job simplement parce qu'il est silencieux dans ses premieres minutes si le pid est encore vivant et qu'aucun signal de crash n'existe

Variables d'env (turn safety):
- `ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS[_<ROLE>]`: timeout d'inactivite (par defaut 20 min).
- `ANTIDEX_TURN_HARD_TIMEOUT_MS[_<ROLE>]`: hard cap wall-clock (par defaut 2h).
- `ANTIDEX_TURN_INACTIVITY_TIMEOUT_MS_COMMAND`: override d'inactivite pendant une commande (default: desactive -> pas d'idle-timeout).
- `ANTIDEX_TURN_SOFT_TIMEOUT_MS_COMMAND`: soft timeout wall-clock pour les commandes (defaut: 60 min).
- `ANTIDEX_TURN_HARD_TIMEOUT_MS_COMMAND`: hard cap wall-clock pour les commandes (defaut: 12h).
- `ANTIDEX_TURN_SOFT_STALL_GRACE_MS`: delai sans activite avant escalation apres soft timeout (defaut: 15 min).

### 4.3.2.1 Guardrails de reorientation (REWORK + incidents/Corrector)

But: eviter les boucles "REWORK -> rerun identique" et les reprises apres incident sans recul.
On ne cherche pas une detection heuristique generale de stagnation. A la place, on impose des points de recul
sur des evenements **binaires**:
- **a chaque REWORK** (review Manager),
- **a chaque incident qui declenche le Correcteur** (interne ou externe/Guardian).

#### A) REWORK => diagnostic + actions obligatoires

Quand le Manager rend `Decision: REWORK` dans `data/tasks/<task>/manager_review.md`, il doit aussi:
1) expliquer **pourquoi** (diagnostic bref, pas seulement "DoD not met"),
2) definir **ce qui change** (actions concretes) afin de ne pas re-dispatcher exactement la meme demande.

Contenu minimal obligatoire dans `manager_review.md` si REWORK:
- `Turn nonce: <turn_nonce>` (copie exacte du `turn_nonce` du header `READ FIRST`; sert de preuve de fraicheur du tour)
- `Reasons (short):` (liste de 1..N raisons)
- `Rework request:` (ce que le dev doit faire maintenant)
- `Next actions:` (au moins 1 action concrete parmi:)
  - mise a jour de `data/tasks/<task>/manager_instruction.md` (changement d'approche / parametres / preuve attendue),
  - creation d'au moins 1 nouvelle tache actionable dans `doc/TODO.md` (ex: "ameliore heuristique", "fix tie-break bias", "ajouter un quick experiment"),
  - reassign explicite (Codex<->AG) dans TODO si necessaire.

Postconditions (verifiables par l'orchestrateur):
- La fraicheur du review est validee en priorite par `Turn nonce: <turn_nonce>` dans `manager_review.md`; le `mtime` reste seulement un fallback de compatibilite.
- Si `Decision: REWORK`, `manager_review.md` doit contenir un bloc `Next actions:` avec au moins une ligne non vide.
- Et soit:
  - `data/tasks/<task>/manager_instruction.md` a ete modifie dans le tour de review, soit
  - `doc/TODO.md` a change (mtime) dans le tour de review (nouvelle action ou reassign/reorder).

Rationale: meme si la tache reste la meme, le Manager doit encoder "ce que je change" (sinon la boucle est probable).

#### A.1) REWORK outcome-driven => Goal check obligatoire

Definition "outcome-driven task" (tache orientee resultat):
- `task_kind` contient `benchmark`, `gate`, `tuning` ou `research`,
- ou `task_kind: ai_baseline_fix`,
- ou `task_kind: manual_test`,
- ou `task.md` mentionne explicitement un benchmark, un strength gate, une recherche, un tuning ou une validation manuelle.

Pourquoi:
- sur ces taches, un echec local peut en realite invalider l'approche amont,
- le Manager ne doit donc pas seulement demander "encore un rerun", il doit re-evaluer si le plan reste bon.

Contenu additionnel obligatoire dans `manager_review.md` si:
- `Decision: REWORK`
- ET la tache courante est outcome-driven

Le review doit alors contenir un bloc `Goal check:` avec au minimum:
- `Final goal:` (le but produit reel, pas seulement le DoD local)
- `Evidence that invalidates:` (ce que les preuves/artefacts montrent et qui casse une hypothese)
- `Failure type:` avec exactement une valeur parmi:
  - `local_task_issue`
  - `measurement_or_protocol_issue`
  - `upstream_plan_issue`
- `Decision:` (ce que le Manager decide maintenant)
- `Why this is the right level:` (pourquoi l'action choisie est locale vs protocole vs amont)

Regles de decision:
- Si `Failure type = local_task_issue`:
  - un rerun local de la meme tache est autorise,
  - MAIS le review doit aussi contenir `Rerun justification:` expliquant ce qui change vraiment et pourquoi ce rerun peut raisonnablement reussir.
- Si `Failure type = measurement_or_protocol_issue`:
  - un rerun local n'est autorise que si le review contient `Rerun justification:`,
  - et `manager_instruction.md` (ou TODO) doit preciser le nouveau signal attendu: budget, protocole, artefacts, candidats, metriques, etc.
- Si `Failure type = upstream_plan_issue`:
  - le Manager ne doit pas simplement redispatcher la meme tache,
  - il doit modifier `doc/TODO.md` dans le meme tour de review pour creer/reordonner une tache amont actionable,
  - apres ce review, la tache courante ne doit plus etre le **premier item TODO non coche**.

Nuance importante "fraicheur de preuve vs planning":
- Un artefact deja reviewe peut rester valable comme **input de decision** pour choisir la prochaine modification,
  tout en etant trop ancien pour servir de **preuve** au prochain review.
- Pour eviter que le Developer relance un rerun identique uniquement pour rafraichir `generated_at`, le Manager peut
  ajouter explicitement dans `manager_instruction.md` ou `manager_review.md`:
  - `Reviewed evidence may be reused for planning this step: yes`
- Cette autorisation ne vaut que si:
  - la meme tache est toujours en cours,
  - le protocole pertinent n'a pas change,
  - aucun changement de code/config pertinent n'a deja invalide l'artefact comme base de decision.
- Cette autorisation **ne supprime pas** l'exigence de preuve fraiche avant `ready_for_review`.

Postconditions (verifiables par l'orchestrateur):
- Si REWORK + outcome-driven:
  - `manager_review.md` contient `Goal check:`,
  - les 5 labels obligatoires ci-dessus existent,
  - `Failure type` est une valeur valide,
  - si `Failure type != upstream_plan_issue`, `Rerun justification:` existe,
  - si `Failure type = upstream_plan_issue`, `doc/TODO.md` a change pendant le tour ET le premier item TODO non coche n'est plus la tache courante.

Comportement orchestrateur:
- apres un review valide avec `manager_decision=continue`, Antidex rebascule vers le **premier item TODO non coche**,
- ainsi, si le Manager a cree/reordonne une tache amont, la reorientation prend effet immediatement au tour suivant.
- Pour reduire les retries inutiles, le prompt Manager doit fournir un **template de review** explicite
  (ACCEPTED / REWORK) avec les labels obligatoires deja presents (`Goal check`, `Rerun justification`, etc. quand requis).
- En cas de review invalide, Antidex doit relancer le meme tour Manager avec une erreur precise sur le label manquant,
  avant de retomber sur un blocage plus lourd.

Rationale:
- le guardrail REWORK precedent imposait "changer quelque chose";
- ce guardrail impose maintenant "changer au bon niveau".

#### B) Signal developer obligatoire pour les taches outcome-driven

But: ne pas forcer le Manager a inferer seul la cause probable a partir de tableaux de chiffres bruts.

Quand une tache outcome-driven passe en `developer_status=ready_for_review`, le livrable developer doit contenir
une section d'analyse "ce que ces resultats suggerent pour la suite".

Pour `developer_codex`:
- `data/tasks/<task>/dev_result.md` doit contenir un bloc `What this suggests next:` avec:
  - `Observed signal:`
  - `Likely cause:`
  - `Can current task still succeed as-is?:` (`yes|no|unclear`)
  - `Recommended next step:`
  - `Smallest confirming experiment:`

Pour `developer_antigravity`:
- `data/antigravity_runs/<runId>/result.json` doit contenir `output.what_this_suggests_next` avec les cles:
  - `observed_signal`
  - `likely_cause`
  - `can_current_task_still_succeed_as_is`
  - `recommended_next_step`
  - `smallest_confirming_experiment`

Postcondition (verifiable):
- une tache outcome-driven ne peut pas passer a `ready_for_review` sans ce bloc d'analyse.

Rationale:
- le developer reste responsable des preuves et d'un premier niveau de lecture,
- le Manager garde la decision finale, mais il ne part plus d'un signal muet.

#### C) Incident/Corrector => Post-Incident Review obligatoire

Quand un incident `data/incidents/INC-*.json` a `would_trigger_corrector=true` (ou qu'un `corrector_start` a eu lieu),
le prochain tour Manager ne doit pas enchainer directement sur un dispatch "comme si de rien n'etait".
Il faut un point de recul explicite.

Protocole:
1) L'orchestrateur ecrit une question actionnable sous la tache courante:
   - `data/tasks/<current_task>/questions/Q-post-incident-<id>.md`
   - elle pointe vers l'incident (`data/incidents/INC-...json` + `_result` + `_bundle`) et resume: observed + fix_status.
2) L'orchestrateur met `developer_status=blocked` et `manager_decision=null` dans `data/pipeline_state.json`.
3) Le Manager doit repondre via:
   - `data/tasks/<current_task>/answers/A-post-incident-<id>.md`
   - et mettre a jour `data/pipeline_state.json` pour reprendre (continue/blocked/completed).

Contenu minimal de `A-post-incident-*.md`:
- `Incident:` (fichier / signature)
- `What happened:` (1 paragraphe)
- `Decision:` (continue|blocked|completed)
- `Plan change:` (soit "none (why)", soit une liste de changements concrets: TODO reorder, nouvelle tache, changement d'agent, parametres, etc.)

Postcondition (verifiable):
- Une reponse `A-post-incident-*.md` existe et reference l'incident courant avant toute reprise auto-dispatch.

Rationale:
- Le Correcteur traite des anomalies (timeouts, desync, erreurs infra, guardrails). Sans un point de recul, Antidex
  risque de boucler sur la meme anomalie ou de continuer avec un plan non adapte.

### 4.3.3 Long jobs (developer_codex uniquement, V1)
Objectif: sortir les calculs longs du cycle "tour LLM ouvert" et les faire tourner comme des jobs supervises en background.

Regle produit:
- si une sous-tache developer risque de durer > 10-15 minutes, le Manager doit pouvoir exiger le mode "long job"
- scope V1: `developer_codex` seulement
- `tools/antidex.cmd job start` (ou ecriture d'une requete sous `data/jobs/requests/`) fournit l'enveloppe de supervision; le code metier du calcul reste ecrit par le developer dans le projet cible

Etat et cycle:
- le developer code d'abord le calcul (simulateur, benchmark, training, optimisation, etc.)
- il lance ensuite le job via l'enveloppe Antidex
- le run principal passe en `waiting_job`
- aucun timeout `turn/*` ne doit s'appliquer tant que le run attend un job sain
- un monitor Codex distinct ecrit un rapport horaire et peut continuer / stopper / relancer dans les limites autorisees

Artefacts standard:
- `data/jobs/<job_id>/job.json`
- `data/jobs/<job_id>/stdout.log`
- `data/jobs/<job_id>/stderr.log`
- `data/jobs/<job_id>/heartbeat.json`
- `data/jobs/<job_id>/progress.json`
- `data/jobs/<job_id>/result.json`
- `data/jobs/<job_id>/monitor_reports/REP-*.md`

Watchdog:
- remplacer les timeouts de tour par un watchdog de job pendant `waiting_job`
- incidents standard: `job/stalled`, `job/crash`, `job/monitor_missed`, `job/result_invalid`, `job/restart_failed`
- si le rapport horaire du monitor n'est pas ecrit a temps: incident prioritaire. En mode "Correcteur externe" (Guardian), ecrire un pending marker et stopper le run; sinon declencher le Correcteur in-process.

UI:
- l'UI doit afficher un panneau "Long Job" avec statut, logs, ETA, dernier heartbeat/progress et dernier rapport monitor
- pendant `waiting_job`, l'UI doit indiquer qu'aucun agent n'est actif et que le calcul tourne en background
- un job qui termine avec `result.json.status=error|failed|stopped|canceled` ne doit pas etre presente comme un crash silencieux; le dernier diagnostic doit rester visible et reveiller le dev
- si le pipeline est `stopped|paused` mais que le long job tourne encore, l'UI doit l'indiquer explicitement (`pipeline=stopped, long_job=running`) et conserver les actions manuelles du job
- l'action `Stop long job` ne doit pas implicitement faire `Continue pipeline`; si le pipeline est deja `stopped|paused|canceled`, il doit rester dans cet etat apres l'arret du job
- un `Continue` sur un ancien `waiting_job` sans job vivant et sans requete pending doit recuperer vers `implementing/ongoing` au lieu de rester bloque indefiniment
- une nouvelle requete `data/jobs/requests/REQ-*.json` doit prendre priorite sur tout ancien `activeJobId` mort; l'orchestrateur ne doit pas auto-redemarrer un vieux job si un nouveau lancement a deja ete demande
- si le dernier long job du run a deja ecrit un `result.json` terminal mais que `data/pipeline_state.json` est reste en `developer_status=waiting_job`, l'orchestrateur doit reconcilier ce stale state vers `developer_status=ongoing` et laisser le developer interpreter le resultat existant
- le panneau/API long-job doit preferer le statut terminal de `result.json` sur un `job.json` stale; un job avec `result.json.status=done|error|failed|stopped` ne doit plus s'afficher `running`
- cette priorite ne doit pas rester purement cosmetique: lors d'une sync ou d'un `GET /api/jobs/state`, Antidex doit aussi normaliser `job.json` et `monitor_reports/latest.*` vers l'etat terminal canonique si ces fichiers sont restes stale
- `developer_status=waiting_job` n'est valide que s'il existe soit une requete protocol-aware pending, soit un vrai job protocol-aware encore vivant (pid alive, pas de `result.json` terminal). Un ancien `job.json` stale `running` ne doit plus faire foi.
- s'il n'existe aucun `monitor_reports/latest.*` mais que le job est deja terminal (`result.json`) ou clairement mort, l'API/UI doit fournir un monitor synthétique minimal au lieu d'afficher `(no monitor report yet)`
- `developer_status=waiting_job` n'est valide que s'il existe une requete/job protocol-aware (`--script` ou argv vers `scripts/`), pas un simple lancement brut de binaire/metier

Reference detaillee:
- voir `doc/LONG_JOBS_SPEC.md` pour le contrat complet (Manager, developer, monitor, API, fichiers, watchdogs, correcteurs, UI)

#### Memoire consolidee par tache pour les long jobs

Probleme vise:
- les informations utiles a une bonne decision de rerun existent deja, mais elles sont trop dispersees entre
  `data/jobs/<job_id>/...`, `manager_review.md`, `manager_instruction.md`, `dev_result.md`, `data/pipeline_state.json`
  et la timeline du run
- cette dispersion suffit pour un diagnostic humain, mais pas pour guider proprement plusieurs cycles de long jobs

Objectif:
- produire une **memoire canonique par tache** qui consolide les tentatives de long jobs, leurs resultats,
  les conclusions Manager et le contexte pipeline courant
- faire de cette memoire la premiere source a lire avant toute reinterpretation d'un ancien job ou tout rerun

Artefacts obligatoires:
- `data/tasks/<task_id>/long_job_history.json`
- `data/tasks/<task_id>/long_job_history.md`

Principe:
- ces fichiers sont derives des sources de verite existantes; ils ne remplacent pas `data/jobs/<job_id>/...`
- l'orchestrateur les regenere de facon deterministe a chaque point de controle important:
  - sync run/UI
  - entree developer
  - entree/sortie manager review
  - demarrage, fin, stop ou reconciliation d'un long job

Sources consolidees:
- `data/jobs/<job_id>/request.json`
- `data/jobs/<job_id>/job.json`
- `data/jobs/<job_id>/result.json`
- `data/jobs/<job_id>/monitor_reports/latest.json|md`
- `data/tasks/<task_id>/manager_review.md`
- `data/pipeline_state.json`
- etat runtime du run (`status`, `developer_status`, `activeTurn`, `activeJob`, `lastJobId`)

Schema minimal de `long_job_history.json`:
- `schema = antidex.long_job.history.v1`
- `generated_at`
- `run_id`
- `task_id`
- `current_pipeline`
  - `run_status`
  - `developer_status`
  - `manager_decision`
  - `active_turn_role`
  - `summary`
- `counts`
  - `attempts_total`
  - `terminal_attempts`
  - `successful_attempts`
- `latest_attempt`
- `latest_manager_review`
- `attempts[]`

Champs minimaux par tentative:
- `attempt_index`
- `job_id`
- `run_id`
- `task_id`
- `request_created_at`
- `started_at`
- `ended_at`
- `expected_minutes`
- `launch_kind`
- `script_path`
- `command`
- `command_argv`
- `job_status`
- `result_status`
- `display_status`
- `pid`
- `pid_alive`
- `active`
- `result_summary`
- `result_error`
- `outputs[]`
- `latest_monitor`
- `refs`
- `latest_manager_review` si la review la plus recente cite explicitement ce `job_id`

Regles de consolidation:
- l'ordre canonique des tentatives est chronologique par `request_created_at`, puis `started_at`, puis `ended_at`
- la representation UI/API d'un job (`display_status`, monitor, pidAlive) prime sur un `job.json` stale si `result.json` est deja terminal
- si un job terminal n'a jamais ecrit `monitor_reports/latest.*`, l'historique doit integrer le monitor synthetique genere par l'orchestrateur
- un `job.json` stale `running` avec `result.json` terminal ne doit jamais etre compte comme tentative active

Regles de decision:
- avant tout rerun, le Manager doit lire `long_job_history.md`
- avant tout nouveau `REQ-*.json`, le Developer doit lire `long_job_history.md`
- tout rerun doit expliciter ce qui a change depuis la derniere tentative terminale
- si rien n'a change depuis la derniere tentative terminale, un rerun massif est presume non pertinent et doit etre justifie explicitement
- si `manager_review.md` cite un `job_id`, cette relation doit apparaitre dans `long_job_history.*`

Regles d'instructions agents:
- prompt Manager review: lire `long_job_history.md` et l'utiliser comme memoire canonique des tentatives et conclusions
- prompt Manager answering: utiliser `long_job_history.md` si la question concerne un crash, un rerun ou une preuve stale
- prompt Developer Codex: lire `long_job_history.md` avant de reutiliser des artefacts ou de relancer un benchmark, et expliquer dans `dev_result.md` ce qui change par rapport a la derniere tentative terminale

API/UI:
- `GET /api/jobs/state` doit renvoyer `taskHistory.markdown` / `taskHistory.json` quand l'historique existe
- l'UI long-job doit afficher cette reference de facon compacte dans le resume meta du panneau

Compatibilite:
- l'absence de `long_job_history.*` reste normale pour une tache qui n'a jamais utilise le protocole long-job
- ces fichiers sont regenerables; ils ne doivent pas devenir une source unique de verite ecrite a la main

### 4.4 Runs Antigravity (reutilisation Antigravity_POC)
Pour une tache executee par Antigravity, utiliser le protocole par run:
- `data/antigravity_runs/<runId>/request.md`
- `data/antigravity_runs/<runId>/ack.json` (optionnel mais recommande)
- `data/antigravity_runs/<runId>/result.tmp` -> rename -> `result.json` (atomic write)
- `data/antigravity_runs/<runId>/artifacts/` (captures, exports, etc.)

Note robustesse (delivery):
- L'ACK est le signal principal que le message est bien "pris en charge" par AG.
- Si l'ACK n'arrive pas dans le delai, l'orchestrateur doit traiter ca comme un probleme de livraison et tenter une re-dispatch (nouveau thread) avant de "continuer".
- Ne pas inferer un ACK a partir de simples mtimes sous `data/antigravity_runs/<runId>/` (Antidex ecrit deja `request.md`/`artifacts/`, et des outils/OS peuvent toucher les mtimes).
Note robustesse (dispatch):
- Apres 3 stalls watchdog AG consecutifs sur une tache, l'orchestrateur doit bloquer avec une question "AG disabled" avant tout guardrail `dispatch_loop` generique, afin de forcer une decision Manager (switch dev ou override explicite).
- Reprise apres Stop/Failed (operator intent): lors d'un `Continue pipeline` apres `status=stopped|failed`, l'orchestrateur reset les compteurs transients pour la **tache courante** (ex: `agRetryCounts`, resend/reload, `taskDispatchCounts`) et force une nouvelle conversation AG 1x, pour permettre une re-dispatch si le probleme externe cote AG a ete corrige.
- AG watchdog: un incident `ag/watchdog` est une action Manager (Q-watchdog) et ne doit **pas** declencher le Corrector; l'incident reste ecrit pour traceabilite.

Le prompt envoye a Antigravity doit inclure explicitement ces chemins et la regle d'ecriture atomique.

REWORK (important):
- Si `data/tasks/<task_id>/manager_review.md` existe et que sa decision est **REWORK**, l'orchestrateur doit envoyer un message de dispatch **different**:
  - inclure un header explicite `DISPATCH TYPE: REWORK`,
  - inclure `data/tasks/<task_id>/manager_review.md` dans la liste "Then read (in order)" du prompt AG,
  - inclure un extrait du contenu de `manager_review.md` (trunque) dans le message afin que AG voie immediatement les raisons + la demande de rework.

### 4.5 Transitions (declencheurs entre agents)
Les agents ne "switchent" pas magiquement entre eux: c'est l'orchestrateur (backend) qui lance le prochain agent en fonction de **marqueurs fichiers**.

Declencheurs proposes:
- **Manager -> Developer**: creation/mise a jour d'un dossier de tache + instruction (`data/tasks/.../manager_instruction.md`) + eventuel pointer mailbox.
- **Developer -> Job**: pour une tache Codex longue, le developer lance un job background, ecrit les artefacts `data/jobs/<job_id>/...`, puis rend la main; le run passe en `waiting_job`.
- **Job -> Monitor**: a chaque echeance horaire (ou a la fin du job), l'orchestrateur ouvre un court tour Codex "monitor" pour interpreter les artefacts courants et ecrire un rapport.
- **Monitor -> Developer/Manager**: le monitor peut continuer, stopper, relancer dans un perimetre preapprouve, reveiller le developer, ou escalader au Manager.
- **Developer -> Manager (review)**: presence d'un RESULT valide (`dev_result.*` ou `data/antigravity_runs/.../result.json`) + mise a jour de `data/pipeline_state.json` (`developer_status=ready_for_review`).
- **Manager -> suite**: le Manager ecrit `manager_decision` (`continue|completed|blocked`) et met a jour la TODO + la tache (review).
- Handshake "turn marker" (Codex): la combinaison **marker+postconditions** est le signal de succes. Si le signal `turn/completed` n'arrive pas apres un court delai (apres `turn/interrupt`), l'orchestrateur doit **detacher** le tour (force-unblock local) et continuer afin d'eviter un run wedge ("Another turn is already running"). L'orchestrateur doit tracer un event timeline `turn_detached_after_marker`.
- Robustesse review loop: si un review valide fait avancer l'etat (decision + `developer_status` conforme), le compteur de reviews pour la tache doit etre remis a zero.
- Robustesse review loop: apres reponse Manager a `Q-review-loop`, reinitialiser le compteur de reviews de la tache (nouveau cycle, eviter re-blocage immediat).
- Robustesse REWORK: ne pas considerer `dev_ack.json` comme preuve de nouveau resultat; la reprise auto vers `ready_for_review` apres REWORK exige un `dev_result.*` (ou `result.json` AG) plus recent que `manager_review.md`.
- Robustesse REWORK outcome-driven: pour une tache outcome-driven, `dev_result.*` seul ne suffit pas. Le passage a `ready_for_review` doit exiger des artefacts de preuve frais (reports/result.json references par `task.md` / `manager_instruction.md`) plus recents que `manager_review.md`.
- Robustesse REWORK outcome-driven (preuves citees par le dev): si `dev_result.md|json` cite un report `reports/*.json`, ce report devient une preuve explicite et doit lui aussi etre frais par rapport a `manager_review.md`; un `dev_result.*` plus recent ne peut pas masquer un `meta.generated_at` stale dans le report cite.
- Robustesse REWORK (meme tache): quand le Manager rend `manager_decision=continue` sur la **meme** tache apres un `REWORK`, la rebase TODO doit preserver l'intention `developer_status=ongoing` au lieu de re-promouvoir automatiquement `ready_for_review` a cause d'un vieux `dev_result.*` deja present.
- Robustesse dispatch loop: apres un review valide (ACCEPTED/REWORK), reinitialiser le compteur de dispatch pour la tache, afin que le guardrail `dispatch_loop` ne bloque pas des cycles de rework deja valides.
- Robustesse handshake developer: si `dev_ack.json` + `dev_result.*` existent mais que `developer_status` reste `ongoing`/manquant, l'orchestrateur auto-promote vers `ready_for_review` (ou `waiting_job` si une requete/job long job est detecte), et journalise l'auto-correction dans `data/recovery_log.jsonl`.
- Robustesse long job (scope): si une requete long job ne correspond pas au scope attendu de la tache (ex: 2p vs 3p), l'orchestrateur bloque le Manager avec une question actionnable, nettoie la requete invalide, et evite un echec dur du tour.
- Robustesse questions developer: `developer_status=blocked` est valide uniquement si un nouveau `questions/Q-*.md` existe (plus recent que le dernier `answers/A-*.md`), sinon le tour developer est considere incomplet.

## 5) Boucle de travail (logique Manager)

### 5.1 Phase 0 â€” Initialisation (backend)
- L'utilisateur choisit un `cwd` cible et saisit le prompt "cahier des charges".
- Le backend demarre:
  - codex app-server (si pas deja),
  - thread Manager,
  - thread Developer Codex (thread unique par defaut; renouvelable si `thread_policy.developer_codex=new_per_task`),
  - et verifie la connectivite Antigravity (connector `/health` + `/diagnostics`).
- Le backend bootstrape les fichiers minimaux dans le projet cible (doc + agents + pipeline_state).

### 5.2 Phase 1 â€” Planification (Manager)
Le Manager:
- lit les regles docs,
- produit/complete SPEC/TODO/TESTING_PLAN (+ DECISIONS si hypotheses),
- cree/initialise la liste de taches,
- fixe l'ordre (priorites + ordre d'execution),
- prepare les instructions aux developpeurs (fichiers d'instructions).

### 5.3 Phase 2 â€” Dispatch + Implementation (sequentiel, tache par tache)
Pour chaque tache:
1) Le Manager choisit le developpeur:
   - **Codex**: code, refactors, tests automatises, scripts, etc.
   - **Antigravity**: browser/config, actions sur plateformes, tests UI finaux, recuperation/creation de cles API via UI, etc.
   - Ratio AG/Codex (quota-aware): si le quota AG est bas (<= 40%), il est possible que le Manager doive changer l'assignation des taches (doc/TODO.md) pour alterner AG/Codex sur les taches "either-dev" (hors taches browser-forced).
2) Le Manager met a jour:
   - la tache (`data/tasks/T-xxx_<slug>/...`),
   - `data/pipeline_state.json` (qui fait quoi, etat).
   - la politique "thread" pour la tache (par defaut: reuse; override si besoin).
3) Execution:
   - Codex dev: lit `agents/developer_codex.md` + `task.md` + `manager_instruction.md`, ecrit `dev_ack.json` puis `dev_result.*`, puis met `developer_status=ready_for_review`.
   - Antigravity dev: lit `agents/developer_antigravity.md` + `task.md` + `manager_instruction.md`, ecrit `ack.json` puis `result.json` atomique (et/ou un pointeur `dev_result.json` dans le dossier de tache), puis met `developer_status=ready_for_review`.

### 5.4 Phase 3 â€” Verification (Manager)
Apres chaque tache, le Manager:
- verifie le resultat (lecture des preuves, fichiers modifies, adherence a SPEC/TODO),
- lance/valide les tests pertinents (ou exige leur execution et preuve),
- re-evalue le projet dans son ensemble pour verifier que ca colle toujours a la demande (y compris changements eventuels dans `doc/TODO.md` modifies par l'utilisateur),
- decide:
  - **OK**: marque la tache done (TODO + result), documente et passe a la suivante,
  - **Pas OK**: ecrit feedback clair (dans la tache), puis re-dispatch (meme developpeur ou autre).

### 5.5 Completion
Le pipeline ne s'arrete que si:
- toutes les taches P0/P1 necessaires sont terminees,
- les tests "headline" sont executes et passes,
- la doc est coherente (SPEC/TODO/TESTING_PLAN/DECISIONS/INDEX),
- et le Manager ecrit `manager_decision=completed` + resume final.

## 6) Tests â€” politique

Rappel (issu du document initial, adapte a ce projet):
- Les TODO doivent contenir des tests (unit + "headline").
- Les tests "headline" (ex: Playwright) sont typiquement realises via Codex.
- Si l'application cible a une UI web, AG effectue des tests finaux via son browser.
- `npm run test:pw` doit rester lancable meme si `Antidex_V2/node_modules` manque temporairement: le wrapper local peut reutiliser une installation Playwright compatible d'un checkout voisin (`../Antidex/node_modules`) pour eviter la dependance a `npx`.
- Si un run passe en `stopped` (notamment `corrector/restart_required`), l'orchestrateur ne doit plus laisser un `developer_status=waiting_job` **stale** ni exposer un `activeJob` fantome dans l'UI; en revanche un long job reellement vivant peut rester visible. Le background supervisor long-job ne doit plus adopter/redemarrer de job mort pour ce run avant un `Continue` explicite.
- Une requete long-job peut aussi etre **hors-scope metier**. Pour les taches outcome-driven reframées (ex: passage de `2p` a `3p`), Antidex doit refuser les wrappers qui ne correspondent plus au perimetre actif (`*_2p_*` sur une tache `3p`) et peut imposer un ordre de preuves (`EASY` controle avant `MEDIUM`) si `manager_instruction.md` l'exige explicitement.

Le Manager reste responsable de la **strategie de test** et de la verification.

## 7) Risques / limites (connus)
- Antigravity: "resume/reuse" cible la conversation active; pas de selection stable par ID pour l'instant. Le Manager peut basculer une tache en `new_per_task` si la continuite devient fragile.
- Injection CDP: depend de `--remote-debugging-port` et d'heuristiques; peut casser si l'UI Antigravity change.
- Coherences multi-agents: sans protocole fichiers strict (taches + preuves), le run peut devenir non deterministe.
- Encodage/Windows: des "vieux runs" peuvent contenir du texte mojibake (ex: `UniversitÃƒÂ©`). L'orchestrateur doit reparer ces champs au chargement pour que les chemins (TODO/logs) restent lisibles.

- Corrector: sans supervisor, le Corrector se declenche quand meme, mais ne peut pas auto-restart Antidex. Si un restart est requis, le run est stoppe avec un message "restart requis" pour eviter les boucles.

## 8) Questions ouvertes / manque de details (a trancher avant dev)

1) **Nom et structure des fichiers d'instructions**:
   - Confirmer les chemins (`agents/*.md` ?) et le format exact.
2) **Format des taches**:
   - Markdown libre vs JSON schema; quelles metadonnees obligatoires (id, owner, doD, preuves, etc.) ?
3) **Taille des taches**:
   - Criteres (a appliquer):
     - le Manager estime que le developpeur ecrira **< 700 lignes** (ordre de grandeur) sur la tache;
     - le decoupage doit rester coherent (pas seulement "petit", mais logique).
   - Questions ouvertes:
     - comment mesurer/estimer (diff lignes? code seulement? docs/tests inclus?) et comment appliquer aux taches Antigravity (browser/config)?
4) **Definition de "verification OK"**:
   - Quelles preuves obligatoires par tache (tests, logs, diff, fichiers listes) ?
5) **Arbitrage du choix dev (Codex vs AG)**:
   - Pure decision du Manager (LLM) ou regles deterministes + override utilisateur ?
6) **Gestion des credentials/secrets**:
   - Ou stocker (ex: `data/secrets.json` dans le projet cible ?) et quelles regles (ne pas commit, etc.) ?
7) **Arret/reprise**:
   - Quelle est la source de verite pour reprendre un run (state store orchestrateur vs marqueurs projet cible) ?

## 9) References (POCs)
- `Local_Agents/Local_Codex_appserver/` (client `codex app-server`, UI single-thread)
- `Local_Agents/Local_Codex_dual_pipeline/` (pipeline manager<->dev via 2 threads + `data/pipeline_state.json`)
- `Local_Agents/Antigravity_POC/` (connector client + protocole `result.json` + UI sender)

## 10) (Reserve)
Section reservee pour ajouts futurs.

