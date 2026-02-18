# SPEC

Context:
- L'utilisateur veut une séquence de trois tâches distinctes pour gérer des fichiers au niveau du projet courant.
- Les tâches sont, dans l'ordre: `T-001_hello` (créer `hello.txt`), `T-002_world` (créer `world.txt`), `T-003_files` (créer `files.md` listant les deux fichiers précédents).
- Le Manager prépare le découpage et le pipeline, puis assigne ces tâches à `developer_codex` via `data/tasks/T-xxx_<slug>/`.

Acceptance criteria:
- Après exécution de `T-001_hello`, le fichier `hello.txt` existe à la racine du projet (ou dans l'emplacement défini par la tâche) et les preuves d'exécution sont fournies dans `data/tasks/T-001_hello/`.
- Après exécution de `T-002_world`, le fichier `world.txt` existe au même niveau que `hello.txt` et les preuves d'exécution sont fournies dans `data/tasks/T-002_world/`.
- Après exécution de `T-003_files`, le fichier `files.md` existe et contient une liste mentionnant au minimum `hello.txt` et `world.txt` (format libre: lignes simples ou bullet list).
- Pour chaque tâche, le développeur fournit un résultat (`dev_result`), les commandes utilisées et, si possible, une courte vérification manuelle (ex: affichage du contenu de `files.md`).
