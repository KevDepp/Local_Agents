# Manager Instruction — T-001_hello

Rôle cible: `developer_codex`

## Avant de commencer
- Lis attentivement:
  - `agents/developer_codex.md` (vérifie le champ `version`),
  - `agents/AG_cursorrules.md` si pertinent pour les outils,
  - `doc/SPEC.md`,
  - `doc/TODO.md`,
  - `doc/TESTING_PLAN.md`,
  - `doc/DECISIONS.md`.

## Tâche
- Implémente la tâche décrite dans `data/tasks/T-001_hello/task.md`:
  - création du fichier `hello.txt` à la racine du projet,
  - contenu simple mais cohérent (texte lisible, non vide, en lien avec "hello").

## ACK / RESULT / Q-A
- ACK (prise en charge de la tâche):
  - écris un fichier `data/tasks/T-001_hello/dev_ack.json` contenant au minimum:
    - `{ "developer": "developer_codex", "status": "started", "updated_at": "<ISO8601>" }`.
- RESULT:
  - écris le résultat principal dans `data/tasks/T-001_hello/dev_result.md` (ou `.json` si tu préfères), incluant:
    - les fichiers créés/modifiés,
    - le contenu ou un extrait de `hello.txt`,
    - les commandes/tests exécutés (avec sortie résumée),
    - tout problème ou limitation rencontrée.
- Q/A:
  - si tu es bloqué, crée un fichier `data/tasks/T-001_hello/questions/Q-001.md` décrivant la question,
  - mets `developer_status` à `"blocked"` dans `data/pipeline_state.json` (via l’orchestrateur),
  - j’y répondrai dans `data/tasks/T-001_hello/answers/A-001.md`.

## Tests à exécuter
- Applique les vérifications pertinentes du `doc/TESTING_PLAN.md` pour T-001_hello, par exemple:
  - vérifier l’existence de `hello.txt`,
  - vérifier que le contenu est non vide et lisible.

## Attentes de qualité
- Intervention minimale et ciblée: ne modifie que ce qui est nécessaire pour cette tâche.
- Garde le dépôt propre (pas de fichiers temporaires laissés dans le repo).

