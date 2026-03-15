# SPEC

Context:
- Mini-projet de démonstration pour le pipeline Antidex sur ce `project_cwd`.
- L'utilisateur souhaite trois étapes séquentielles:
  1) créer `hello.txt`,
  2) créer `world.txt`,
  3) créer `files.md` listant `hello.txt` et `world.txt`.

Status (2026-02-19):
- T-001_hello en cours (cr?ation de `hello.txt`).

Vue d'ensemble du workflow:
- T-001_hello : création de `hello.txt` à la racine du projet.
- T-002_world : création de `world.txt` à la racine du projet.
- T-003_files : création de `files.md` à la racine du projet listant les deux fichiers précédents.

Hypothèses:
- Les fichiers sont créés dans le répertoire racine du projet (le `cwd` utilisé par Antidex).
- Aucun contenu particulier n'est imposé pour `hello.txt` et `world.txt` au-delà de leur existence (contenu libre mais non vide recommandé).
- `files.md` doit au minimum contenir les noms `hello.txt` et `world.txt` (une ligne par fichier ou format équivalent simple).

Acceptance criteria:
- Après T-001_hello :
  - `hello.txt` existe dans le `cwd`.
- Après T-002_world :
  - `world.txt` existe dans le `cwd`.
- Après T-003_files :
  - `files.md` existe dans le `cwd`.
  - `files.md` mentionne à la fois `hello.txt` et `world.txt`.
- Les tâches sont exécutées dans l'ordre 1 → 2 → 3 et sont toutes tracées dans `data/tasks/T-xxx_<slug>/`.
