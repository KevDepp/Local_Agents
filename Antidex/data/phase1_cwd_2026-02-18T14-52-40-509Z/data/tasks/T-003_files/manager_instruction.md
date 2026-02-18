# Manager Instruction — T-003_files (developer_codex)

Role & readings (obligatoire):
- Tu es **developer_codex**.
- Avant de commencer, lis:
  - `agents/developer_codex.md` (version actuelle: `1`)
  - `doc/DOCS_RULES.md`, puis `doc/INDEX.md`
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`
  - `data/tasks/T-003_files/task.md`
  - ce fichier `manager_instruction.md`

Pré-requis:
- Les tâches T-001_hello et T-002_world doivent être complétées/acceptées (ou au minimum `hello.txt` et `world.txt` doivent exister) avant de finaliser cette tâche.

Objectif de la tâche:
- Créer le fichier `files.md` à la racine du projet, listant clairement `hello.txt` et `world.txt` conformément au SPEC.

Protocole d’ACK:
- Dès que tu as pris connaissance de la tâche et du contexte, écris `data/tasks/T-003_files/dev_ack.json` avec au minimum:
  - `task_id: "T-003_files"`
  - `agent: "developer_codex"`
  - `status: "ack"`
  - `started_at`: horodatage ISO
  - `notes`: optionnel

Implémentation:
- Crée `files.md` à la racine du projet.
- Le contenu doit mentionner au moins une fois `hello.txt` et `world.txt`, idéalement sous forme de liste à puces et dans l’ordre `hello.txt` puis `world.txt`.
- Ne modifie pas `hello.txt` ni `world.txt` sauf nécessité documentée.

Tests:
- Suis `doc/TESTING_PLAN.md` pour T-003_files:
  - vérifier que `files.md` existe à la racine et qu’il contient au moins une occurrence de `hello.txt` et une occurrence de `world.txt`.
- Dans `dev_result.md`, note les commandes exécutées et leur sortie pertinente.

Résultat:
- Écris `data/tasks/T-003_files/dev_result.md` avec:
  - un résumé de la tâche,
  - la liste des fichiers créés/modifiés/supprimés (au minimum `files.md`),
  - les commandes de test exécutées + résultats,
  - les éventuelles déviations par rapport au SPEC/TODO/TESTING_PLAN.

Pipeline:
- Mets à jour `data/pipeline_state.json` selon tes instructions d’agent:
  - `developer_status` `"ongoing"` pendant l’implémentation,
  - puis `"ready_for_review"` quand le résultat est prêt.

Git:
- Ne fais **aucun** `git commit` ou `git push` pour cette tâche, sauf instruction explicite ultérieure du Manager.

