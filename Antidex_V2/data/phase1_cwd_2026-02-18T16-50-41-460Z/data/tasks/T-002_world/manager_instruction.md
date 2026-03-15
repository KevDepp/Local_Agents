# Manager Instruction — T-002_world

Role: Developer Codex (`developer_codex`).

## Instructions
- Lire avant tout:
  - `agents/developer_codex.md` (et vérifier la `version`).
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`.
- Tenir compte du fait que `T-001_hello` doit être terminée avant `T-002_world` (Order 1 puis 2 dans `doc/TODO.md`).

## Scope de la tâche
- Créer `world.txt` (par défaut à la racine du projet).
- Ne pas modifier la responsabilité de `T-003_files` (pas de création/édition de `files.md` ici).
- Vérifier que `hello.txt` existe toujours après vos modifications.

## Preuves et tests attendus
- Commandes suggérées:
  - `ls` ou `dir` pour montrer `hello.txt` et `world.txt`.
  - `Test-Path ./world.txt` et, si utile, `Test-Path ./hello.txt`.
  - Optionnel: afficher le contenu de `world.txt`.
- Reporter ces preuves dans `dev_result`.

## Emplacement des fichiers d'échange
- ACK: écrire `data/tasks/T-002_world/dev_ack.json`.
- RESULT: écrire `data/tasks/T-002_world/dev_result.md` (et/ou `.json`).
- Q/A:
  - Questions: `data/tasks/T-002_world/questions/Q-*.md`
  - Réponses: `data/tasks/T-002_world/answers/A-*.md`

