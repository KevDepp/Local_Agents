# RPA Chat (Robot Framework + RPA Framework)

## Objectif
Automatiser (attended) :
1) activer la fenêtre cible (VS Code / Antigravity)
2) amener le focus dans le champ de chat (par raccourci OU clic)
3) coller le prompt
4) `Enter`

## Installation
Dans `Local_Agents/rpa-chat/` :
```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Exécution
Mettre les apps ouvertes (VS Code + Antigravity), puis :
```powershell
robot -d output send_to_chats.robot
```

Ou via le script (création venv + install + run) :
```powershell
.\run.ps1 -Prompt "hello"
```

## Notes importantes
- Pour un POC robuste, le focus “tout clavier” est idéal (keybinding qui met le caret dans l’input).
- Si le focus n’est pas fiable (Codex WebView), utiliser la variante “clic” (image/UIA) avant paste.

## Définition de “OK” pour ce POC
- Le message apparaît dans le thread (donc Enter a bien envoyé).
