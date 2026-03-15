# Robustesse long-run (12h+) — Pistes & Backlog post-Phase 3

Ce document décrit les améliorations “anti-arrêt bête” visées pour Antidex quand il sort du chemin nominal. L’objectif est que le pipeline **ne s’arrête pas silencieusement**, et que **le Manager reprenne la main** avec une information exploitable quand un agent ou un protocole ne se comporte pas comme prévu.

**Timing**: ces améliorations sont à **implémenter à la toute fin, après la dernière phase** du roadmap (une fois le fonctionnement nominal stabilisé et validé).

## Direction générale (“ne jamais s’arrêter bêtement”)

1) **Passer de “throw/failed” à “handoff au Manager”**  
Quand une précondition n’est pas satisfaite (fichier attendu manquant, JSON invalide, timeout, incohérence d’état…), l’orchestrateur ne doit pas “mourir” par défaut. Il doit:
- produire un **incident** (un paquet d’info clair),
- **bloquer proprement** le pipeline (statut `blocked`),
- créer un **Q/A** à l’attention du Manager (quoi vérifier, quoi corriger, quoi relancer),
- puis laisser le Manager décider (réessayer, basculer de dev, changer thread policy, ajuster instructions, etc.).

2) **Incident packet standardisé (source unique de vérité pour le “hors-nominal”)**  
Au lieu de messages d’erreur dispersés, créer un artefact stable par incident (ex: `data/incidents/INC-*.md|.json`) qui contient:
- `where` (étape orchestrateur + agent + task_id),
- `what` (symptôme observé),
- `expected` vs `observed`,
- `evidence` (paths + extraits courts),
- `suggested_actions` (réessai / nouveau thread / bascule AG→Codex / patch de protocole),
- `attempt` / `retry_policy` (numéro d’essai, délais).
Et un pointeur dans `data/pipeline_state.json` (ex: `last_incident_id` + résumé).

3) **Dégradation contrôlée (“continue sans AG”, “safe mode”)**  
Après N essais infructueux d’un canal (AG, dev Codex, ou même Manager), l’orchestrateur ne doit pas rester bloqué indéfiniment:
- “AG indisponible pour ce task_id / pour ce run” → recommander bascule vers dev Codex,
- “Codex dev instable” → réessai en nouveau thread, puis escalade au Manager,
- “problème structurel” → `blocked` avec incident complet et instructions de récupération.

4) **Observabilité first-class**  
Pour diagnostiquer vite, il faut des signaux stables:
- “dernier progrès” par agent (mtime d’un fichier heartbeat/ack/result),
- “étape exacte” orchestrateur (state machine explicite),
- “attendus” (liste de fichiers/conditions) + état de satisfaction,
- logs consultables facilement (pointeurs de run, tails).

5) **Normalisation du temps / timestamps**  
Ne jamais se baser sur des timestamps non normalisés (formats différents, fuseaux, BOM/encoding).  
Le temps utile pour l’orchestrateur = **horloge orchestrateur** + **mtime filesystem** + `ISO-8601` normalisé quand on écrit.

## Catégorisation: erreurs fatales vs non fatales

L’objectif n’est pas d’éliminer toutes les erreurs, mais de réduire drastiquement les “fatal errors” et de convertir un maximum de cas en “non-fatal → handoff Manager”.

### Erreurs fatales (doivent stopper le run, mais avec un incident exploitable)

Une erreur est “fatale” si Antidex **ne peut pas progresser** sans action humaine et qu’aucune stratégie de repli n’est raisonnable.

- **Impossible de démarrer ou contacter les dépendances critiques** de manière persistante:
  - `codex app-server` introuvable / ne démarre pas (binaire manquant, `spawn codex ENOENT` persistant).
  - API server Antidex incapable d’écouter sur un port (permissions/port déjà pris sans alternative).
- **Authentification/quotas bloquants**:
  - tokens/quotas épuisés côté Codex (si aucune exécution n’est possible) et pas de mode dégradé utile.
  - secrets requis absents ET impossibles à créer automatiquement (ex: manque total de credential).
- **Corruption / incohérence durable de la source de vérité**:
  - `data/pipeline_state.json` irrécupérable (parse impossible + aucune version de sauvegarde + impossibilité de régénérer sans perdre le run).
  - structure du projet cible non accessible (droits FS, disque, path invalide).
- **Invariants de sécurité violés**:
  - tentative d’écrire hors `project_cwd` (path traversal), ou modifications interdites (selon politiques futures).

Ce que “fatale” doit quand même faire:
- écrire un incident complet,
- proposer une procédure de recovery,
- laisser le run dans un état “stoppable” et compréhensible (pas un crash silencieux).

### Erreurs non fatales (doivent être récupérables sans arrêter le pipeline)

Une erreur est “non fatale” si on peut raisonnablement:
- réessayer,
- basculer de stratégie,
- ou demander au Manager de décider (handoff), sans perdre l’intégrité du run.

- **Connecteur AG retourne un “échec” non fiable** (ex: “Verification failed…” alors que le message est reçu).  
  → traiter comme warning; vérité = ACK/heartbeat/result côté filesystem.
- **Fichier attendu manquant** (ACK/result/marker/review) alors que l’agent affirme l’avoir écrit.  
  → handoff Manager + diagnostic: paths exacts, mtime, recherche contrôlée, puis réessai.
- **Encodage/BOM/JSON parsing** (ex: `Unexpected token '﻿'`).  
  → normaliser (strip BOM), relire en stable-read, demander au dev de réécrire JSON.
- **Timestamps incohérents** (format local vs ISO) ou `updated_at` non fiable.  
  → ignorer comme vérité, utiliser mtime + horloge orchestrateur; demander correction progressive.
- **Pipeline “already running” alors que l’utilisateur pense le contraire**.  
  → endpoint “force unlock” + état visible + option de reprise; incident non fatal.
- **“run not found”** côté UI.  
  → reconstruire depuis pointeur `last_run.json`, ou offrir un browser de runs; non fatal.
- **Agent silencieux / stalling** (AG ou dev Codex) tant qu’on a un watchdog + retry + bascule.  
  → après N essais: bascule de dev recommandée; run continue.
- **Conflits d’état** (ex: current_task_id changé pendant qu’on vérifie un artefact).  
  → rendre les postconditions “liées à un task_id + attempt_id” (pas au curseur global), puis resync.
- **Arrêt “implicite” parce qu’on attend un clic utilisateur** (UI step-by-step).  
  Exemple typique: le développeur termine et met `developer_status=ready_for_review`, mais rien ne déclenche automatiquement la review Manager et la tâche suivante n’est jamais dispatchée.  
  → considérer ça comme non fatal et implémenter un mode “auto-continue” (voir section ci-dessous).

## “Handoff au Manager” — comportement attendu

Quand l’orchestrateur détecte un hors-nominal non fatal:
1) Écrire un incident stable (avec preuves + suggestions).
2) Mettre l’état en `blocked` (ou `reviewing` si pertinent) avec pointeur vers l’incident.
3) Créer un Q/A adressé au Manager (format existant: `questions/Q-*.md`).
4) Relancer le Manager avec un prompt court:
   - “Lis l’incident X + Q-*.md, décide: retry/new thread/switch dev/adjust instructions, puis écris la décision.”
5) Une fois la décision écrite, l’orchestrateur exécute la décision (retry, switch, etc.).

## Backlog post-Phase 3 (implémentation suggérée)

- Ajouter un dossier et un format d’incidents: `data/incidents/INC-*.md|.json` + pointeurs dans `pipeline_state.json`.
- Remplacer les `throw` “opérationnels” par:
  - création d’incident,
  - `blocked`,
  - Q/A Manager,
  - retry policy.
- Unifier les retry policies (AG/Codex/Manager) + backoff + plafonds par task_id.
- Ajouter un heartbeat orchestrateur (ex: `data/orchestrator/heartbeat.json`) pour runs longs.
- Ajouter une vue UI minimaliste “incidents” + “dernier progrès par agent”.
- Normaliser timestamps & encodings (strip BOM, ISO-8601, stable read).
- Ajouter un **mode auto-continue** (background runner) pour ne pas dépendre d’actions manuelles:
  - “run until stable wait” (boucle contrôlée) tant qu’on ne rencontre pas `blocked`, `failed`, ou une action humaine explicite.
  - au minimum: enchaîner automatiquement `developer -> manager review -> dispatch next developer` quand tout est satisfaisant.
  - fournir une bascule UI “Step-by-step / Auto-run” + un bouton “Pause”.
