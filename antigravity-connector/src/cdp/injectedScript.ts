export function buildDetectScript(): string {
  return `(function () {
  try {
    const frame = document.querySelector(
      'iframe[id="antigravity.agentPanel"], iframe[name="antigravity.agentPanel"], iframe[src*="cascade-panel.html"], iframe[src*="agentPanel"]'
    );
    const doc = frame && frame.contentDocument ? frame.contentDocument : document;
    const editor = doc.querySelector('[data-lexical-editor="true"]');
    return {
      hasEditor: !!editor,
      hasFocus: !!(document && document.hasFocus && document.hasFocus()),
      usedIframe: !!(frame && frame.contentDocument)
    };
  } catch (e) {
    return { hasEditor: false, hasFocus: false, usedIframe: false, error: String(e) };
  }
})()`;
}

export function buildInjectScript(prompt: string): string {
  const safePrompt = JSON.stringify(String(prompt ?? ""));
  return `(async function (prompt) {
  try {
    const result = {
      ok: false,
      usedIframe: false,
      hasEditor: false,
      hasSubmit: false,
      submitDisabled: undefined,
      inserted: false,
      submitted: false,
      debug: []
    };
    const frame = document.querySelector(
      'iframe[id="antigravity.agentPanel"], iframe[name="antigravity.agentPanel"], iframe[src*="cascade-panel.html"], iframe[src*="agentPanel"]'
    );
    const doc = frame && frame.contentDocument ? (result.usedIframe = true, frame.contentDocument) : document;
    const editors = Array.from(doc.querySelectorAll('[data-lexical-editor="true"]'));
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null;
      return r.width > 0 && r.height > 0 && (!s || (s.visibility !== 'hidden' && s.display !== 'none'));
    };
    const editor = editors.filter(isVisible)[0] || editors[0];
    result.hasEditor = !!editor;
    if (!editor) return result;

    const editable = (editor.querySelector && editor.querySelector('[contenteditable="true"]')) || editor;

    // Place caret inside the editor (Lexical often ignores execCommand if selection isn't within).
    try {
      editable.focus();
      if (doc.getSelection && doc.createRange) {
        const sel = doc.getSelection();
        const range = doc.createRange();
        range.selectNodeContents(editable);
        range.collapse(false);
        sel && sel.removeAllRanges();
        sel && sel.addRange(range);
      }
    } catch {}

    const needle = String(prompt || '').trim().slice(0, 16);

    // Clear any existing content to avoid "prompt duplication" across repeated /send calls.
    // Use execCommand delete (preferred) because it notifies the editor model more reliably than DOM deleteContents.
    try {
      editable.focus();
      if (doc.execCommand) {
        doc.execCommand('selectAll', false, null);
        doc.execCommand('delete', false, null);
      }
    } catch {}

    // Insert text in a way that Lexical typically picks up (execCommand insertText).
    // Fall back to DOM Range insertion if execCommand is blocked in this build.
    let inserted = false;
    let usedExecCommand = false;
    try {
      editable.focus();
      if (doc.execCommand) {
        const ok = doc.execCommand('insertText', false, prompt);
        const txtNow = (editor.textContent || '').trim();
        inserted = !!ok && (!!needle ? txtNow.includes(needle) : txtNow.length > 0);
        usedExecCommand = !!ok;
      }
    } catch {}

    if (!inserted) {
      try {
        if (doc.getSelection && doc.createRange) {
          const sel = doc.getSelection();
          const range = doc.createRange();
          const p = editor.querySelector('p') || editor;
          range.selectNodeContents(p);
          range.collapse(false);
          sel && sel.removeAllRanges();
          sel && sel.addRange(range);
          range.insertNode(doc.createTextNode(prompt));
          range.collapse(false);
          const txtNow = (editor.textContent || '').trim();
          inserted = !!txtNow && (!!needle ? txtNow.includes(needle) : true);
        }
      } catch {}
    }

    // Help the webview/app notice the change (some builds keep the Send button disabled without an input event).
    // Only dispatch manual events when we did NOT use execCommand (to avoid double insertion).
    if (inserted) {
      if (!usedExecCommand) {
        try {
          const before = new InputEvent('beforeinput', { inputType: 'insertText', data: prompt, bubbles: true, cancelable: true });
          const input = new InputEvent('input', { inputType: 'insertText', data: prompt, bubbles: true });
          editable.dispatchEvent(before);
          editable.dispatchEvent(input);
        } catch {}
      }

      // Always dispatch a plain bubbling input/change so reactive state can enable the Send button,
      // without risking a second text insertion.
      try { editable.dispatchEvent(new Event('input', { bubbles: true })); } catch {}
      try { editable.dispatchEvent(new Event('change', { bubbles: true })); } catch {}
    }

    result.inserted = inserted;

    const findSubmit = () => {
      const candidates = Array.from(doc.querySelectorAll('button, [role="button"], input[type="submit"], [data-testid*="send"], [aria-label*="send"]')).filter(isVisible);
      result.debug = result.debug || [];
      result.debug.push('Found ' + candidates.length + ' visible candidates');
      
      const editorRect = editor.getBoundingClientRect();
      const score = (el) => {
        let s = 0;
        const aria = (el.getAttribute && el.getAttribute('aria-label')) || '';
        const title = (el.getAttribute && el.getAttribute('title')) || '';
        const testId = (el.getAttribute && el.getAttribute('data-testid')) || '';
        const txt = ((el.innerText || el.textContent || '') + '').trim();
        const blob = (aria + ' ' + title + ' ' + txt + ' ' + testId).toLowerCase();
        
        // Debug logging for candidate analysis
        // result.debug.push('Unknown candidate: ' + (txt ? txt.slice(0, 10) : 'icon') + ' ' + blob.slice(0, 20));

        if (blob.includes('send') || blob.includes('submit') || blob.includes('envoyer')) s += 10;
        if (txt.trim().toLowerCase() === 'send') s += 15;
        
        // Icon-only buttons often have an SVG inside
        if (el.querySelector('svg')) s += 5;

        const r = el.getBoundingClientRect();
        // Strongly prefer buttons visibly "inside" or immediately adjacent to the editor area
        // (e.g. within 50px vertical, to the right)
        const dx = (r.x) - (editorRect.x + editorRect.width); // Positive if to the right
        const dy = Math.abs((r.y + r.height / 2) - (editorRect.y + editorRect.height / 2));
        
        if (dy < 50 && dx > -50 && dx < 200) s += 20; // High bonus for "Right of editor" placement
        
        if (el.disabled || el.getAttribute && el.getAttribute('disabled') != null) s -= 50; // Penalize disabled heavily
        
        return s;
      };
      candidates.sort((a, b) => score(b) - score(a));
      
      if (candidates.length > 0) {
          const best = candidates[0];
           result.debug.push('Best candidate: ' + (best.innerText || 'icon') + ' score=' + score(best));
      }
      return candidates[0];
    };

    const click = (el) => {
      try { el.focus && el.focus(); } catch {}
      try {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      } catch {}
      try { el.click && el.click(); return true; } catch { return false; }
    };

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isDisabled = (el) => !!(el && (el.disabled || (el.getAttribute && el.getAttribute('disabled') != null)));
    const getEditorText = () => ((editor.innerText || editor.textContent || '') + '').trim();
    const waitFor = async (fn, timeoutMs, intervalMs) => {
      const start = Date.now();
      const max = Math.max(100, timeoutMs || 0);
      const step = Math.max(20, intervalMs || 0);
      while (Date.now() - start < max) {
        try { if (fn()) return true; } catch {}
        await sleep(step);
      }
      return false;
    };
    const waitForSubmitEnabled = async () => {
      if (!submit) return false;
      if (!isDisabled(submit)) return true;
      return await waitFor(() => !isDisabled(submit), 700, 50);
    };
    const waitForSent = async () => {
      const before = getEditorText();
      if (!before) return true;
      return await waitFor(() => {
        const now = getEditorText();
        return now.length === 0 || now.length < Math.max(3, Math.min(10, Math.floor(before.length / 4)));
      }, 800, 50);
    };

    const submit = findSubmit();
    result.hasSubmit = !!submit;
    try { result.submitDisabled = !!(submit && (submit.disabled || (submit.getAttribute && submit.getAttribute('disabled') != null))); } catch {}
    if (submit) {
      const dispatchEnter = (ctrl) => {
        try {
          const down = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, ctrlKey: !!ctrl });
          const up = new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, ctrlKey: !!ctrl });
          editable.dispatchEvent(down);
          editable.dispatchEvent(up);
          return true;
        } catch {
          return false;
        }
      };

      await waitForSubmitEnabled();
      try { result.submitted = click(submit); } catch {}

      let sent = await waitForSent();
      if (!sent) {
        dispatchEnter(false);
        sent = await waitForSent();
      }
      if (!sent) {
        dispatchEnter(true);
        sent = await waitForSent();
      }
      if (!sent) {
        try { click(submit); } catch {}
        sent = await waitForSent();
      }
      result.submitted = sent;
    } else {
      // Key fallback: try Enter then Ctrl+Enter.
      // Key fallback: try Enter then Ctrl+Enter on the editor AND its children (if contenteditable)
      const dispatchEnter = (target, ctrl) => {
        try {
          const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, ctrlKey: !!ctrl };
          target.dispatchEvent(new KeyboardEvent('keydown', opts));
          target.dispatchEvent(new KeyboardEvent('keypress', opts));
          target.dispatchEvent(new KeyboardEvent('keyup', opts));
          return true;
        } catch {
          return false;
        }
      };
      
      const target = editor.querySelector('[contenteditable="true"]') || editor;
      dispatchEnter(target, false);
      let sent = await waitForSent();
      if (!sent) {
        dispatchEnter(target, true);
        sent = await waitForSent();
      }
      result.submitted = sent;
    }

    result.ok = !!result.inserted && !!result.submitted;
    return result;
  } catch (e) {
    return { ok: false, error: String(e) };
  }
})(${safePrompt})`;
}
