# Decisions

- 2026-02-19: Défini un mini-flux séquentiel en trois tâches T-001_hello, T-002_world et T-003_files pour créer `hello.txt`, puis `world.txt`, puis `files.md` listant les deux fichiers; chaque tâche sera exécutée par `developer_codex` avec ordre explicite 1 → 2 → 3 dans `doc/TODO.md`. (rationale: correspondre exactement à la demande utilisateur tout en illustrant le pipeline Antidex par des tâches simples et indépendamment testables)
