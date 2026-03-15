# Decisions

- YYYY-MM-DD: (decision) (rationale)
- 2026-02-19: Décomposer la demande utilisateur en trois tâches séquentielles `T-001_hello`, `T-002_world`, `T-003_files` avec exécution dans cet ordre et assignment à `developer_codex`; préciser dans la SPEC/TESTING_PLAN que `hello.txt` et `world.txt` contiennent respectivement `hello` et `world`, et que `files.md` liste ces deux noms, un par ligne, pour lever toute ambiguïté et faciliter les tests. (rationale: clarifier le contenu attendu des fichiers et garantir des critères de test objectifs pour ce run minimal)
