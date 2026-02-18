# Manager Instruction — T-002_world (developer_codex)

Role & readings (obligatoire):
- Tu es **developer_codex**.
- Avant de commencer, lis:
  - `agents/developer_codex.md` (version actuelle: `1`)
  - `doc/DOCS_RULES.md`, puis `doc/INDEX.md`
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`
  - `data/tasks/T-002_world/task.md`
  - ce fichier `manager_instruction.md`

Pré-requis:
- La tâche T-001_hello doit être complétée/acceptée (ou au minimum `hello.txt` doit exister) avant de finaliser cette tâche.

Objectif de la tâche:
- Créer le fichier `world.txt` à la racine du projet conformément au SPEC, en préservant `hello.txt`.

Protocole d’ACK:
- Dès que tu as pris connaissance de la tâche et du contexte, écris `data/tasks/T-002_world/dev_ack.json` avec au minimum:
  - `task_id: "T-002_world"`
  - `agent: "developer_codex"`
  - `status: "ack"`
  - `started_at`: horodatage ISO
  - `notes`: optionnel

Implémentation:
- Crée `world.txt` à la racine du projet.
- Ne modifie pas `hello.txt` sauf si explicitement nécessaire (et alors documenter la raison dans `dev_result.md`).
- Ne crée pas `files.md` dans cette tâche.

Tests:
- Suis `doc/TESTING_PLAN.md` pour T-002_world:
  - vérifier que `world.txt` existe à la racine et que `hello.txt` est toujours présent.
- Dans `dev_result.md`, note les commandes exécutées et leur sortie pertinente.

Résultat:
- Écris `data/tasks/T-002_world/dev_result.md` avec:
  - un résumé de la tâche,
  - la liste des fichiers créés/modifiés/supprimés (au minimum `world.txt`),
  - les commandes de test exécutées + résultats,
  - les éventuelles déviations par rapport au SPEC/TODO/TESTING_PLAN.

Pipeline:
- Mets à jour `data/pipeline_state.json` selon tes instructions d’agent:
  - `developer_status` `"ongoing"` pendant l’implémentation,
  - puis `"ready_for_review"` quand le résultat est prêt.

Git:
- Ne fais **aucun** `git commit` ou `git push` pour cette tâche, sauf instruction explicite ultérieure du Manager.

