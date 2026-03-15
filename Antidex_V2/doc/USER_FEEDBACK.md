# User Feedback & Ideas — Antidex

Ce document rassemble les retours utilisateur, idées d'amélioration et suggestions qui nécessitent une investigation ou une décision avant d'être intégrés au `TODO.md` officiel.

## 1. UI & Visualisation (Ergonomie)
> *Feedback (2026-02-19)*: "l'UI de la fin de phase 1 n'est pas ok [...] je voudrais savoir on est où dasn les itération par rapport à ce qui est prévu. Je voudrais voir visuelleemnt qui travaille, en ce moment, manager, codex dev ou AG dev et à quel itération on est."

**Besoin**:
- Améliorer la visibilité de l'avancement global dans l'UI.
- Afficher clairement l'agent actif (Manager vs Codex vs AG).
- Visualiser la phase et l'itération en cours.

## 2. Verbosité & Qualité du découpage (Investigation)
> *Feedback (2026-02-19)*: "en regardant les fichiers rollout, je vois beaucoup, d'information [...] est ce que ces information ne noien pas l'agent. [...] Aussi je voudrais que l'on lise ce que le manager a fait [...] est ce que la division du travail par le manager était bonne"

**Actions à prévoir**:
- **Audit verbosité**: Analyser si les logs/contextes fournis aux agents sont trop verbeux et risquent de diluer l'attention ("perte de concentration").
- **Audit qualité découpage**: Vérifier la pertinence du découpage des tâches par le Manager (ni trop gros pour un seul tour, ni trop petit artificiellement).

## 3. Agent "Observer" ✅ Intégré dans les specs officielles
> *Intégré dans `doc/SPEC.md` (section 12) + `doc/IMPLEMENTATION_ROADMAP.md` (Phase 4) + `doc/TODO.md` (P2) le 2026-02-20.*
>
> *Feedback original (2026-02-19)*: "est ce que l'on pourrait dans une phase 4 du projet, prévoir un nouvel agent qui peut tourner en même temps [...] et qui n'écrit pas mais qui informe de l'état d'avancement. il faudrais une petite fenêtre pour lui écrire un message"

**Concept**:
- Un agent "Observer" dédié, en lecture seule (accès aux logs/états).
- Tourne en parallèle du process principal.
- Capable de répondre à des questions de statut ("Où en est-on ?") via une fenêtre de chat dédiée, sans perturber le run en cours.
