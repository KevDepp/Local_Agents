# Decisions

- 2026-02-18: Création d'une mini-pipeline de trois tâches séquentielles (T-001_hello, T-002_world, T-003_files) pour démontrer le découpage et l'orchestration Antidex. Rationale: répondre à la demande utilisateur de créer `hello.txt`, puis `world.txt`, puis `files.md` qui les liste, tout en respectant le protocole de gestion de tâches (SPEC/TODO/TESTING_PLAN/pipeline_state).
- 2026-02-18: Passage en phase d'exécution pour T-001_hello (création de `hello.txt`) afin d'aligner la SPEC avec l'avancement réel de la tâche. Rationale: la tâche T-001 est lancée et nécessite la création du fichier.
