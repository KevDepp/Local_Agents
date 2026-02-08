import * as http from "http";
import * as vscode from "vscode";

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

function readJson(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
        let data = "";
        req.on("data", (chunk) => (data += chunk));
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

async function getAntigravityCommands(): Promise<string[]> {
    const all = await vscode.commands.getCommands(true);
    return all.filter((c) => c.toLowerCase().includes("antigravity"));
}

// --- Core Logic ---

async function sendPrompt(prompt: string, autoSend: boolean, out: vscode.OutputChannel): Promise<boolean> {
    // 1. Try known direct internal command
    const sendCmd = "antigravity.sendTextToChat"; // Based on previous findings
    const cmds = await getAntigravityCommands();

    if (cmds.includes(sendCmd)) {
        try {
            // Signature guesses based on typical patterns; try a couple before falling back.
            try {
                await vscode.commands.executeCommand(sendCmd, prompt);
            } catch {
                await vscode.commands.executeCommand(sendCmd, { text: prompt, submit: autoSend });
            }
            out.appendLine(`Executed ${sendCmd}`);
            return true;
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
        return true;
    } catch (e) {
        out.appendLine(`Failed fallback: ${e}`);
        return false;
    }
}

// --- Main ---

export function activate(context: vscode.ExtensionContext) {
    const out = vscode.window.createOutputChannel("Antigravity Connector");
    out.appendLine("Antigravity Connector active");

    const cfg = getConfig();

    const server = http.createServer(async (req, res) => {
        const url = req.url || "/";
        const method = req.method;

        if (method === "GET" && url === "/health") {
            sendJson(res, 200, { ok: true, app: vscode.env.appName, port: cfg.port, pid: process.pid });
            return;
        }

        if (method === "GET" && url === "/diagnostics") {
            const cmds = await getAntigravityCommands();
            sendJson(res, 200, { app: vscode.env.appName, port: cfg.port, commands: cmds });
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

                out.appendLine(`Received prompt: ${prompt}`);
                const success = await sendPrompt(prompt, cfg.autoSend, out);
                sendJson(res, 200, { ok: success });
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
