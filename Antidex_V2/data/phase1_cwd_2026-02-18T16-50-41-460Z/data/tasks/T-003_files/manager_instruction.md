# Manager Instruction — T-003_files

Role: Developer Codex (`developer_codex`).

## Instructions
- Lire avant tout:
  - `agents/developer_codex.md` (et vérifier la `version`).
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`.
- Tenir compte de l'ordre d'exécution défini dans `doc/TODO.md` (cette tâche est Order 3, après `T-001_hello` et `T-002_world`).

## Scope de la tâche
- Créer/mettre à jour `files.md` pour lister au moins `hello.txt` et `world.txt`.
- Ne pas supprimer ni modifier de manière destructive `hello.txt` ou `world.txt`.
- Laisser la structure générale du projet intacte.

## Preuves et tests attendus
- Commandes suggérées:
  - `ls` ou `dir` pour montrer `hello.txt`, `world.txt` et `files.md`.
  - `Get-Content files.md` (ou équivalent) pour montrer que les deux noms de fichiers sont bien présents.
  - Éventuellement `Select-String -Path ./files.md -Pattern 'hello.txt','world.txt'`.
- Reporter ces preuves dans `dev_result`.

## Emplacement des fichiers d'échange
- ACK: écrire `data/tasks/T-003_files/dev_ack.json`.
- RESULT: écrire `data/tasks/T-003_files/dev_result.md` (et/ou `.json`).
- Q/A:
  - Questions: `data/tasks/T-003_files/questions/Q-*.md`
  - Réponses: `data/tasks/T-003_files/answers/A-*.md`

