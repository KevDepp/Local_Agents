# Manager Instruction — T-003_files

## Rôle ciblé
- Développeur: `developer_codex`

## Lecture préalable (obligatoire)
- Lis `agents/developer_codex.md` (vérifie la `version`).
- Relis `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md` pour le contexte global.

## Spécification de la tâche
- Contrat détaillé: `data/tasks/T-003_files/task.md`

## Travail demandé
- Créer `files.md` à la racine du projet conformément à `task.md`.
- Vérifier que `hello.txt` et `world.txt` existent avant de générer le contenu.
- Listes attendues:
  - au minimum, les noms `hello.txt` et `world.txt` dans le fichier (format libre, une ligne par fichier recommandé).
- Ne pas effectuer de commit Git.

## Tests à exécuter
- PowerShell (exemples recommandés):
  - `Get-Item files.md`
  - `Get-Content files.md`
  - `Select-String -Path files.md -Pattern 'hello.txt','world.txt'`

## Fichiers de communication
- ACK:
  - `data/tasks/T-003_files/dev_ack.json`
- RESULT:
  - `data/tasks/T-003_files/dev_result.md` (ou `.json`)
  - Inclure:
    - description des modifications,
    - commandes de test + résultats,
    - tout écart éventuel par rapport au plan.
- Q/A:
  - Questions: `data/tasks/T-003_files/questions/Q-*.md`
  - Réponses: `data/tasks/T-003_files/answers/A-*.md`

## Definition of Done (vérification Manager)
- ACK présent pour la tâche.
- Résultat documenté montrant que:
  - `files.md` existe,
  - `files.md` mentionne `hello.txt` et `world.txt`,
  - les deux fichiers sources existent toujours.
- Preuves de tests fournies (commandes + sorties principales).

