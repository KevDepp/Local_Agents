# Manager Instruction — T-003_files

Rôle cible: `developer_codex`

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md`,
  - `doc/SPEC.md`,
  - `doc/TODO.md`,
  - `doc/TESTING_PLAN.md`,
  - `doc/DECISIONS.md`.

## Tâche
- Implémente la tâche décrite dans `data/tasks/T-003_files/task.md`:
  - création de `files.md` à la racine,
  - ajout d’une liste en Markdown listant `hello.txt` et `world.txt`.

## ACK / RESULT / Q-A
- ACK:
  - écris `data/tasks/T-003_files/dev_ack.json` (exemple minimal):
    - `{ "developer": "developer_codex", "status": "started", "updated_at": "<ISO8601>" }`.
- RESULT:
  - écris le résultat dans `data/tasks/T-003_files/dev_result.md` (ou `.json`), incluant:
    - description du contenu de `files.md`,
    - preuves que `hello.txt` et `world.txt` existent,
    - tests/commandes exécutés,
    - éventuels problèmes.
- Q/A:
  - si besoin, crée `data/tasks/T-003_files/questions/Q-001.md` pour toute question.

## Tests à exécuter
- Applique les vérifications pertinentes du `doc/TESTING_PLAN.md` pour T-003_files:
  - existence de `files.md`,
  - présence des entrées pour `hello.txt` et `world.txt`,
  - cohérence entre les fichiers listés et les fichiers réellement présents.

## Attentes de qualité
- Ne pas étendre le scope au-delà de la liste demandée.
- Garder le format simple et lisible pour faciliter les futures évolutions.

