# Task T-003_files — créer `files.md`

## Résumé
- Créer un fichier `files.md` à la racine du projet listant `hello.txt` et `world.txt`.

## Contexte
- Cette tâche est la troisième étape du mini-flux décrit dans `doc/SPEC.md`.
- Elle suppose que:
  - `hello.txt` a été créé par T-001_hello,
  - `world.txt` a été créé par T-002_world.

## Exigences
- Créer un fichier texte/Markdown nommé `files.md` à la racine du projet.
- `files.md` doit au minimum mentionner `hello.txt` et `world.txt`.
- Format recommandé (mais non obligatoire):
  - une ligne par fichier, par exemple:
    - `hello.txt`
    - `world.txt`

## Definition of Done
- `files.md` existe dans le répertoire racine du projet.
- `files.md` mentionne `hello.txt` et `world.txt` (les deux noms apparaissent dans le contenu).
- `hello.txt` et `world.txt` existent toujours dans le projet.
- Les preuves suivantes sont fournies dans `dev_result`:
  - commandes utilisées (par ex. `Get-Item files.md`, `Get-Content files.md`),
  - preuve que les deux noms sont bien présents dans le fichier.

## Tests attendus
- PowerShell (exemples):
  - `Get-Item files.md`
  - `Get-Content files.md`
  - `Select-String -Path files.md -Pattern 'hello.txt','world.txt'`

## Dépendances
- Doit être exécutée après:
  - T-001_hello (création de `hello.txt`),
  - T-002_world (création de `world.txt`).

## Développeur assigné
- `developer_codex`

