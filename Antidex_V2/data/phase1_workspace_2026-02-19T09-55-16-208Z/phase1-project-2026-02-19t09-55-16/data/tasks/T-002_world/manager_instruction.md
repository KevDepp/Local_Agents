# Manager Instruction — T-002_world

## Rôle ciblé
- Développeur: `developer_codex`

## Lecture préalable (obligatoire)
- Lis `agents/developer_codex.md` (vérifie la `version` en tête de fichier).
- Parcours `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md` pour le contexte.

## Spécification de la tâche
- Contrat détaillé: `data/tasks/T-002_world/task.md`

## Travail demandé
- Créer le fichier `world.txt` à la racine du projet, conforme à `task.md`.
- Vérifier que `hello.txt` (créé par T-001_hello) est toujours présent.
- Ne pas modifier d'autres fichiers que ceux nécessaires à la tâche.
- Ne pas effectuer de commit Git.

## Tests à exécuter
- PowerShell (exemples recommandés):
  - `Get-Item world.txt`
  - `Get-Content world.txt`
- Vérifier également que `hello.txt` existe toujours:
  - `Get-Item hello.txt`

## Fichiers de communication
- ACK:
  - `data/tasks/T-002_world/dev_ack.json`
- RESULT:
  - `data/tasks/T-002_world/dev_result.md` (ou `.json`)
  - Inclure:
    - résumé des modifications,
    - commandes de test exécutées + résultat,
    - éventuels problèmes rencontrés.
- Q/A:
  - Questions: `data/tasks/T-002_world/questions/Q-*.md`
  - Réponses: `data/tasks/T-002_world/answers/A-*.md`

## Definition of Done (vérification Manager)
- ACK présent pour la tâche.
- Résultat documenté avec:
  - preuve de création de `world.txt`,
  - confirmation de la persistance de `hello.txt`,
  - preuves de tests.
- Aucun changement inattendu dans le reste du projet.

