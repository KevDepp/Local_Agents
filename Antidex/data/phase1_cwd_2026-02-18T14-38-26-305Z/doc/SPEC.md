# SPEC

Context:
- Ce projet de démonstration orchestre une petite chaîne de tâches séquentielles.
- L'utilisateur souhaite créer trois fichiers dans le projet courant:
  - `hello.txt`
  - `world.txt`
  - `files.md` listant `hello.txt` et `world.txt`.
- Chaque étape (création de chaque fichier puis agrégation dans `files.md`) doit être réalisée comme **tâche séparée**.

Objectifs:
- Concevoir un flux de travail géré par Antidex où:
  - le Manager découpe la demande en tâches unitaires,
  - chaque tâche est clairement spécifiée et assignée à `developer_codex`,
  - l'exécution suit un ordre strict: T-001, T-002, T-003.

Portée (phase actuelle):
- Exécution des tâches séquentielles (création des fichiers).
- T-001_hello en cours d'exécution: créer `hello.txt`.
- Création des tâches (déjà en place):
  - `T-001_hello` : créer `hello.txt`.
  - `T-002_world` : créer `world.txt`.
  - `T-003_files` : créer `files.md` listant `hello.txt` et `world.txt`.
- Mise à jour de la documentation projet (SPEC, TODO, TESTING_PLAN, DECISIONS, INDEX).
- Mise à jour de `data/pipeline_state.json` pour pointer sur la première tâche à exécuter.

Hors périmètre (phase actuelle):
- Exécution effective des tâches (création réelle des fichiers).
- Intégration Git/GitHub (commits) au-delà des règles déjà décrites dans `doc/GIT_WORKFLOW.md`.

Acceptance criteria:
- La spécification décrit clairement:
  - la demande utilisateur,
  - la liste des tâches à créer,
  - l'ordre d'exécution attendu.
- `doc/TODO.md` contient trois entrées numérotées (1,2,3) correspondant aux tâches T-001, T-002, T-003, marquées P0.
- `doc/TESTING_PLAN.md` décrit comment vérifier:
  - l'existence de `hello.txt`,
  - l'existence de `world.txt`,
  - le contenu de `files.md` listant les deux fichiers, un par ligne.
- `doc/DECISIONS.md` mentionne la création de cette mini-pipeline de tâches.
- `data/pipeline_state.json` est mis à jour avec:
  - `phase = "dispatching"`,
  - `current_task_id = "T-001_hello"`,
  - `assigned_developer = "developer_codex"`,
  - `developer_status = "ongoing"`.
