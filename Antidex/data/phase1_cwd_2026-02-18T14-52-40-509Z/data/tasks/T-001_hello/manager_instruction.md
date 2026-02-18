# Manager Instruction — T-001_hello (developer_codex)

Role & readings (obligatoire):
- Tu es **developer_codex**.
- Avant de commencer, lis:
  - `agents/developer_codex.md` (version actuelle: `1`)
  - `doc/DOCS_RULES.md`, puis `doc/INDEX.md`
  - `doc/SPEC.md`, `doc/TODO.md`, `doc/TESTING_PLAN.md`, `doc/DECISIONS.md`
  - `data/tasks/T-001_hello/task.md` (ce fichier décrit la tâche fonctionnelle)
  - ce fichier `manager_instruction.md`

Objectif de la tâche:
- Implémenter la tâche T-001_hello en créant le fichier `hello.txt` à la racine du projet, conformément au SPEC.
- Ne pas créer ni modifier `world.txt` ou `files.md` dans cette tâche.

Protocole d’ACK:
- Dès que tu as pris connaissance de la tâche et du contexte, écris `data/tasks/T-001_hello/dev_ack.json` avec au minimum:
  - `task_id: "T-001_hello"`
  - `agent: "developer_codex"`
  - `status: "ack"`
  - `started_at`: horodatage ISO
  - `notes`: optionnel

Implémentation:
- Crée `hello.txt` à la racine du projet (contenu libre, cohérent avec le SPEC).
- Limite les modifications à ce qui est nécessaire pour cette tâche.

Tests:
- Suis `doc/TESTING_PLAN.md` pour T-001_hello:
  - vérifier que `hello.txt` existe à la racine (ex: `Test-Path ./hello.txt`).
- Dans `dev_result.md`, note les commandes exécutées et leur sortie pertinente.

Résultat:
- Écris `data/tasks/T-001_hello/dev_result.md` avec:
  - un résumé de la tâche,
  - la liste des fichiers créés/modifiés/supprimés (au minimum `hello.txt`),
  - les commandes de test exécutées + résultats,
  - toute déviation par rapport au SPEC/TODO/TESTING_PLAN (avec justification).

Pipeline:
- Mets à jour `data/pipeline_state.json` selon tes instructions d’agent:
  - `developer_status` devrait passer à `"ongoing"` pendant l’implémentation,
  - puis à `"ready_for_review"` une fois le résultat prêt.

Git:
- Ne fais **aucun** `git commit` ou `git push` pour cette tâche, sauf instruction explicite ultérieure du Manager.

