# Manager Instruction — T-002_world

Rôle cible: `developer_codex`

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md`,
  - `doc/SPEC.md`,
  - `doc/TODO.md`,
  - `doc/TESTING_PLAN.md`,
  - `doc/DECISIONS.md`.

## Tâche
- Implémente la tâche décrite dans `data/tasks/T-002_world/task.md`:
  - création du fichier `world.txt` à la racine du projet,
  - contenu simple mais cohérent (texte lisible, non vide, en lien avec "world").

## ACK / RESULT / Q-A
- ACK:
  - écris `data/tasks/T-002_world/dev_ack.json` (exemple minimal):
    - `{ "developer": "developer_codex", "status": "started", "updated_at": "<ISO8601>" }`.
- RESULT:
  - écris le résultat dans `data/tasks/T-002_world/dev_result.md` (ou `.json`), incluant:
    - fichiers créés/modifiés,
    - contenu ou extrait de `world.txt`,
    - tests/commandes exécutés,
    - problèmes éventuels.
- Q/A:
  - si besoin, crée `data/tasks/T-002_world/questions/Q-001.md` et décris la question.

## Tests à exécuter
- Applique les vérifications pertinentes du `doc/TESTING_PLAN.md` pour T-002_world:
  - existence et contenu de `world.txt`.

## Attentes de qualité
- Ne pas anticiper la tâche suivante (T-003_files).
- Garder le scope minimal et bien documenté dans le résultat.

