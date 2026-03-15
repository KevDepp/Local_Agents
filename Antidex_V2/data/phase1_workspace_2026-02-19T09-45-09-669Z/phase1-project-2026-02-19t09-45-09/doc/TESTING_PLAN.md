# Testing Plan

Checklist:
- [ ] Vérifier que `hello.txt` est créé à la racine du projet après la tâche `T-001_hello` et que son contenu correspond à la spécification de la tâche.
- [ ] Vérifier que `world.txt` est créé à la racine du projet après la tâche `T-002_world` et que son contenu correspond à la spécification de la tâche.
- [ ] Vérifier que `files.md` est créé après la tâche `T-003_files` et qu’il contient une liste (titres ou puces) mentionnant au minimum `hello.txt` et `world.txt`.
- [ ] Vérifier que les trois tâches sont exécutées dans l’ordre 1 → 2 → 3 (par exemple via l’historique des tâches dans `data/tasks/` et les timestamps/DECISIONS).
- [ ] Vérifier que chaque tâche inclut des preuves de test (commandes exécutées, sorties pertinentes) dans `data/tasks/T-xxx_*/dev_result.*`.
