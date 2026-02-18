import CDP = require("chrome-remote-interface");
import { buildDetectScript, buildInjectScript } from "./injectedScript";

type TargetInfo = {
    id?: string;
    title?: string;
    url?: string;
    type?: string;
    webSocketDebuggerUrl?: string;
};

type DetectResult = {
    ok: boolean;
    hasEditor?: boolean;
    hasFocus?: boolean;
    usedIframe?: boolean;
};

type InjectResult = {
    ok: boolean;
    usedIframe?: boolean;
    hasEditor?: boolean;
    hasSubmit?: boolean;
    inserted?: boolean;
    submitted?: boolean;
    error?: string;
    debug?: string[];
};

type VerifyResult = {
    ok: boolean;
    found: boolean;
    needle: string;
    details?: string;
    inEditor?: boolean;
    inPanel?: boolean;
};

function scoreTarget(t: TargetInfo): number {
    let score = 0;
    const url = String(t.url || "");
    const title = String(t.title || "");
    if (url.includes("vscode-file://vscode-app")) score += 2;
    if (title.toLowerCase().includes("antigravity")) score += 1;
    return score;
}

async function tryEvaluate(port: number, target: TargetInfo, expression: string): Promise<any> {
    // Force IPv4 to avoid environments where "localhost" resolves to ::1 first.
    const client = await CDP({ host: "127.0.0.1", port, target });
    try {
        const { Runtime } = client;
        await Runtime.enable();
        const res = await Runtime.evaluate({ expression, returnByValue: true, awaitPromise: true });
        return res && res.result ? res.result.value : null;
    } finally {
        try {
            await client.close();
        } catch {
            // ignore
        }
    }
}

async function detectEditor(port: number, target: TargetInfo): Promise<DetectResult> {
    try {
        const value = await tryEvaluate(port, target, buildDetectScript());
        if (value && typeof value === "object") {
            const v = value as any;
            return {
                ok: true,
                hasEditor: !!v.hasEditor,
                hasFocus: !!v.hasFocus,
                usedIframe: !!v.usedIframe,
            };
        }
        return { ok: true, hasEditor: !!value };
    } catch {
        return { ok: false, hasEditor: false };
    }
}

async function injectPrompt(port: number, target: TargetInfo, prompt: string): Promise<InjectResult> {
    try {
        const value = await tryEvaluate(port, target, buildInjectScript(prompt));
        if (value && typeof value === "object") return value as InjectResult;
        return { ok: false, error: "CDP evaluate returned empty result" };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
}

async function listTargets(port: number): Promise<TargetInfo[]> {
    // Force IPv4 for consistency.
    const list = await CDP.List({ host: "127.0.0.1", port });
    return Array.isArray(list) ? (list as TargetInfo[]) : [];
}

function normalizeNeedle(prompt: string): string {
    const oneLine = String(prompt || "").replace(/\s+/g, " ").trim();
    if (!oneLine) return "";
    return oneLine.slice(0, 64);
}

async function verifyPromptInPanel(
    port: number,
    target: TargetInfo,
    prompt: string,
    timeoutMs: number,
    verifyNeedle?: string,
): Promise<VerifyResult> {
    const needle = normalizeNeedle(verifyNeedle || prompt);
    if (!needle) return { ok: true, found: true, needle: "" };

    const safeNeedle = JSON.stringify(needle);
    const safeTimeout = JSON.stringify(Math.max(250, Math.min(15000, timeoutMs || 0)));
    const expr = `(function () {
  const needle = ${safeNeedle};
  const timeoutMs = ${safeTimeout};
  const start = Date.now();
  return new Promise((resolve) => {
    const poll = () => {
      try {
        // Re-resolve on each poll: the iframe/doc can be replaced when starting a new thread.
        const frame = document.querySelector(
          'iframe[id="antigravity.agentPanel"], iframe[name="antigravity.agentPanel"], iframe[src*="cascade-panel.html"], iframe[src*="agentPanel"]'
        );
        const doc = frame && frame.contentDocument ? frame.contentDocument : null;
        const texts = [];
        const topText = (document.body && (document.body.innerText || document.body.textContent)) || "";
        texts.push(topText);
        if (doc) {
          const panelText = (doc.body && (doc.body.innerText || doc.body.textContent)) || "";
          texts.push(panelText);

          // Heuristic: consider the send "successful" only if the needle is no longer present
          // in the prompt input (Lexical editor) but appears somewhere in the panel DOM.
          const editor = doc.querySelector('[data-lexical-editor="true"]');
          const editorText = (editor && (editor.innerText || editor.textContent)) || "";
          
          const inPanel = panelText.includes(needle);
          const inEditor = editorText.includes(needle);
          
          if (inPanel && !inEditor) return resolve({ found: true, details: "Found in panel, cleared from editor" });
          if (inPanel && inEditor) {
             // It's in both: implies user typed it but it wasn't validly submitted yet (or duplicated?)
             // We wait...
          }
          if (!inPanel && !inEditor) {
             // Gone from editor, not in panel? Maybe loading...
          }
        }
        if (Date.now() - start >= timeoutMs) {
             // Timeout. Check final state.
             const finalFrame = document.querySelector(
              'iframe[id="antigravity.agentPanel"], iframe[name="antigravity.agentPanel"], iframe[src*="cascade-panel.html"], iframe[src*="agentPanel"]'
            );
            const finalDoc = finalFrame && finalFrame.contentDocument ? finalFrame.contentDocument : null;
            if (finalDoc) {
                 const pText = (finalDoc.body && (finalDoc.body.innerText || finalDoc.body.textContent)) || "";
                 const ed = finalDoc.querySelector('[data-lexical-editor="true"]');
                 const eText = (ed && (ed.innerText || ed.textContent)) || "";
                 return resolve({ 
                     found: false, 
                     inPanel: pText.includes(needle), 
                     inEditor: eText.includes(needle),
                     details: "Timeout" 
                 });
            }
            return resolve({ found: false, details: "No doc found at timeout" });
        }
      } catch {
        if (Date.now() - start >= timeoutMs) return resolve({ found: false, details: "Error during poll" });
      }
      setTimeout(poll, 100);
    };
    poll();
  });
})()`;

    try {
        const res = await tryEvaluate(port, target, expr);
        // Map the complex result back to VerifyResult
        if (res && typeof res === 'object') {
            const found = !!res.found;
            return { ok: true, found, needle, details: res.details, inEditor: res.inEditor, inPanel: res.inPanel };
        }
        return { ok: true, found: !!res, needle };
    } catch {
        return { ok: false, found: false, needle };
    }
}

export async function trySendViaCDP(
    prompt: string,
    options: { portStart: number; portEnd: number; verifyTimeoutMs?: number; verifyNeedle?: string },
): Promise<{
    ok: boolean;
    error?: string;
    details?: InjectResult;
    port?: number;
    target?: { title?: string; url?: string; id?: string };
    verify?: VerifyResult;
}> {
    const ports: number[] = [];
    for (let p = options.portStart; p <= options.portEnd; p += 1) ports.push(p);

    for (const port of ports) {
        let targets: TargetInfo[] = [];
        try {
            targets = await listTargets(port);
        } catch {
            continue;
        }

        const candidates = targets
            .filter((t) => t.type === "page" && t.webSocketDebuggerUrl)
            .sort((a, b) => scoreTarget(b) - scoreTarget(a));
        if (candidates.length === 0) continue;

        let chosen: TargetInfo | null = null;
        const detections: Array<{ t: TargetInfo; det: DetectResult }> = [];
        for (const t of candidates) detections.push({ t, det: await detectEditor(port, t) });

        const focused = detections.find((d) => d.det.ok && d.det.hasEditor && d.det.hasFocus);
        if (focused) {
            chosen = focused.t;
        } else {
            const anyEditor = detections.find((d) => d.det.ok && d.det.hasEditor);
            if (anyEditor) chosen = anyEditor.t;
        }
        if (!chosen) chosen = candidates[0];

        const injected = await injectPrompt(port, chosen, prompt);
        if (injected && injected.ok) {
            if (injected.debug && Array.isArray(injected.debug)) {
                // We don't have direct access to 'out' channel here, but 'console.log' might be captured if we are lucky.
                // Better: return it in details and let the caller log it.
            }
            const verify = await verifyPromptInPanel(
                port,
                chosen,
                prompt,
                options.verifyTimeoutMs ?? 2500,
                options.verifyNeedle,
            );
            if (!verify.ok || !verify.found) {
                const failReason = verify.details ? verify.details :
                    (verify.inEditor ? "Stuck in editor" : (verify.inPanel ? "Found in panel but verify logic failed" : "Not found anywhere"));

                if (verify.inEditor) {
                    // This is distinct from "Not found". Use a specific warning.
                    console.log(`[CDP Verify] Failed: Needle "${verify.needle}" still in editor.`);
                }

                return {
                    ok: false,
                    error: `Verification failed: ${failReason}`,
                    details: injected,
                    port,
                    target: { title: chosen.title, url: chosen.url, id: chosen.id },
                    verify,
                };
            }
            return {
                ok: true,
                details: { ...injected, debug: injected.debug },
                port,
                target: { title: chosen.title, url: chosen.url, id: chosen.id },
                verify,
            };
        }

        // If we couldn't find an editor on the "best" target, try the next ones quickly.
        if (!injected.hasEditor) {
            for (const t of candidates.slice(1, 4)) {
                const tryInject = await injectPrompt(port, t, prompt);
                if (tryInject.ok) {
                    // Log debug info if available
                    if (tryInject.debug && Array.isArray(tryInject.debug)) {
                        tryInject.debug.forEach(line => console.log(`[CDP Debug] ${line}`));
                    } else if ((tryInject as any).debug) {
                        // fallback if types are weird
                        console.log(`[CDP Debug] ${(tryInject as any).debug}`);
                    }

                    const verify = await verifyPromptInPanel(
                        port,
                        t,
                        prompt,
                        options.verifyTimeoutMs ?? 2500,
                        options.verifyNeedle,
                    );
                    if (!verify.ok || !verify.found) {
                        return {
                            ok: false,
                            error: "CDP injected but verification failed (prompt not observed in panel DOM).",
                            details: tryInject,
                            port,
                            target: { title: t.title, url: t.url, id: t.id },
                            verify,
                        };
                    }
                    return {
                        ok: true,
                        details: tryInject,
                        port,
                        target: { title: t.title, url: t.url, id: t.id },
                        verify,
                    };
                }
            }
        }
    }

    return {
        ok: false,
        error:
            "CDP target not found or injection failed. Launch Antigravity with --remote-debugging-port=9000 and retry.",
    };
}
