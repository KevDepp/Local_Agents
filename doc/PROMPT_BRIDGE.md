# Prompt Bridge (extension VS Code / Antigravity)

## Objectif
Une même extension installée **dans VS Code** et **dans Antigravity** (fork VS Code) expose un endpoint local:
- `POST http://127.0.0.1:<port>/send`

Chaque application reçoit le prompt et tente de l'envoyer au chat via des `command IDs` (si disponibles), sinon via fallback:
1. ouvrir la sidebar (ex: `chatgpt.openSidebar`)
2. tenter de focus une vue (best-effort)
3. `type` du texte (+ `\n` si auto-send)

## Limites connues
- Une extension VS Code ne peut pas piloter une autre application. Pour envoyer au chat des **deux** apps, il faut installer l’extension dans **les deux**, et utiliser **deux ports différents** (sinon collision).
- Côté Codex (extension OpenAI), le focus de l’input peut être instable (WebView). En pratique, le fallback “type” dépend fortement du focus courant.
- Si Antigravity expose une commande interne type `antigravity.sendTextToChat`, on la tente, mais sa signature peut varier selon versions.

## Installation (dev)
Dans `Local_Agents/prompt-bridge/` :
```powershell
npm install
npm run compile
```

## Chemin “minimum de manipulations”
Depuis PowerShell :
```powershell
.\Local_Agents\prompt-bridge\scripts\quickstart.ps1
```
Ça fait (si nécessaire) `npm install`, `npm run compile`, met `promptBridge.port` dans `Local_Agents/prompt-bridge/.vscode/settings.json`, puis lance un **Extension Development Host**.

Ensuite, dans un autre terminal :
```powershell
.\Local_Agents\prompt-bridge\scripts\selftest.ps1
```

Dans VS Code / Antigravity :
- Ouvrir le dossier `Local_Agents/prompt-bridge/`
- `F5` (Run Extension) pour lancer une instance de dev

Si le `preLaunchTask` échoue avec une erreur PowerShell liée à un `Activate.ps1`, c’est généralement que ton profil de terminal est “détourné” (ex: il pointe vers un venv). Le task `compile` est configuré en mode `process` pour éviter ça, mais tu peux toujours compiler manuellement :
```powershell
npm run compile
```

## Configuration
Réglages dans Settings (JSON) :
- `promptBridge.port` : port HTTP local (ex: 17373). Mettre **un autre port** dans l'autre app (ex: 17374).
- `promptBridge.token` : secret optionnel (Bearer).
- `promptBridge.autoSend` : si `true`, ajoute `\n` à la fin.

## Endpoints
- `GET /health` : info basique (appName, pid).
- `GET /commands?filter=chatgpt` : liste des commandes qui matchent.
- `POST /send` : `{ "prompt": "...", "target": "codex" | "antigravity" | "auto" }`

## Test rapide (PowerShell)
```powershell
$body = @{ prompt = "Hello from Prompt Bridge"; target = "auto" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:17373/send" -Body $body -ContentType "application/json"
```

Scripts fournis :
- envoyer à un port : `Local_Agents/prompt-bridge/scripts/send.ps1`
- envoyer à deux ports (VS Code + Antigravity) : `Local_Agents/prompt-bridge/scripts/broadcast.ps1`

## Ce qui manque (selon moi)
- Un mécanisme 100% fiable “focus input Codex” via commande publique.
- Un mapping confirmé des `command IDs` d’Antigravity + signatures (selon ta version).
- (Optionnel) durcir la sécurité (TLS/local-only, allowlist IP, etc.) si tu veux autre chose qu’un POC local.
