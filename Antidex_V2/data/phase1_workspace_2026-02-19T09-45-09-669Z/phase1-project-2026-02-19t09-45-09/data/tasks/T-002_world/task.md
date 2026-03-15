# Task T-002_world — Créer `world.txt`

Role: developer_codex

Context:
- La tâche T-001_hello a pour but de créer `hello.txt`.
- Cette tâche se concentre uniquement sur la création du fichier `world.txt` à la racine du projet.

Objective:
- Créer le fichier `world.txt` (sans toucher à `hello.txt` ni à `files.md`).

Requirements:
- Créer un fichier `world.txt` à la racine du projet.
- Le contenu doit être:
  - lisible par un humain,
  - cohérent avec le nom du fichier (par exemple un message simple qui contient le mot « world »),
  - stable et déterministe.
- Ne pas modifier le comportement ou le contenu de `hello.txt`.
- Ne pas créer ou modifier `files.md` (qui appartient à T-003_files).

Out of scope:
- Toute logique applicative autre que la création de ce fichier.
- Création/modification de `files.md`.

Definition of Done:
- `world.txt` existe à la racine du projet.
- Le contenu de `world.txt` est simple, déterministe et contient au moins le mot « world ».
- Les commandes utilisées pour créer/vérifier le fichier sont documentées dans `data/tasks/T-002_world/dev_result.md` (ou `.json`).
- Les tests manuels ou automatisés pertinents (par exemple `Get-Content world.txt`) sont décrits avec leur sortie.
- `hello.txt` reste présent et inchangé par rapport à la tâche précédente.

Notes:
- Lire `agents/developer_codex.md` avant de commencer.
- Se conformer à `doc/GIT_WORKFLOW.md`.

