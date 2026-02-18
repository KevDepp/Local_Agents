# TODO - antigravity-connector

Date: 2026-02-08

- `[ ] P0 (Codex) Ajouter option body.debug pour exposer target/verify/details dans la reponse /send.`
- `[x] P0 (Codex) Stabiliser le submit CDP: attendre bouton enabled, verifier envoi (champ vide), fallback Enter/Ctrl+Enter et 2e click si besoin. (preuve: Local_Agents/antigravity-connector/src/cdp/injectedScript.ts)`
- `[ ] P1 (Codex) Ajouter endpoint `/sendRaw` (CDP only, sans heuristiques) pour debug.`
- `[ ] P1 (Both) Clarifier la capacite "ecriture fichiers" (permissions/outils) et documenter un test fiable.`
- `[ ] P2 (Codex) Packager proprement la VSIX avec `ws` inclus (eviter hotfix manuel dans `.antigravity/extensions`).`
