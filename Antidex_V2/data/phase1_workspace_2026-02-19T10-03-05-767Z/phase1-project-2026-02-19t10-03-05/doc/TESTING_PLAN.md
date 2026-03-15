# Testing Plan

Checklist:
- [ ] T-001_hello: après exécution de la tâche, vérifier que `hello.txt` existe à la racine du projet et que son contenu est exactement `hello` suivi d'un saut de ligne (via `Get-Content hello.txt` ou équivalent).
- [ ] T-002_world: après exécution de la tâche, vérifier que `world.txt` existe à la racine du projet et que son contenu est exactement `world` suivi d'un saut de ligne.
- [ ] T-003_files: après exécution de la tâche, vérifier que `files.md` existe à la racine du projet et qu'il contient deux lignes: `hello.txt` puis `world.txt` (aucune autre ligne).
- [ ] Vérifier que l'ordre d'exécution 1→2→3 est respecté dans les preuves de la tâche (par exemple en mentionnant la dépendance dans les résultats ou en vérifiant que `files.md` n'est créé qu'après les deux fichiers texte).
