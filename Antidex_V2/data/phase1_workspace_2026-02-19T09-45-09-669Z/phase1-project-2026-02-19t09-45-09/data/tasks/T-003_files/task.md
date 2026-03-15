# Task T-003_files — Créer `files.md` listant `hello.txt` et `world.txt`

Role: developer_codex

Context:
- Les tâches T-001_hello et T-002_world créent respectivement `hello.txt` et `world.txt`.
- Cette tâche se concentre sur la création d’un fichier de synthèse `files.md`.

Objective:
- Créer `files.md` qui liste clairement les fichiers `hello.txt` et `world.txt`.

Requirements:
- Créer un fichier `files.md` à la racine du projet.
- Le fichier doit être en Markdown et contenir au minimum:
  - un titre explicite (par ex. « Fichiers créés »),
  - une liste (puces ou numérotation) mentionnant `hello.txt` et `world.txt`.
- Optionnel: vous pouvez ajouter une courte description textuelle pour chaque fichier.
- Ne pas modifier le contenu de `hello.txt` ni de `world.txt`.

Out of scope:
- Toute autre documentation non nécessaire à cette synthèse.

Definition of Done:
- `files.md` existe à la racine du projet.
- `files.md` liste explicitement `hello.txt` et `world.txt` dans une section lisible.
- Les commandes utilisées pour créer/vérifier le fichier sont documentées dans `data/tasks/T-003_files/dev_result.md` (ou `.json`).
- Les tests manuels ou automatisés pertinents (par exemple `Get-Content files.md`) sont décrits avec leur sortie.
- `hello.txt` et `world.txt` restent présents et cohérents avec les tâches précédentes.

Notes:
- Lire `agents/developer_codex.md` avant de commencer.
- Se conformer à `doc/GIT_WORKFLOW.md`.

