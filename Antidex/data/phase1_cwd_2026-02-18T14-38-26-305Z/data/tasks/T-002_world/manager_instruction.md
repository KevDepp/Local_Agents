# Manager Instruction — T-002_world

Role: Developer Codex (`developer_codex`)

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md` (et vérifie le champ `version`),
  - `agents/manager.md` (pour le contexte global si nécessaire).
- Lis la SPEC et le backlog:
  - `doc/SPEC.md`
  - `doc/TODO.md`
  - `doc/TESTING_PLAN.md`
  - `doc/DECISIONS.md`.
- Lis les fichiers de tâche:
  - `data/tasks/T-002_world/task.md`

## Objectif de la tâche
- Implémenter la création de `world.txt` conformément à:
  - `data/tasks/T-002_world/task.md`
  - `doc/TESTING_PLAN.md` (section T-002_world).

## Règles d'I/O pour cette tâche
- ACK:
  - Écris un fichier `data/tasks/T-002_world/dev_ack.json` contenant au minimum:
    - `{\"developer\": \"developer_codex\", \"task_id\": \"T-002_world\", \"acknowledged_at\": \"<ISO8601>\", \"notes\": \"...\"}`.
- RESULT:
  - Écris un fichier `data/tasks/T-002_world/dev_result.md` ou `dev_result.json` contenant:
    - Un résumé des changements réalisés.
    - La liste des fichiers modifiés/créés.
    - Les commandes de test exécutées et leurs sorties.
    - Une indication explicite si tu considères la Definition of Done comme remplie.
- Q/A:
  - Si tu es bloqué, crée un fichier `data/tasks/T-002_world/questions/Q-001.md` décrivant le problème.
  - Le Manager répondra via `data/tasks/T-002_world/answers/A-001.md`.

## Tests attendus
- Vérifie au minimum:
  - Que `world.txt` existe.
  - Que son contenu est non vide.
- Fournis dans `dev_result`:
  - Les commandes exécutées (ex: `ls`, `cat world.txt` ou équivalent).
  - La sortie de ces commandes.

## Rappels Git
- Ne fais **aucun commit** pour cette tâche tant que le Manager ne l'a pas explicitement demandé après revue.
- Réfère-toi à `doc/GIT_WORKFLOW.md` pour la politique complète.

## Critère de complétude côté développeur
- Quand tu estimes la tâche terminée et testée, mets à jour `dev_result` avec un statut clair (ex: \"DONE, ready for review\") et assure-toi que toutes les preuves demandées y figurent.

