import * as http from "http";
import * as vscode from "vscode";

type Target = "auto" | "codex" | "antigravity";

type BridgeConfig = {
  port: number;
  token: string;
  autoSend: boolean;
  codexExtensionId: string;
  codexOpenCommand: string;
  codexFocusCommandCandidates: string[];
  codexSendCommandCandidates: string[];
  codexSubmitCommandCandidates: string[];
  antigravityOpenCommand: string;
  antigravitySendCommandCandidates: string[];
};

function getConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration("promptBridge");
  return {
    port: cfg.get<number>("port", 17373),
    token: cfg.get<string>("token", ""),
    autoSend: cfg.get<boolean>("autoSend", true),
    codexExtensionId: cfg.get<string>("codexExtensionId", "openai.chatgpt"),
    codexOpenCommand: cfg.get<string>("codexOpenCommand", "chatgpt.openSidebar"),
    codexFocusCommandCandidates: cfg.get<string[]>("codexFocusCommandCandidates", [
      "chatgpt.sidebarView.focus",
      "workbench.action.chat.focusInput",
    ]),
    codexSendCommandCandidates: cfg.get<string[]>("codexSendCommandCandidates", [
      "chatgpt.sendTextToChat",
      "chatgpt.sendMessage",
      "chatgpt.submit",
      "chatgpt.ask",
    ]),
    codexSubmitCommandCandidates: cfg.get<string[]>("codexSubmitCommandCandidates", [
      "workbench.action.chat.submit",
      "workbench.action.chat.submitWithCodebase",
      "workbench.action.chat.stopListeningAndSubmit",
    ]),
    antigravityOpenCommand: cfg.get<string>(
      "antigravityOpenCommand",
      "antigravity.prioritized.chat.openNewConversation",
    ),
    antigravitySendCommandCandidates: cfg.get<string[]>("antigravitySendCommandCandidates", [
      "antigravity.sendTextToChat",
    ]),
  };
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function parseQuery(url: string): Record<string, string> {
  const qIndex = url.indexOf("?");
  if (qIndex < 0) return {};
  const query = url.slice(qIndex + 1);
  const params = new URLSearchParams(query);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

async function readJson(req: http.IncomingMessage, maxBytes = 512 * 1024): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    let total = 0;
    let data = "";
    req.on("data", (chunk) => {
      const str = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
      total += Buffer.byteLength(str, "utf8");
      if (total > maxBytes) {
        reject(new Error(`Body too large (> ${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      data += str;
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

let commandsCache: { at: number; commands: string[] } | undefined;
async function getCommands(force = false): Promise<string[]> {
  const now = Date.now();
  if (!force && commandsCache && now - commandsCache.at < 2000) return commandsCache.commands;
  const commands = await vscode.commands.getCommands(true);
  commandsCache = { at: now, commands };
  return commands;
}

async function commandExists(id: string): Promise<boolean> {
  const cmds = await getCommands(false);
  return cmds.includes(id);
}

async function tryExecute(
  out: vscode.OutputChannel,
  id: string,
  args: unknown[],
): Promise<boolean> {
  if (!(await commandExists(id))) return false;
  try {
    await vscode.commands.executeCommand(id, ...args);
    out.appendLine(`Executed: ${id}(${args.map(() => "…").join(", ")})`);
    return true;
  } catch (e: unknown) {
    out.appendLine(`Command failed: ${id} (${errorMessage(e)})`);
    return false;
  }
}

type SendDiagnostics = {
  at: string;
  target: Target;
  method: "command" | "exports" | "fallback";
  detail: Record<string, unknown>;
};

let lastSend: SendDiagnostics | undefined;

function promptPreview(prompt: string, maxLen = 240): string {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen)}…` : compact;
}

function safePreview(value: unknown, maxLen = 1200): string {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value);
  }
}

type ExportFunctionCandidate = {
  path: string;
  owner: unknown;
  fn: (...args: unknown[]) => unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function discoverExportFunctions(
  root: unknown,
  opts: { maxDepth: number; maxFunctions: number; keyFilter?: RegExp },
): ExportFunctionCandidate[] {
  const results: ExportFunctionCandidate[] = [];
  const seen = new Set<unknown>();

  const visit = (value: unknown, path: string, depth: number) => {
    if (results.length >= opts.maxFunctions) return;
    if (!value || (typeof value !== "object" && typeof value !== "function")) return;
    if (seen.has(value)) return;
    seen.add(value);

    if (typeof value === "function") {
      if (!opts.keyFilter || opts.keyFilter.test(path.split(".").pop() || path)) {
        results.push({
          path: path || "(exports)",
          owner: undefined,
          fn: value as unknown as (...args: unknown[]) => unknown,
        });
      }
      return;
    }

    if (depth >= opts.maxDepth) return;

    const rec = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      const nextPath = path ? `${path}.${k}` : k;
      if (typeof v === "function") {
        if (!opts.keyFilter || opts.keyFilter.test(k)) {
          results.push({
            path: nextPath,
            owner: value,
            fn: v as unknown as (...args: unknown[]) => unknown,
          });
          if (results.length >= opts.maxFunctions) return;
        }
      } else {
        visit(v, nextPath, depth + 1);
      }
    }
  };

  visit(root, "", 0);
  return results;
}

async function trySendViaCodexExports(
  out: vscode.OutputChannel,
  prompt: string,
  autoSend: boolean,
  cfg: BridgeConfig,
): Promise<boolean> {
  const ext = vscode.extensions.getExtension(cfg.codexExtensionId);
  if (!ext) {
    out.appendLine(`Codex extension not found: ${cfg.codexExtensionId}`);
    return false;
  }

  try {
    await ext.activate();
  } catch (e: unknown) {
    out.appendLine(`Failed to activate ${cfg.codexExtensionId}: ${errorMessage(e)}`);
    return false;
  }

  const exports = (ext as unknown as { exports?: unknown }).exports;
  if (!exports) {
    out.appendLine(`No exports from ${cfg.codexExtensionId}`);
    return false;
  }

  const keyFilter = /send|submit|prompt|ask|message|turn|run/i;
  const candidates = discoverExportFunctions(exports, {
    maxDepth: 4,
    maxFunctions: 40,
    keyFilter,
  });

  const argVariants: unknown[][] = [
    [prompt],
    [{ prompt }],
    [{ text: prompt }],
    [{ input: prompt }],
    [{ message: prompt }],
    [autoSend, prompt],
    [prompt, autoSend],
    [{ prompt, autoSend }],
    [{ text: prompt, autoSend }],
  ];

  for (const c of candidates) {
    for (const args of argVariants) {
      try {
        const result = c.fn.apply(c.owner as never, args);
        if (result && typeof (result as Promise<unknown>).then === "function") {
          await result;
        }
        lastSend = {
          at: new Date().toISOString(),
          target: "codex",
          method: "exports",
          detail: {
            extensionId: cfg.codexExtensionId,
            path: c.path,
            args: args.map(() => "…"),
            promptPreview: promptPreview(prompt),
          },
        };
        out.appendLine(`Sent via exports: ${cfg.codexExtensionId} :: ${c.path}`);
        return true;
      } catch (e: unknown) {
        out.appendLine(`Exports call failed: ${c.path} (${errorMessage(e)})`);
      }
    }
  }

  return false;
}

async function bestEffortTypePrompt(prompt: string, autoSend: boolean): Promise<void> {
  const text = autoSend ? `${prompt}\n` : prompt;
  await vscode.commands.executeCommand("type", { text });
}

async function trySubmitChat(
  out: vscode.OutputChannel,
  cfg: BridgeConfig,
): Promise<{ ok: boolean; command?: string; error?: string }> {
  for (const id of cfg.codexSubmitCommandCandidates) {
    try {
      if (!(await commandExists(id))) continue;
      await vscode.commands.executeCommand(id);
      out.appendLine(`Executed: ${id}()`);
      return { ok: true, command: id };
    } catch (e: unknown) {
      out.appendLine(`Command failed: ${id} (${errorMessage(e)})`);
    }
  }
  return { ok: false };
}

async function sendToCodex(out: vscode.OutputChannel, prompt: string, autoSend: boolean, cfg: BridgeConfig) {
  // 0) Try using the Codex extension exported API (most likely to work without relying on UI focus).
  if (await trySendViaCodexExports(out, prompt, autoSend, cfg)) return;

  // 1) Try direct send commands (signatures vary by version/build).
  for (const id of cfg.codexSendCommandCandidates) {
    // Common guesses: (prompt) or ({text}) - we try prompt-only first.
    if (await tryExecute(out, id, [prompt])) {
      lastSend = {
        at: new Date().toISOString(),
        target: "codex",
        method: "command",
        detail: { command: id, args: ["…"], promptPreview: promptPreview(prompt) },
      };
      return;
    }
    if (await tryExecute(out, id, [{ text: prompt }])) {
      lastSend = {
        at: new Date().toISOString(),
        target: "codex",
        method: "command",
        detail: { command: id, args: ["…"], promptPreview: promptPreview(prompt) },
      };
      return;
    }
  }

  // 2) Open sidebar (best-effort).
  await tryExecute(out, cfg.codexOpenCommand, []);
  // Also try opening the built-in chat view, which is where submit commands apply.
  await tryExecute(out, "workbench.action.chat.openInSidebar", []);

  // 3) Try focus candidates (best-effort).
  for (const id of cfg.codexFocusCommandCandidates) {
    if (await tryExecute(out, id, [])) break;
  }

  // 4) Fallback: type into currently-focused control, then attempt to submit via chat commands.
  // We intentionally do not rely on a newline to submit because many chat inputs treat Enter as
  // "new line" depending on mode/settings.
  await bestEffortTypePrompt(prompt, false);

  let submit: { ok: boolean; command?: string; error?: string } | undefined;
  if (autoSend) submit = await trySubmitChat(out, cfg);

  if (submit?.ok) {
    lastSend = {
      at: new Date().toISOString(),
      target: "codex",
      method: "fallback",
      detail: {
        via: "type+submit",
        chars: prompt.length,
        submitCommand: submit.command,
        promptPreview: promptPreview(prompt),
      },
    };
    out.appendLine(`Fallback used: type(${prompt.length} chars) + submit`);
    return;
  }

  // Last resort: append newline in case the focused control is a webview-based Codex input.
  await bestEffortTypePrompt("", true);
  lastSend = {
    at: new Date().toISOString(),
    target: "codex",
    method: "fallback",
    detail: { via: "type+newline", chars: prompt.length, autoSend, promptPreview: promptPreview(prompt) },
  };
  out.appendLine(`Fallback used: type(${prompt.length} chars) + newline`);
}

async function sendToCodexChat(
  out: vscode.OutputChannel,
  prompt: string,
  autoSend: boolean,
  cfg: BridgeConfig,
): Promise<void> {
  // Best-effort to send a plain chat message (no README/comment workflow).
  // Try the Codex sidebar (OpenAI extension webview) first.
  await tryExecute(out, "chatgpt.openSidebar", []);
  // If available, create a fresh thread to ensure an input is present/focused.
  await tryExecute(out, "chatgpt.newChat", []);
  await tryExecute(out, "chatgpt.sidebarView.focus", []);
  // Type without newline; then attempt submit commands. Some setups treat Enter as "new line" not "send".
  await bestEffortTypePrompt(prompt, false);

  if (autoSend) {
    const submit = await trySubmitChat(out, cfg);
    if (!submit.ok) {
      // Last resort: append newline in case the focused control is a webview-based Codex input.
      await bestEffortTypePrompt("", true);
    }
  }
  lastSend = {
    at: new Date().toISOString(),
    target: "codex",
    method: "fallback",
    detail: { via: "codexSidebar:type", chars: prompt.length, autoSend, promptPreview: promptPreview(prompt) },
  };
  out.appendLine(`Chat: codexSidebar type(${prompt.length} chars)`);
}

async function sendToAntigravity(
  out: vscode.OutputChannel,
  prompt: string,
  autoSend: boolean,
  cfg: BridgeConfig,
) {
  // 1) Try direct send commands. From dev threads, signatures can be (autoSend, text) or (text).
  for (const id of cfg.antigravitySendCommandCandidates) {
    if (await tryExecute(out, id, [autoSend, prompt])) return;
    if (await tryExecute(out, id, [prompt])) return;
    if (await tryExecute(out, id, [prompt, autoSend])) return;
  }

  // 2) Open new conversation (best-effort).
  await tryExecute(out, cfg.antigravityOpenCommand, []);

  // 3) Fallback: type into currently-focused control.
  await bestEffortTypePrompt(prompt, autoSend);
  out.appendLine(`Fallback used: type(${prompt.length} chars)`);
}

function pickAutoTarget(cmds: string[]): Target {
  if (cmds.some((c) => c.startsWith("antigravity."))) return "antigravity";
  return "codex";
}

function errorMessage(e: unknown): string {
  if (e && typeof e === "object") {
    const maybe = e as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
  }
  return String(e);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export function activate(context: vscode.ExtensionContext) {
  const out = vscode.window.createOutputChannel("Prompt Bridge");
  out.appendLine(`Starting Prompt Bridge (${vscode.env.appName})`);

  let server: http.Server | undefined;
  let listeningPort = 0;

  const startServer = async () => {
    const cfg = getConfig();
    await getCommands(true);

    server = http.createServer(async (req, res) => {
      try {
        const currentCfg = getConfig();
        const url = req.url || "/";
        const path = url.split("?")[0] || "/";

        if (req.method === "GET" && path === "/health") {
          sendJson(res, 200, {
            ok: true,
            appName: vscode.env.appName,
            pid: process.pid,
            port: listeningPort,
            lastSend,
          });
          return;
        }

        if (req.method === "GET" && path === "/lastSend") {
          sendJson(res, 200, { ok: true, lastSend });
          return;
        }

        if (req.method === "GET" && path === "/commands") {
          const q = parseQuery(url);
          const filter = (q["filter"] || "").toLowerCase();
          const cmds = await getCommands(true);
          const filtered = filter ? cmds.filter((c) => c.toLowerCase().includes(filter)) : cmds;
          sendJson(res, 200, { count: filtered.length, commands: filtered });
          return;
        }

        if (req.method === "GET" && path === "/codex") {
          const q = parseQuery(url);
          const currentCfg = getConfig();
          const id = String(q["id"] || currentCfg.codexExtensionId);
          const ext = vscode.extensions.getExtension(id);
          if (!ext) {
            sendJson(res, 200, { ok: false, found: false, id });
            return;
          }
          let exports: unknown = undefined;
          let activated = false;
          try {
            await ext.activate();
            activated = true;
            exports = (ext as unknown as { exports?: unknown }).exports;
          } catch (e: unknown) {
            sendJson(res, 200, { ok: false, found: true, id, activated: false, error: errorMessage(e) });
            return;
          }

          const keyFilter = q["filter"] ? new RegExp(String(q["filter"]), "i") : /send|submit|prompt|ask|message|turn|run/i;
          const candidates = discoverExportFunctions(exports, { maxDepth: 4, maxFunctions: 80, keyFilter }).map(
            (c) => c.path,
          );

          sendJson(res, 200, {
            ok: true,
            found: true,
            id,
            isActive: ext.isActive,
            activated,
            exportsType: typeof exports,
            exportsKeys: isRecord(exports) ? Object.keys(exports).slice(0, 50) : [],
            candidateFunctions: candidates,
          });
          return;
        }

        if (req.method === "POST" && path === "/send") {
          if (currentCfg.token) {
            const auth = String(req.headers["authorization"] || "");
            if (auth !== `Bearer ${currentCfg.token}`) {
              sendText(res, 401, "unauthorized");
              return;
            }
          }

          const body = asRecord(await readJson(req)) ?? {};
          const prompt = String(body["prompt"] ?? "").trim();
          const target = String(body["target"] ?? "auto") as Target;
          if (!prompt) {
            sendText(res, 400, "missing prompt");
            return;
          }

          const cmds = await getCommands(false);
          const resolvedTarget: Target = target === "auto" ? pickAutoTarget(cmds) : target;

          out.appendLine(`Incoming /send target=${resolvedTarget} autoSend=${currentCfg.autoSend} chars=${prompt.length}`);

          if (resolvedTarget === "antigravity") {
            await sendToAntigravity(out, prompt, currentCfg.autoSend, currentCfg);
          } else {
            await sendToCodexChat(out, prompt, currentCfg.autoSend, currentCfg);
          }

          sendJson(res, 200, { ok: true, target: resolvedTarget, lastSend });
          return;
        }

        sendText(res, 404, "not found");
      } catch (e: unknown) {
        out.appendLine(`ERROR: ${String(e)}`);
        sendText(res, 500, errorMessage(e));
      }
    });

    const port = cfg.port;
    server.listen(port, "127.0.0.1", () => {
      const address = server?.address();
      listeningPort = typeof address === "object" && address ? address.port : port;
      context.globalState.update("promptBridge.listeningPort", listeningPort);
      out.appendLine(`Listening on http://127.0.0.1:${listeningPort}`);
      out.appendLine(`Tip: GET /commands?filter=chatgpt to discover Codex command IDs.`);
    });
  };

  void startServer();

  context.subscriptions.push({
    dispose: () => {
      if (server) server.close();
    },
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("promptBridge.showPort", async () => {
      const port = context.globalState.get<number>("promptBridge.listeningPort", listeningPort);
      await vscode.window.showInformationMessage(`Prompt Bridge listening on port: ${port || "(starting…)"}`);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("promptBridge.diagnostics", async () => {
      const cfg = getConfig();
      const cmds = await getCommands(true);
      const interesting = [
        cfg.codexOpenCommand,
        ...cfg.codexFocusCommandCandidates,
        ...cfg.codexSendCommandCandidates,
        cfg.antigravityOpenCommand,
        ...cfg.antigravitySendCommandCandidates,
      ];

      out.show(true);
      out.appendLine("=== Diagnostics ===");
      out.appendLine(`App: ${vscode.env.appName}`);
      out.appendLine(`Commands available: ${cmds.length}`);
      for (const id of interesting) {
        out.appendLine(`${cmds.includes(id) ? "✓" : "✗"} ${id}`);
      }
      out.appendLine("Try: GET /commands?filter=chatgpt or /commands?filter=antigravity");
    }),
  );
}

export function deactivate() {}
