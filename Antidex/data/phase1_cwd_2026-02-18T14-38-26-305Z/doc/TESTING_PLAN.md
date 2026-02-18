# Testing Plan

Objectif général:
- Vérifier que chaque tâche de la mini-pipeline produit les fichiers attendus et que `files.md` agrège correctement les résultats.

Préconditions:
- Le projet est dans l'état initial décrit par la SPEC.
- Les tâches sont exécutées dans l'ordre: T-001_hello, T-002_world, T-003_files.

Checklist (par tâche):
- [ ] T-001_hello:
  - [ ] Le fichier `hello.txt` existe à la racine du projet (ou à l'emplacement spécifié dans la tâche).
  - [ ] Le fichier contient au minimum une ligne de texte non vide (le contenu exact n'est pas imposé pour cette démo).
- [ ] T-002_world:
  - [ ] Le fichier `world.txt` existe.
  - [ ] Le fichier contient au minimum une ligne de texte non vide.
- [ ] T-003_files:
  - [ ] Le fichier `files.md` existe.
  - [ ] `files.md` contient une liste de fichiers incluant au moins:
    - [ ] une ligne mentionnant `hello.txt`,
    - [ ] une ligne mentionnant `world.txt`.
  - [ ] Optionnel: chaque fichier listé est vérifié comme présent sur le disque.

Preuves attendues par développeur:
- Commandes exécutées (ex: `ls`, `cat files.md` ou équivalent) et leur sortie dans `dev_result`.
- Indication explicite de la checklist cochée (par exemple dans `dev_result.md` ou `dev_result.json`).
