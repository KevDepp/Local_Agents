# Manager Instruction — T-001_hello

Role: Developer Codex (`developer_codex`).

## Instructions
- Lire avant tout:
  - `agents/developer_codex.md` (et vérifier la `version`).
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`.
- Prendre en compte la séquence de tâches décrite dans `doc/TODO.md` (Order 1/2/3).
- Pour cette tâche `T-001_hello`, créer uniquement le fichier `hello.txt`.

## Scope de la tâche
- Créer `hello.txt` (par défaut à la racine du projet courant).
- Ne pas créer `world.txt` ni `files.md` (qui seront gérés par `T-002_world` et `T-003_files`).
- Préparer les preuves dans `data/tasks/T-001_hello/`:
  - `dev_ack.json` — accusé de réception de la tâche.
  - `dev_result.md` ou `dev_result.json` — résumé de ce qui a été fait + commandes de test.

## Preuves et tests attendus
- Commandes suggérées (exemples, à adapter):
  - `ls` ou `dir` pour montrer `hello.txt`.
  - `Test-Path ./hello.txt` (PowerShell) ou équivalent.
  - Optionnel: afficher le contenu de `hello.txt` (`Get-Content hello.txt`).
- Reporter ces preuves dans `dev_result`.

## Emplacement des fichiers d'échange
- ACK: écrire `data/tasks/T-001_hello/dev_ack.json`.
- RESULT: écrire `data/tasks/T-001_hello/dev_result.md` (et/ou `.json` si plus pratique).
- Q/A:
  - Questions: `data/tasks/T-001_hello/questions/Q-*.md`
  - Réponses: `data/tasks/T-001_hello/answers/A-*.md`

