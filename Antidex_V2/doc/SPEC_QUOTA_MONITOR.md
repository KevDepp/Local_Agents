# SPEC — Extension `antigravity-quota-monitor`

> **Statut**: Draft  
> **Owner**: Developer Antigravity (création du repo GitHub) + Developer Codex (implémentation)  
> **Liée à**: `SPEC.md` §14 (Protocole GitHub + Lovable)  
> **Emplacement cible de l'extension**: `Local_Agents/antigravity-quota-monitor/`

---

## 1) Objectif

Créer une extension VS Code séparée (`antigravity-quota-monitor`) qui affiche dans la **status bar** le **quota restant** de deux modèles d'IA:

- **Gemini 3.1** (`gemini-3-5-pro-exp-03-25` ou équivalent)
- **Sonnet 4.6** (Claude Sonnet 4.6 / Opus)

L'affichage est du type: `G3.1 78% | S4.6 42%` avec un tooltip détaillé (% restant + heure de reset).

### Pourquoi pas via le DOM ?

Lire le DOM ou le texte affiché par l'IDE est **fragile** (changement de texte / structure à chaque mise à jour). La bonne approche est de **lire l'état réel que l'IDE utilise**: l'API locale du language server Antigravity sur `127.0.0.1`, qui expose un endpoint `GetUserStatus` contenant les infos de quota par modèle.

---

## 2) Principe technique

L'extension effectue 3 opérations en séquence:

1. **Trouver le processus du language server Antigravity** (Windows) et extraire le `csrf_token` (souvent présent en argument de ligne de commande via `--csrf_token`).
2. **Trouver le port local** où le language server expose l'API (via `netstat -ano` sur le PID + probing d'un endpoint connu).
3. **Appeler `GetUserStatus`**, extraire les quotas des modèles, et mettre à jour un `StatusBarItem` toutes les X secondes.

---

## 3) Extension séparée — Architecture

### 3.1 Arborescence recommandée

```
antigravity-quota-monitor/
├── package.json
├── tsconfig.json
└── src/
    ├── extension.ts          # Point d'entrée VS Code
    └── quota/
        ├── agQuotaClient.ts  # Découverte du LS + appel API
        └── quotaMonitor.ts   # Gestion StatusBarItem + polling
```

### 3.2 Dépendances / pile technique

- **TypeScript** (identique aux autres extensions du projet)
- **Build** vers `out/`
- **Activation**: `"onStartupFinished"` (dès ouverture de l'IDE)
- Pas de dépendance externe: uniquement les modules Node.js natifs (`child_process`, `http`, `https`)

---

## 4) Contribution UI (package.json)

```json
{
  "activationEvents": ["onStartupFinished"],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "antigravityQuota.refreshNow",
        "title": "Antigravity Quota: Refresh Now"
      }
    ],
    "configuration": {
      "title": "Antigravity Quota Monitor",
      "properties": {
        "antigravityQuota.enabled": {
          "type": "boolean",
          "default": true,
          "description": "Afficher le quota restant pour Gemini 3.1 et Sonnet 4.6."
        },
        "antigravityQuota.pollIntervalSec": {
          "type": "number",
          "default": 120,
          "description": "Intervalle de rafraîchissement en secondes (minimum 30)."
        }
      }
    }
  }
}
```

---

## 5) Implémentation — `src/quota/agQuotaClient.ts`

Ce module est responsable de:

1. Trouver le PID du language server via PowerShell (WMI/CIM)
2. Extraire `--csrf_token` et éventuellement `--extension_server_port` depuis la ligne de commande
3. Lister les ports TCP `LISTENING` associés au PID via `netstat -ano`
4. Tester les ports jusqu'à en trouver un qui répond à un endpoint "Connect" connu
5. Faire un POST JSON sur `GetUserStatus`
6. Retourner une liste `{ label, modelId, remainingFraction, resetTime }`

```typescript
// src/quota/agQuotaClient.ts
import * as cp from "child_process";
import * as https from "https";
import * as http from "http";

export type ModelQuota = {
  label: string;
  modelId: string;
  remainingFraction?: number; // 0..1
  resetTime?: string;
};

type LSInfo = { pid: number; csrf?: string; extPort?: number };

function execPowershellJson<T>(psCommand: string): Promise<T | null> {
  return new Promise((resolve) => {
    cp.execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", psCommand],
      { windowsHide: true, maxBuffer: 5_000_000 },
      (err, stdout) => {
        if (err || !stdout?.trim()) return resolve(null);
        try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
      }
    );
  });
}

async function findLanguageServerWindows(): Promise<LSInfo | null> {
  const cmd =
    "Get-CimInstance Win32_Process | " +
    "Where-Object { $_.CommandLine -match '--app_data_dir\\s+antigravity' -and $_.CommandLine -match 'csrf_token' } | " +
    "Select-Object -First 1 ProcessId, CommandLine | ConvertTo-Json -Compress";

  const p = await execPowershellJson<{ ProcessId: number; CommandLine: string }>(cmd);
  if (!p?.ProcessId || !p?.CommandLine) return null;

  const mCsrf = p.CommandLine.match(/--csrf_token(?:=|\s+)([^\s"]+)/i);
  const mPort = p.CommandLine.match(/--extension_server_port(?:=|\s+)(\d+)/i);

  return { pid: p.ProcessId, csrf: mCsrf?.[1], extPort: mPort ? Number(mPort[1]) : undefined };
}

async function listListeningPortsWindows(pid: number): Promise<number[]> {
  return new Promise((resolve) => {
    cp.execFile("cmd.exe", ["/c", "netstat -ano -p tcp"], { windowsHide: true, maxBuffer: 5_000_000 }, (_e, out) => {
      const ports = new Set<number>();
      for (const line of (out || "").split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const [proto, localAddr, _foreign, state, linePid] = parts;
        if (proto !== "TCP" || state !== "LISTENING") continue;
        if (Number(linePid) !== pid) continue;
        const m = localAddr.match(/:(\d+)$/);
        if (m) ports.add(Number(m[1]));
      }
      resolve([...ports]);
    });
  });
}

async function probeConnectPort(port: number, csrf?: string): Promise<("https" | "http") | null> {
  const path = "/exa.language_server_pb.LanguageServerService/GetUnleashData";
  const body = JSON.stringify({ wrapper_data: {} });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Connect-Protocol-Version": "1",
  };
  if (csrf) headers["X-Codeium-Csrf-Token"] = csrf;

  const tryProto = (proto: "https" | "http") =>
    new Promise<boolean>((resolve) => {
      const mod = proto === "https" ? https : http;
      const req = mod.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: "POST",
          headers,
          timeout: 600,
          rejectUnauthorized: false,
        } as any,
        (res) => {
          res.resume();
          resolve(res.statusCode === 200 || res.statusCode === 401);
        }
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    });

  if (await tryProto("https")) return "https";
  if (await tryProto("http")) return "http";
  return null;
}

async function postJson<T>(baseUrl: string, path: string, csrf: string | undefined, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const u = new URL(path, baseUrl);
    const mod = u.protocol === "https:" ? https : http;

    const headers: Record<string, string> = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Connect-Protocol-Version": "1",
    };
    if (csrf) headers["X-Codeium-Csrf-Token"] = csrf;

    const req = mod.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers,
        timeout: 5000,
        rejectUnauthorized: false,
      } as any,
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(data) as T); } catch { reject(new Error("Bad JSON")); }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.write(JSON.stringify(payload));
    req.end();
  });
}

export async function fetchModelQuotasWindows(): Promise<ModelQuota[]> {
  const ls = await findLanguageServerWindows();
  if (!ls) throw new Error("Language server introuvable (Antigravity doit être ouvert).");

  const ports = await listListeningPortsWindows(ls.pid);
  if (ls.extPort) ports.push(ls.extPort - 1, ls.extPort, ls.extPort + 1);

  const uniq = [...new Set(ports)].filter((p) => p > 0);

  let baseUrl: string | null = null;
  for (const p of uniq) {
    const proto = await probeConnectPort(p, ls.csrf);
    if (proto) { baseUrl = `${proto}://127.0.0.1:${p}`; break; }
  }
  if (!baseUrl && ls.extPort) baseUrl = `http://127.0.0.1:${ls.extPort}`;
  if (!baseUrl) throw new Error("Port API introuvable.");

  const payload = { metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } };
  const raw = await postJson<any>(baseUrl, "/exa.language_server_pb.LanguageServerService/GetUserStatus", ls.csrf, payload);

  const userStatus = raw?.userStatus ?? raw;
  const configs = userStatus?.cascadeModelConfigData?.clientModelConfigs ?? [];

  return configs.map((c: any) => ({
    label: String(c?.label ?? c?.displayName ?? c?.modelOrAlias?.model ?? "unknown"),
    modelId: String(c?.modelOrAlias?.model ?? "unknown"),
    remainingFraction: typeof c?.quotaInfo?.remainingFraction === "number" ? c.quotaInfo.remainingFraction : undefined,
    resetTime: typeof c?.quotaInfo?.resetTime === "string" ? c.quotaInfo.resetTime : undefined,
  }));
}
```

---

## 6) Implémentation — `src/quota/quotaMonitor.ts`

Ce module gère:
- La création du `StatusBarItem`
- Le polling toutes les `pollIntervalSec` secondes (minimum 30)
- Le matching "souple" de Gemini 3.1 et Sonnet 4.6
- La gestion des erreurs (status "Quota: error" + log dans l'OutputChannel)

```typescript
// src/quota/quotaMonitor.ts
import * as vscode from "vscode";
import { fetchModelQuotasWindows, ModelQuota } from "./agQuotaClient";

function pct(x?: number): string {
  if (typeof x !== "number") return "??%";
  return `${Math.round(x * 100)}%`;
}

function pick(quotas: ModelQuota[], patterns: RegExp[]): ModelQuota | undefined {
  return quotas.find(q => patterns.some(r => r.test(q.label) || r.test(q.modelId)));
}

export class QuotaMonitor {
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);

  constructor(private out: vscode.OutputChannel) {
    this.item.text = "Quota: …";
    this.item.command = "antigravityQuota.refreshNow";
    this.item.show();
  }

  dispose() { this.stop(); this.item.dispose(); }

  private cfg() {
    const c = vscode.workspace.getConfiguration("antigravityQuota");
    return {
      enabled: c.get<boolean>("enabled", true),
      pollSec: Math.max(30, c.get<number>("pollIntervalSec", 120)),
    };
  }

  start() {
    const c = this.cfg();
    this.stop();
    if (!c.enabled) { this.item.text = "Quota: off"; return; }
    void this.refresh(false);
    this.timer = setInterval(() => void this.refresh(false), c.pollSec * 1000);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }

  async refresh(showErrors: boolean) {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const all = await fetchModelQuotasWindows();

      const gemini = pick(all, [/gemini\s*3\.?1/i, /GEMINI[_\s-]*3[_\s-]*1/i]);
      const sonnet = pick(all, [/sonnet\s*4\.?6/i, /claude.*sonnet.*4\.?6/i, /SONNET/i]);

      const gTxt = gemini ? `G3.1 ${pct(gemini.remainingFraction)}` : "G3.1 —";
      const sTxt = sonnet ? `S4.6 ${pct(sonnet.remainingFraction)}` : "S4.6 —";

      this.item.text = `${gTxt} | ${sTxt}`;
      this.item.tooltip =
        `Gemini 3.1: ${gemini ? pct(gemini.remainingFraction) : "n/a"}\nReset: ${gemini?.resetTime ?? "n/a"}\n\n` +
        `Sonnet 4.6: ${sonnet ? pct(sonnet.remainingFraction) : "n/a"}\nReset: ${sonnet?.resetTime ?? "n/a"}`;
    } catch (e) {
      this.item.text = "Quota: error";
      this.out.appendLine(`[quota] ${String(e)}`);
      if (showErrors) vscode.window.showErrorMessage(`Quota monitor: ${String(e)}`);
    } finally {
      this.inFlight = false;
    }
  }
}
```

---

## 7) Implémentation — `src/extension.ts`

```typescript
// src/extension.ts
import * as vscode from "vscode";
import { QuotaMonitor } from "./quota/quotaMonitor";

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Antigravity Quota Monitor");
  context.subscriptions.push(out);

  const monitor = new QuotaMonitor(out);
  context.subscriptions.push(monitor);

  context.subscriptions.push(
    vscode.commands.registerCommand("antigravityQuota.refreshNow", async () => {
      await monitor.refresh(true);
    })
  );

  monitor.start();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("antigravityQuota")) monitor.start();
    })
  );

  out.appendLine("Quota Monitor activated.");
}

export function deactivate() {}
```

---

## 8) Points solides vs points à valider

### Ce qui est solide
- L'extension ne dépend **pas du DOM**, uniquement de l'état local du language server.
- Tant que le LS expose `GetUserStatus` avec `quotaInfo.remainingFraction`, l'affichage est fiable.
- Le probing de port et le matching "souple" des labels absorbent des variations mineures.

### Ce qui peut varier selon les versions
| Point variable | Risque | Mitigation |
|---|---|---|
| Nom exact du processus Antigravity | Moyen | Filtre sur `--app_data_dir antigravity` + `csrf_token` |
| Présence / forme de `--csrf_token` | Faible | Fallback sans token (certains endpoints l'acceptent) |
| Protocole HTTP vs HTTPS | Faible | Probing des deux |
| Structure de `GetUserStatus` | Moyen | Matching souple sur `label` et `modelId` |
| Labels exacts de Gemini 3.1 / Sonnet 4.6 | Moyen | Regexes souples (`/gemini\s*3\.?1/i`, etc.) |

> **Note**: Si les modèles ne matchent pas, ouvrir l'OutputChannel "Antigravity Quota Monitor" et lire les logs. Si nécessaire, fournir un extrait de `clientModelConfigs` pour affiner le matching (voir §9).

---

## 9) Validation et debug

### Procédure de validation (à confier à l'agent)

1. Lancer l'extension en mode dev (`F5` dans VS Code / tâche Antidex Developer AG).
2. Observer l'**OutputChannel "Antigravity Quota Monitor"**:
   - Si `"Port API introuvable"` → problème de découverte du processus/ports (ajuster le filtre WMI ou l'endpoint de probing).
   - Si l'extension liste des configs mais ne matche pas "Gemini 3.1 / Sonnet 4.6" → ajuster les regexes de matching.
   - Si quota OK → affichage `G3.1 XX% | S4.6 XX%` dans la status bar.
3. Cliquer sur l'item de la status bar déclenche un refresh manuel.

### Diagnostic rapide (PowerShell)
Pour vérifier manuellement que le language server est trouvé:
```powershell
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match '--app_data_dir\s+antigravity' -and $_.CommandLine -match 'csrf_token' } |
  Select-Object ProcessId, CommandLine
```

Si le résultat est vide, le filtre WMI doit être adapté à la version installée d'Antigravity.

---

## 10) Intégration dans le pipeline Antidex

Cette extension est un **projet cible autonome**, pas une tâche inline du pipeline. Workflow recommandé:

1. **Manager** crée un projet cible `antigravity-quota-monitor/` dans un workspace choisi par l'utilisateur.
2. **Developer Codex** implémente l'arborescence TypeScript (§3) et le code (§5–§7).
3. **Developer Antigravity** crée le repo GitHub (voir `SPEC.md` §14.3) et installe/vérifie l'extension dans Antigravity.
4. **Manager** valide via les critères d'acceptation (§11).

---

## 11) Critères d'acceptation

- [ ] L'extension s'active au démarrage sans erreur dans l'OutputChannel.
- [ ] Le `StatusBarItem` affiche `G3.1 XX% | S4.6 XX%` (ou `—` si non trouvé) dans les 30 secondes.
- [ ] Le tooltip sur l'item affiche le % restant et l'heure de reset pour chaque modèle.
- [ ] Le clic sur l'item déclenche un refresh immédiat (`antigravityQuota.refreshNow`).
- [ ] Le polling se fait automatiquement toutes les `pollIntervalSec` secondes (défaut: 120, min: 30).
- [ ] La config `antigravityQuota.enabled=false` désactive l'affichage.
- [ ] En cas d'erreur (LS introuvable, port API introuvable), l'item affiche `Quota: error` et loggue le détail.
- [ ] Aucune dépendance externe hors Node.js natifs.
