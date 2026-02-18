const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 17400;
const CONNECTOR_URL = 'http://127.0.0.1:17375';
const REQUEST_TIMEOUT_MS = 10_000;
const CDP_VERSION_URL = 'http://127.0.0.1:9000/json/version';

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Proxy helper
async function proxyRequest(req, res, targetPath, method = 'GET', body = null) {
    try {
        const url = `${CONNECTOR_URL}${targetPath}`;
        const options = {
            method,
            headers: {},
            timeout: REQUEST_TIMEOUT_MS
        };

        if (body) {
            // Force UTF-8 encoding for the body
            const jsonString = JSON.stringify(body);
            options.body = Buffer.from(jsonString, 'utf8');
            options.headers['Content-Type'] = 'application/json; charset=utf-8';
        }

        const response = await fetch(url, options);
        const contentType = String(response.headers.get('content-type') || '');
        const text = await response.text();

        if (contentType.toLowerCase().includes('application/json')) {
            try {
                const data = text ? JSON.parse(text) : {};
                res.status(response.status).json(data);
                return;
            } catch {
                // fall through and return plain text
            }
        }

        res.status(response.status).type('text/plain; charset=utf-8').send(text);
    } catch (error) {
        console.error(`Proxy error for ${targetPath}:`, error);
        res.status(502).json({
            error: 'Connector unreachable',
            details: error.message
        });
    }
}

// Endpoints
app.get('/api/health', (req, res) => proxyRequest(req, res, '/health'));
app.get('/api/diagnostics', (req, res) => proxyRequest(req, res, '/diagnostics'));

app.get('/api/cdp', async (req, res) => {
    try {
        const response = await fetch(CDP_VERSION_URL, { method: 'GET', timeout: REQUEST_TIMEOUT_MS });
        if (!response.ok) {
            res.status(200).json({ ok: false, port: 9000, status: response.status });
            return;
        }
        const text = await response.text();
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
        res.status(200).json({ ok: true, port: 9000, version: data });
    } catch (e) {
        res.status(200).json({ ok: false, port: 9000, error: e.message });
    }
});

app.post('/api/ping', (req, res) => {
    proxyRequest(req, res, '/ping', 'POST', req.body);
});

app.post('/api/send', (req, res) => {
    // Generate requestId if missing (though client should send it)
    const payload = { ...req.body };
    if (!payload.requestId) {
        payload.requestId = `ui_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    }

    proxyRequest(req, res, '/send', 'POST', payload);
});

app.listen(PORT, () => {
    console.log(`UI Server running at http://localhost:${PORT}`);
    console.log(`Proxying to Connector at ${CONNECTOR_URL}`);
});
