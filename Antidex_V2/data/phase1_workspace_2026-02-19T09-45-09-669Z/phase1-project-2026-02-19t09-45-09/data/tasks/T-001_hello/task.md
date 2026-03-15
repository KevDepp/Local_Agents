# Task T-001_hello — Créer `hello.txt`

Role: developer_codex

Context:
- Le projet suit un workflow simple où trois fichiers doivent être créés séquentiellement.
- Cette première tâche se concentre uniquement sur la création du fichier `hello.txt` à la racine du projet.

Objective:
- Créer le fichier `hello.txt` (sans autre fichier) selon les exigences ci-dessous.

Requirements:
- Créer un fichier `hello.txt` à la racine du projet (même dossier que `doc/`, `agents/`, `data/`).
- Le Manager ne prescrit pas ici le contenu exact, mais le contenu doit être:
  - lisible par un humain,
  - cohérent avec le nom du fichier (par exemple un message simple qui contient le mot « hello »),
  - stable et déterministe (pas de contenu dépendant de l’horloge ou de l’environnement).
- Ne pas créer `world.txt` ni `files.md` dans cette tâche (ils appartiennent à d’autres tâches).

Out of scope:
- Toute logique applicative autre que la création de ce fichier.
- Création/modification de `world.txt` ou `files.md`.

Definition of Done:
- `hello.txt` existe à la racine du projet.
- Le contenu de `hello.txt` est simple, déterministe et contient au moins le mot « hello ».
- Les commandes utilisées pour créer/vérifier le fichier sont documentées dans `data/tasks/T-001_hello/dev_result.md` (ou `.json`).
- Les tests manuels ou automatisés pertinents (par exemple `Get-Content hello.txt`) sont décrits avec leur sortie.
- Aucune modification non nécessaire n’est apportée à d’autres fichiers que ceux requis par cette tâche.

Notes:
- Lire `agents/developer_codex.md` avant de commencer.
- Se conformer à `doc/GIT_WORKFLOW.md` (pas de commit sans instruction explicite du Manager).

