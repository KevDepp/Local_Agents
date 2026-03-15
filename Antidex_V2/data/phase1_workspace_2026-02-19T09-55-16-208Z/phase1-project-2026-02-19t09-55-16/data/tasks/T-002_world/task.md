# Task T-002_world — créer `world.txt`

## Résumé
- Créer un fichier `world.txt` à la racine du projet (le `cwd` Antidex).

## Contexte
- Cette tâche est la deuxième étape du mini-flux décrit dans `doc/SPEC.md`.
- Elle suppose que `hello.txt` a déjà été créé par T-001_hello.

## Exigences
- Créer un fichier texte nommé `world.txt` à la racine du projet.
- Le fichier doit être lisible en texte brut.
- Contenu libre, mais:
  - éviter un fichier vide (au moins une courte ligne, par exemple «world»).

## Definition of Done
- `world.txt` existe dans le répertoire racine du projet.
- Le fichier est lisible (aucune erreur lors de `Get-Content world.txt`).
- `hello.txt` (créé par T-001_hello) est toujours présent.
- Les preuves suivantes sont fournies dans `dev_result`:
  - commandes utilisées (par ex. `Get-Item world.txt`, `Get-Content world.txt`),
  - extraits pertinents de sortie montrant que le fichier existe.

## Tests attendus
- PowerShell (exemples):
  - `Get-Item world.txt`
  - `Get-Content world.txt`

## Dépendances
- Doit être exécutée après T-001_hello (qui crée `hello.txt`).

## Développeur assigné
- `developer_codex`

