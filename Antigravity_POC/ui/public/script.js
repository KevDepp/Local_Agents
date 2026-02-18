const API_BASE = '/api';

// Elements
const healthStatus = document.getElementById('health-status');
const diagStatus = document.getElementById('diag-status');
const cdpStatus = document.getElementById('cdp-status');
const pingBtn = document.getElementById('ping-btn');
const sendBtn = document.getElementById('send-btn');
const form = document.getElementById('send-form');
const promptInput = document.getElementById('prompt-input');
const newThreadCheck = document.getElementById('new-thread-check');
const notifyCheck = document.getElementById('notify-check');
const debugCheck = document.getElementById('debug-check');
const verifyNeedleInput = document.getElementById('verify-needle');
const insertTokenBtn = document.getElementById('insert-token-btn');
const responseOutput = document.getElementById('response-output');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const copyCurlBtn = document.getElementById('copy-curl-btn');

// State
let isConnected = false;
let lastPayload = null;

// Helpers
const updateStatus = (element, text, isOk) => {
    element.textContent = text;
    element.className = `status-item ${isOk ? 'ok' : 'error'}`;
};

const appendHistory = (entry) => {
    const li = document.createElement('li');
    li.className = entry.ok ? 'history-success' : 'history-fail';
    li.innerHTML = `
        <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
        <span class="req-id">[${entry.requestId}]</span>
        <span class="summary">${entry.summary}</span>
    `;
    historyList.prepend(li); // Newest first

    // Persist
    const history = JSON.parse(localStorage.getItem('sendHistory') || '[]');
    history.unshift(entry);
    if (history.length > 50) history.pop();
    localStorage.setItem('sendHistory', JSON.stringify(history));
};

const loadHistory = () => {
    const history = JSON.parse(localStorage.getItem('sendHistory') || '[]');
    // Render only (do not re-save, avoid duplicating entries in localStorage).
    historyList.innerHTML = history.map(entry => `
        <li class="${entry.ok ? 'history-success' : 'history-fail'}">
            <span class="timestamp">${new Date(entry.timestamp).toLocaleTimeString()}</span>
            <span class="req-id">[${entry.requestId}]</span>
            <span class="summary">${entry.summary}</span>
        </li>
    `).join('');
};

const generateToken = () => {
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
    return `AG_UI_${ts}_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
};

const generateRequestId = () => {
    const ts = Date.now();
    const rnd = Math.random().toString(36).slice(2, 8);
    return `req_${ts}_${rnd}`;
};

// Actions
const checkHealth = async () => {
    try {
        const res = await fetch(`${API_BASE}/health`);
        const data = await res.json();
        if (data.ok) {
            updateStatus(healthStatus, `Health: OK (${data.pid})`, true);
            isConnected = true;
            sendBtn.disabled = false;
        } else {
            updateStatus(healthStatus, 'Health: Down', false);
            isConnected = false;
            sendBtn.disabled = true;
        }
    } catch (e) {
        updateStatus(healthStatus, 'Health: Unreachable', false);
        // If diagnostics are okay, we might still be able to send (partial failure)
        if (diagStatus.textContent.includes('commands')) {
            console.warn('Health failed but diagnostics ok, allowing send');
            isConnected = true;
            sendBtn.disabled = false;
        } else {
            isConnected = false;
            sendBtn.disabled = true;
        }
    }
};

const checkDiagnostics = async () => {
    try {
        const res = await fetch(`${API_BASE}/diagnostics`);
        const data = await res.json();
        if (data.commands) {
            const count = Array.isArray(data.commands) ? data.commands.length : Object.keys(data.commands).length;
            diagStatus.textContent = `Diagnostics: ${count} commands`;
        }
    } catch (e) {
        diagStatus.textContent = 'Diagnostics: Error';
    }
};

const checkCdp = async () => {
    try {
        const res = await fetch(`${API_BASE}/cdp`);
        const data = await res.json();
        if (data.ok) {
            updateStatus(cdpStatus, `CDP: OK (${data.port || 9000})`, true);
        } else {
            updateStatus(cdpStatus, `CDP: Down (${data.port || 9000})`, false);
        }
    } catch {
        updateStatus(cdpStatus, 'CDP: Unreachable', false);
    }
};

const sendPing = async () => {
    try {
        await fetch(`${API_BASE}/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'PING from UI' })
        });
    } catch (e) {
        console.error('Ping failed', e);
    }
};

const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isConnected) return;

    const prompt = promptInput.value;
    const newThread = newThreadCheck.checked;
    const notify = notifyCheck.checked;
    const debug = debugCheck.checked;
    const verifyNeedle = verifyNeedleInput.value;
    const requestId = generateRequestId();

    sendBtn.disabled = true;
    responseOutput.textContent = 'Sending...';

    const payload = {
        prompt,
        newConversation: newThread,
        notify,
        debug,
        verifyNeedle: verifyNeedle || undefined,
        requestId
    };
    lastPayload = payload;

    try {
        const res = await fetch(`${API_BASE}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        responseOutput.textContent = JSON.stringify(data, null, 2);

        const summary = data.ok ? 'Sent OK' : `Error: ${JSON.stringify(data.error)}`;
        appendHistory({
            timestamp: Date.now(),
            requestId,
            ok: data.ok,
            summary
        });

        if (data.ok) {
            promptInput.value = ''; // Clear only on success
            if (verifyNeedle) verifyNeedleInput.value = '';
        }

    } catch (e) {
        responseOutput.textContent = `Network Error: ${e.message}`;
        appendHistory({
            timestamp: Date.now(),
            requestId,
            ok: false,
            summary: 'Network Error'
        });
    } finally {
        sendBtn.disabled = false;
    }
};

const copyCurl = async () => {
    if (!lastPayload) return;
    const payload = JSON.stringify(lastPayload);
    // Bash-friendly single-quote escaping: ' -> '\'' (close/open quotes around an escaped single quote)
    const payloadBash = payload.replace(/'/g, "'\\''");
    const cmd = `curl -s -X POST http://127.0.0.1:17400/api/send -H 'Content-Type: application/json' -d '${payloadBash}'`;
    try {
        await navigator.clipboard.writeText(cmd);
        responseOutput.textContent = `Copied to clipboard:\\n\\n${cmd}`;
    } catch {
        responseOutput.textContent = `Copy failed. Command:\\n\\n${cmd}`;
    }
};

// Init
window.addEventListener('load', () => {
    loadHistory();
    setInterval(checkHealth, 5000);
    setInterval(checkDiagnostics, 10000);
    checkHealth();
    checkDiagnostics();
    checkCdp();

    pingBtn.addEventListener('click', sendPing);
    insertTokenBtn.addEventListener('click', () => {
        const token = generateToken();
        verifyNeedleInput.value = token;
        const currentPrompt = promptInput.value;
        promptInput.value = `TOKEN: ${token}\n${currentPrompt}`;
    });

    clearHistoryBtn.addEventListener('click', () => {
        localStorage.removeItem('sendHistory');
        loadHistory();
    });

    copyCurlBtn.addEventListener('click', copyCurl);

    form.addEventListener('submit', handleSubmit);
});
