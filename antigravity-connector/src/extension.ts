import * as http from "http";
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { trySendViaCDP } from "./cdp/cdpClient";

let logFilePath: string | null = null;

function logToFile(msg: string) {
    if (!logFilePath) return;
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}\n`;
    fs.appendFile(logFilePath, line, () => {
        // recursive logging safety: don't log errors about logging to the same place
    });
}

// --- Configuration ---
function defaultPortForHost(appName: string) {
    const lower = String(appName || "").toLowerCase();
    // Antigravity is a separate VS Code fork/app; avoid colliding with a normal VS Code instance.
    if (lower.includes("antigravity")) return 17375;
    return 17374;
}

function getConfig() {
    const cfg = vscode.workspace.getConfiguration("antigravityConnector");
    return {
        port: cfg.get<number>("port", defaultPortForHost(vscode.env.appName)),
        autoSend: cfg.get<boolean>("autoSend", true),
        useCDP: cfg.get<boolean>("useCDP", false),
        cdpPort: cfg.get<number>("cdpPort", 9000),
        cdpPortMax: cfg.get<number>("cdpPortMax", 9003),
        cdpFallbackToUI: cfg.get<boolean>("cdpFallbackToUI", false),
        cdpVerifyTimeoutMs: cfg.get<number>("cdpVerifyTimeoutMs", 2500),
        logFilePath: cfg.get<string>("logFilePath", ""),
    };
}

// --- Helpers ---
function sendJson(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
}

function sendText(res: http.ServerResponse, status: number, body: string) {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(body);
}

function getBuildInfo() {
    try {
        const st = fs.statSync(__filename);
        return { buildFile: __filename, buildMtimeMs: st.mtimeMs };
    } catch {
        return { buildFile: __filename, buildMtimeMs: null };
    }
}

function readJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        req.on("end", () => {
            try {
                const buf = Buffer.concat(chunks);
                if (!buf.length) {
                    resolve({});
                    return;
                }

                const contentType = String(req.headers["content-type"] || "");
                const charsetMatch = contentType.match(/charset\s*=\s*([^\s;]+)/i);
                const charset = charsetMatch ? charsetMatch[1].toLowerCase() : "";

                const decodeUtf16Be = (b: Buffer) => {
                    const swapped = Buffer.allocUnsafe(b.length);
                    for (let i = 0; i + 1 < b.length; i += 2) {
                        swapped[i] = b[i + 1];
                        swapped[i + 1] = b[i];
                    }
                    return swapped.toString("utf16le");
                };

                const looksUtf16Le =
                    buf.length >= 4 &&
                    // Common for UTF-16LE JSON: lots of NUL bytes at odd indexes.
                    (buf[1] === 0x00 || buf[3] === 0x00) &&
                    (() => {
                        let zeros = 0;
                        const n = Math.min(buf.length, 200);
                        for (let i = 1; i < n; i += 2) if (buf[i] === 0x00) zeros += 1;
                        return zeros / Math.max(1, Math.floor(n / 2)) > 0.6;
                    })();

                let text = "";
                if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
                    text = buf.slice(2).toString("utf16le");
                } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
                    text = decodeUtf16Be(buf.slice(2));
                } else if (charset.includes("utf-16le") || charset.includes("utf16le") || looksUtf16Le) {
                    text = buf.toString("utf16le");
                } else {
                    // Default: UTF-8 for JSON.
                    text = buf.toString("utf8");
                }

                resolve(text ? JSON.parse(text) : {});
            } catch (e) {
                reject(e);
            }
        });
        req.on("error", reject);
    });
}

async function getAntigravityCommands(): Promise<string[]> {
    const all = await vscode.commands.getCommands(true);
    return all.filter((c) => c.toLowerCase().includes("antigravity"));
}

type DedupeEntry = { ts: number; result: SendResult };
const dedupeCache = new Map<string, DedupeEntry>();
const DEDUPE_TTL_MS = 60_000;

function getDedupeKey(body: any): string | null {
    if (!body) return null;
    if (typeof body.requestId === "string" && body.requestId.trim()) return body.requestId.trim();
    if (typeof body.runId === "string" && body.runId.trim()) return body.runId.trim();
    return null;
}

function pruneDedupeCache(now: number) {
    for (const [key, entry] of dedupeCache.entries()) {
        if (now - entry.ts > DEDUPE_TTL_MS) dedupeCache.delete(key);
    }
}

// --- Core Logic ---

type SendMethod = "cdp" | "antigravity.sendChatActionMessage" | "antigravity.sendTextToChat" | "type";
type SendResult = {
    ok: boolean;
    method: SendMethod;
    error?: string;
    cdp?: {
        port?: number;
        targetTitle?: string;
        verifyFound?: boolean;
        needle?: string;
    };
};

async function sendPrompt(
    prompt: string,
    autoSend: boolean,
    out: vscode.OutputChannel,
    cdp: {
        use: boolean;
        portStart: number;
        portEnd: number;
        fallbackToUI: boolean;
        verifyTimeoutMs: number;
        verifyNeedle?: string;
    },
): Promise<SendResult> {
    if (cdp.use) {
        out.appendLine("[CDP] Attempting CDP injection...");
        const res = await trySendViaCDP(prompt, {
            portStart: cdp.portStart,
            portEnd: cdp.portEnd,
            verifyTimeoutMs: cdp.verifyTimeoutMs,
            verifyNeedle: cdp.verifyNeedle,
        });
        if (res.ok) {
            const targetInfo = res.target ? ` targetTitle=${JSON.stringify(res.target.title ?? "")}` : "";
            out.appendLine(`[CDP] Injection OK (port=${res.port ?? "?"})${targetInfo}`);
            if (res.details && res.details.debug) {
                res.details.debug.forEach(line => out.appendLine(`[CDP Debug] ${line}`));
            }
            return {
                ok: true,
                method: "cdp",
                cdp: {
                    port: res.port,
                    targetTitle: res.target?.title,
                    verifyFound: res.verify?.found,
                    needle: res.verify?.needle,
                },
            };
        }
        const extra =
            (res.target ? ` targetTitle=${JSON.stringify(res.target.title ?? "")}` : "") +
            (res.verify ? ` verifyFound=${String(res.verify.found)} needle=${JSON.stringify(res.verify.needle)}` : "") +
            (res.details
                ? ` inserted=${String(!!res.details.inserted)} submitted=${String(!!res.details.submitted)} hasSubmit=${String(
                      !!res.details.hasSubmit,
                  )} submitDisabled=${String((res.details as any).submitDisabled ?? "")}`
                : "");

        if (res.details && res.details.debug) {
            res.details.debug.forEach(line => out.appendLine(`[CDP Debug] ${line}`));
        }

        out.appendLine(`[CDP] Failed: ${res.error || "unknown error"}${extra}`);
        if (!cdp.fallbackToUI) {
            return {
                ok: false,
                method: "cdp",
                error: res.error || "CDP failed",
                cdp: {
                    port: res.port,
                    targetTitle: res.target?.title,
                    verifyFound: res.verify?.found,
                    needle: res.verify?.needle,
                },
            };
        }
    }
    // 1. Try known direct internal command
    const sendCmd = "antigravity.sendTextToChat"; // Based on previous findings
    const cmds = await getAntigravityCommands();

    // Best-effort: ensure the Agent panel is visible/focused so "submit" actions land in the right place.
    try {
        if (cmds.includes("antigravity.agentPanel.open")) {
            await vscode.commands.executeCommand("antigravity.agentPanel.open");
        }
        if (cmds.includes("antigravity.agentPanel.focus")) {
            await vscode.commands.executeCommand("antigravity.agentPanel.focus");
        }
    } catch {
        // ignore
    }

    // Some builds may not implement sendTextToChat as a "chat input + submit" action.
    // First try the more likely "chat action" command if it exists.
    const sendActionCmd = "antigravity.sendChatActionMessage";
    if (cmds.includes(sendActionCmd)) {
        try {
            if (cmds.includes("antigravity.prioritized.chat.openNewConversation")) {
                await vscode.commands.executeCommand("antigravity.prioritized.chat.openNewConversation");
                await new Promise((r) => setTimeout(r, 200));
            }
            if (cmds.includes("antigravity.toggleChatFocus")) {
                await vscode.commands.executeCommand("antigravity.toggleChatFocus");
                await new Promise((r) => setTimeout(r, 100));
            }

            try {
                await vscode.commands.executeCommand(sendActionCmd, prompt);
            } catch {
                try {
                    await vscode.commands.executeCommand(sendActionCmd, { text: prompt, submit: autoSend });
                } catch {
                    await vscode.commands.executeCommand(sendActionCmd, { prompt, submit: autoSend });
                }
            }

            if (autoSend) {
                try {
                    await vscode.commands.executeCommand("type", { text: "\n" });
                } catch {
                    // ignore
                }
            }

            out.appendLine(`Executed ${sendActionCmd}`);
            return { ok: true, method: "antigravity.sendChatActionMessage" };
        } catch (e) {
            out.appendLine(`Failed to execute ${sendActionCmd}: ${e}`);
        }
    }

    if (cmds.includes(sendCmd)) {
        try {
            // Signature guesses based on typical patterns; try a couple before falling back.
            try {
                await vscode.commands.executeCommand(sendCmd, prompt);
            } catch {
                await vscode.commands.executeCommand(sendCmd, { text: prompt, submit: autoSend });
            }

            // Some builds insert text but don't submit. If autoSend is requested, try an extra Enter.
            if (autoSend) {
                try {
                    await vscode.commands.executeCommand("type", { text: "\n" });
                } catch {
                    // ignore
                }
            }
            out.appendLine(`Executed ${sendCmd}`);
            return { ok: true, method: "antigravity.sendTextToChat" };
        } catch (e) {
            out.appendLine(`Failed to execute ${sendCmd}: ${e}`);
            // Fallback to type
        }
    }

    // 2. Fallback: Type text
    try {
        // Best-effort focus (avoid opening a new conversation as a side-effect).
        const focusCmd = "antigravity.agentPanel.focus";
        if (cmds.includes(focusCmd)) {
            await vscode.commands.executeCommand(focusCmd);
        }

        await vscode.commands.executeCommand("type", { text: prompt + (autoSend ? "\n" : "") });
        out.appendLine("executed 'type' fallback");
        return { ok: true, method: "type" };
    } catch (e) {
        out.appendLine(`Failed fallback: ${e}`);
        return { ok: false, method: "type", error: String(e) };
    }
}

// --- Main ---

export function activate(context: vscode.ExtensionContext) {
    const out = vscode.window.createOutputChannel("Antigravity Connector");
    const cfg = getConfig();
    const buildInfo = getBuildInfo();

    // Default log location: inside the workspace (so AG can read it),
    // falling back to extension global storage if no workspace is open.
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const defaultWorkspaceLog = workspaceRoot
        ? path.join(workspaceRoot, "Local_Agents", "Antigravity_POC", "data", "connector_output.log")
        : null;
    const configuredLog = (cfg.logFilePath || "").trim();
    logFilePath = configuredLog || defaultWorkspaceLog || path.join(context.globalStorageUri.fsPath, "connector_output.log");

    try {
        fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
    } catch {
        logFilePath = null;
    }

    // Proxy the output channel
    const originalAppendLine = out.appendLine.bind(out);
    out.appendLine = (val: string) => {
        originalAppendLine(val);
        logToFile(val);
    };

    out.appendLine(`Antigravity Connector active${logFilePath ? `. Logging to ${logFilePath}` : ""}`);

    const diagnosticsCmd = vscode.commands.registerCommand(
        "antigravityConnector.diagnostics",
        async () => {
            out.show(true);
            out.appendLine("Diagnostics requested");
            try {
                const cmds = await getAntigravityCommands();
                out.appendLine(`antigravity.* commands: ${cmds.filter((c) => c.startsWith("antigravity.")).length}`);
                vscode.window.showInformationMessage("Antigravity Connector: diagnostics written to Output");
            } catch (e) {
                out.appendLine(`Diagnostics error: ${String(e)}`);
                vscode.window.showErrorMessage("Antigravity Connector: diagnostics failed");
            }
        },
    );
    context.subscriptions.push(diagnosticsCmd);

    const server = http.createServer(async (req, res) => {
        const url = req.url || "/";
        const method = req.method;

        if (method === "GET" && url === "/health") {
            sendJson(res, 200, { ok: true, app: vscode.env.appName, port: cfg.port, pid: process.pid, ...buildInfo });
            return;
        }

        if (method === "GET" && url === "/diagnostics") {
            const cmds = await getAntigravityCommands();
            sendJson(res, 200, { app: vscode.env.appName, port: cfg.port, commands: cmds });
            return;
        }

        if (method === "POST" && url === "/ping") {
            try {
                const body = await readJson(req);
                const msg = body && body.message ? String(body.message) : "ping";
                out.appendLine(`Ping: ${msg}`);
                // Visible confirmation that we are talking to *this* window.
                vscode.window.showInformationMessage(`Antigravity Connector: ${msg}`);
                sendJson(res, 200, { ok: true });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: String(e) });
            }
            return;
        }



        if (method === "GET" && url === "/extensions") {
            sendJson(res, 200, { ids: vscode.extensions.all.map(e => e.id) });
            return;
        }

        if (method === "GET" && url.startsWith("/extension?")) {
            const q = new URLSearchParams(url.split("?")[1]);
            const id = q.get("id");
            if (!id) {
                sendJson(res, 400, { ok: false, error: "Missing 'id' param" });
                return;
            }

            const ext = vscode.extensions.getExtension(id);
            if (!ext) {
                // Try fuzzy match
                const all = vscode.extensions.all;
                const found = all.find(e => e.id.toLowerCase().includes(id.toLowerCase()));
                if (found) {
                    sendJson(res, 200, { ok: false, error: "Extension not found but found candidate", candidate: found.id });
                    return;
                }
                sendJson(res, 404, { ok: false, error: "Extension not found" });
                return;
            }

            try {
                if (!ext.isActive) await ext.activate();
                const exports = ext.exports;

                // Scan for likely methods
                const methods: string[] = [];
                const scan = (obj: any, path: string, depth: number) => {
                    if (depth > 3) return;
                    if (!obj) return;
                    for (const key of Object.keys(obj)) {
                        const val = obj[key];
                        if (typeof val === 'function') {
                            methods.push(path ? `${path}.${key}` : key);
                        } else if (typeof val === 'object' && val !== null) {
                            scan(val, path ? `${path}.${key}` : key, depth + 1);
                        }
                    }
                }
                scan(exports, "", 0);

                sendJson(res, 200, { ok: true, id: ext.id, isActive: ext.isActive, methods: methods.slice(0, 100) });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: String(e) });
            }
            return;
        }

        if (method === "GET" && url === "/extensions") {
            sendJson(res, 200, { ids: vscode.extensions.all.map(e => e.id) });
            return;
        }

        if (method === "POST" && url === "/send") {
            try {
                const body = await readJson(req);
                const prompt = body.prompt;
                if (!prompt) {
                    sendText(res, 400, "Missing prompt");
                    return;
                }

                const now = Date.now();
                pruneDedupeCache(now);
                const dedupeKey = getDedupeKey(body);
                if (dedupeKey && dedupeCache.has(dedupeKey)) {
                    const cached = dedupeCache.get(dedupeKey)!.result;
                    out.appendLine(`Deduped /send (requestId=${JSON.stringify(dedupeKey)})`);
                    sendJson(res, 200, { ok: cached.ok, method: cached.method, error: cached.error });
                    return;
                }

                const cmds = await getAntigravityCommands();
                const newConversation = !!(body && (body.newConversation || body.newThread));
                if (newConversation) {
                    try {
                        if (cmds.includes("antigravity.prioritized.chat.openNewConversation")) {
                            out.appendLine("Opening new conversation (requested by client)");
                            await vscode.commands.executeCommand("antigravity.prioritized.chat.openNewConversation");
                            await new Promise((r) => setTimeout(r, 2000));
                        } else {
                            out.appendLine(
                                "WARNING: newConversation requested but command antigravity.prioritized.chat.openNewConversation not found",
                            );
                        }
                        if (cmds.includes("antigravity.agentPanel.open")) {
                            await vscode.commands.executeCommand("antigravity.agentPanel.open");
                        }
                        if (cmds.includes("antigravity.agentPanel.focus")) {
                            await vscode.commands.executeCommand("antigravity.agentPanel.focus");
                            await new Promise((r) => setTimeout(r, 100));
                        }
                    } catch (e) {
                        out.appendLine(`Failed to open new conversation: ${String(e)}`);
                    }
                }

                // Ensure the Agent panel exists and is focused before CDP injection,
                // even when we are continuing the current thread.
                if (cfg.useCDP) {
                    try {
                        if (cmds.includes("antigravity.agentPanel.open")) {
                            await vscode.commands.executeCommand("antigravity.agentPanel.open");
                        }
                        if (cmds.includes("antigravity.agentPanel.focus")) {
                            await vscode.commands.executeCommand("antigravity.agentPanel.focus");
                            await new Promise((r) => setTimeout(r, 200));
                        }
                    } catch (e) {
                        out.appendLine(`Failed to ensure agent panel open: ${String(e)}`);
                    }
                }

                out.appendLine(`Received prompt: ${prompt}`);
                const notify = !!(body && body.notify);
                const debug = !!(body && body.debug);
                const verifyNeedle = body && typeof body.verifyNeedle === "string" ? body.verifyNeedle : undefined;
                const result = await sendPrompt(String(prompt), cfg.autoSend, out, {
                    use: !!cfg.useCDP,
                    portStart: cfg.cdpPort,
                    portEnd: Math.max(cfg.cdpPort, cfg.cdpPortMax),
                    fallbackToUI: !!cfg.cdpFallbackToUI,
                    verifyTimeoutMs: cfg.cdpVerifyTimeoutMs,
                    verifyNeedle,
                });

                if (dedupeKey) dedupeCache.set(dedupeKey, { ts: now, result });

                if (notify) {
                    vscode.window.showInformationMessage(`Antigravity Connector: sent via ${result.method}`);
                }
                // Always return 200 with ok=false on delivery failures to avoid client retries caused by HTTP errors
                // (which can create duplicate prompts). Callers can enforce strictness via result.ok.
                sendJson(res, 200, debug ? { ...result } : { ok: result.ok, method: result.method, error: result.error });
            } catch (e) {
                sendText(res, 500, String(e));
            }
            return;
        }

        if (method === "POST" && url === "/read") {
            try {
                // Sequence to copy chat content
                // 1. Focus chat - try multiple focus commands to ensure we hit the webview
                await vscode.commands.executeCommand("antigravity.switchBetweenWorkspaceAndAgent");
                // This seems to toggle. If already in agent, it might switch back? 
                // Let's try explicit Focus commands found in diagnostics
                await new Promise(r => setTimeout(r, 200));
                await vscode.commands.executeCommand("antigravity.agentPanel.focus");

                // 2. Select All
                await new Promise(r => setTimeout(r, 200));
                await vscode.commands.executeCommand("editor.action.selectAll");

                // 3. Copy
                await new Promise(r => setTimeout(r, 200));
                await vscode.commands.executeCommand("editor.action.clipboardCopyAction");

                // 4. Read Clipboard
                await new Promise(r => setTimeout(r, 200));
                const text = await vscode.env.clipboard.readText();

                sendJson(res, 200, { ok: true, content: text, length: text.length });
            } catch (e) {
                sendJson(res, 500, { ok: false, error: String(e) });
            }
            return;
        }

        sendText(res, 404, "Not Found");
    });

    server.on("error", (err: any) => {
        const code = err && typeof err === "object" ? (err as any).code : undefined;
        if (code === "EADDRINUSE") {
            out.appendLine(`ERROR: Port ${cfg.port} already in use (EADDRINUSE).`);
            out.appendLine("Fix: change 'antigravityConnector.port' in this window, then Reload Window.");
            return;
        }
        out.appendLine(`Server error: ${String(err)}`);
    });

    server.listen(cfg.port, "127.0.0.1", () => {
        out.appendLine(`Server listening on port ${cfg.port} (app=${vscode.env.appName})`);
    });


    context.subscriptions.push({ dispose: () => server.close() });
}

export function deactivate() { }
