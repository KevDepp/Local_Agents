# Task T-001_hello — créer `hello.txt`

## Résumé
- Créer un fichier `hello.txt` à la racine du projet (le `cwd` Antidex).

## Contexte
- Cette tâche est la première étape du mini-flux décrit dans `doc/SPEC.md` et planifié dans `doc/TODO.md`.
- Elle prépare la suite: `world.txt` (T-002_world) puis `files.md` (T-003_files).

## Exigences
- Créer un fichier texte nommé `hello.txt` à la racine du projet.
- Le fichier doit être lisible en texte brut.
- Contenu libre, mais:
  - éviter un fichier vide (au moins une courte ligne, par exemple «hello»).

## Definition of Done
- `hello.txt` existe dans le répertoire racine du projet.
- Le fichier est lisible (aucune erreur lors de `Get-Content hello.txt`).
- La tâche ne crée pas d'autres fichiers inattendus.
- Les preuves suivantes sont fournies dans `dev_result`:
  - commandes utilisées (par ex. `Get-Item hello.txt`, `Get-Content hello.txt`),
  - extraits pertinents de sortie montrant que le fichier existe.

## Tests attendus
- PowerShell (exemples):
  - `Get-Item hello.txt`
  - `Get-Content hello.txt`

## Dépendances
- Aucune (première tâche de la séquence).

## Développeur assigné
- `developer_codex`

