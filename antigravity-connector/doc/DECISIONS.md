# DECISIONS - antigravity-connector

## 2026-02-08 - CDP comme mecanisme fiable

Decision:
- Utiliser CDP pour injecter et submit dans le panneau agent (Lexical) au lieu de `antigravity.sendTextToChat` / `type`.

Rationale:
- Les commandes `antigravity.*` sont non fiables pour "texte brut + submit" sur certaines builds.
- CDP permet de piloter l'UI WebView directement.

Impact:
- Requiert `--remote-debugging-port` au lancement Antigravity.

## 2026-02-08 - Verification post-submit

Decision:
- Considerer `/send` comme reussi seulement si un "needle" (prefix du prompt) est observe dans le DOM du panneau agent apres submit.

Rationale:
- Eviter les faux positifs (logs "Injection OK" alors que l'utilisateur ne voit rien).

Impact:
- `/send` peut retourner `503` meme si l'injection a ete tentee (si verification echoue).

## 2026-02-14 - Submit robuste avec attente + verification locale

Decision:
- Ajouter une attente courte pour que le bouton Send devienne enabled.
- Apres click, verifier que le champ prompt est vide (ou qu'un message est ajoute).
- Si echec, tenter Enter/Ctrl+Enter puis un 2e click.

Rationale:
- Le click immediat sur un bouton encore disabled est ignore.
- Le symptome "2e click envoie le message precedent" indique un timing/etat React non synchronise.

Impact:
- /send est plus deterministe (un seul click requis).
