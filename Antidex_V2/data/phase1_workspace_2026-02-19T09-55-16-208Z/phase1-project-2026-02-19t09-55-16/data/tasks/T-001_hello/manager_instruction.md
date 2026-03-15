# Manager Instruction — T-001_hello

## Rôle ciblé
- Développeur: `developer_codex`

## Lecture préalable (obligatoire)
- Lis `agents/developer_codex.md` (note la `version` indiquée en tête de fichier).
- Respecte également `doc/DOCS_RULES.md` et `doc/GIT_WORKFLOW.md`.

## Spécification de la tâche
- Contrat détaillé: `data/tasks/T-001_hello/task.md`
- Contexte global: `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`

## Travail demandé
- Créer le fichier `hello.txt` à la racine du projet, conforme à `task.md`.
- Ne pas modifier d'autres fichiers que ceux nécessaires à la tâche.
- Ne pas effectuer de commit Git (politique: commit uniquement sur demande explicite du Manager).

## Tests à exécuter
- PowerShell (exemples recommandés):
  - `Get-Item hello.txt`
  - `Get-Content hello.txt`
- Inclure les commandes et un résumé de la sortie dans le résultat.

## Fichiers de communication
- ACK (prise en charge de la tâche):
  - `data/tasks/T-001_hello/dev_ack.json`
  - Contenu suggéré (libre mais au minimum):
    - `task_id`: `"T-001_hello"`
    - `agent`: `"developer_codex"`
    - `status`: `"ongoing"` ou `"accepted"`
    - `notes`: champ libre
- RESULT (preuve de réalisation):
  - `data/tasks/T-001_hello/dev_result.md` (ou `.json` si tu préfères)
  - Doit contenir:
    - résumé des modifications,
    - commandes de test exécutées + résultat,
    - éventuels points d'attention.
- Q/A:
  - Questions: `data/tasks/T-001_hello/questions/Q-*.md`
  - Réponses (par le Manager): `data/tasks/T-001_hello/answers/A-*.md`

## Definition of Done (vérification Manager)
- ACK présent (`dev_ack.json`) indiquant que la tâche a été prise en charge.
- `dev_result` fourni avec:
  - explication claire de ce qui a été fait,
  - preuve que `hello.txt` existe et est lisible,
  - preuves de tests (commandes + sorties principales).
- Aucun autre changement inattendu dans le projet.

