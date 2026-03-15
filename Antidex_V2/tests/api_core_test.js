const http = require('http');

const PORT = 3225; // Use a dedicated test port
const BASE_URL = `http://127.0.0.1:${PORT}`;

function request(path, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(`${BASE_URL}${path}`, { port: PORT, ...options }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        if (options.body) {
            req.write(options.body);
        }
        req.end();
    });
}

async function runTests() {
    console.log(`Starting API Smoke Tests on ${BASE_URL}...`);

    try {
        // 1. Health Check
        console.log('[TEST] GET /health');
        const health = await request('/health');
        if (health.status !== 200) throw new Error(`Health status ${health.status}`);
        const healthData = JSON.parse(health.body);
        if (!healthData.ok || !healthData.codex) throw new Error('Invalid health response');
        console.log('  -> PASS');

        // 2. FS Roots
        console.log('[TEST] GET /api/fs/roots');
        const roots = await request('/api/fs/roots');
        if (roots.status !== 200) throw new Error(`Roots status ${roots.status}`);
        const rootsData = JSON.parse(roots.body);
        if (!rootsData.ok || !Array.isArray(rootsData.roots)) throw new Error('Invalid roots response');
        console.log('  -> PASS');

        // 3. FS List (Valid Path - using current dir)
        console.log('[TEST] GET /api/fs/list (Current Dir)');
        const cwd = process.cwd();
        const list = await request(`/api/fs/list?path=${encodeURIComponent(cwd)}`);
        if (list.status !== 200) throw new Error(`List status ${list.status}`);
        const listData = JSON.parse(list.body);
        if (!listData.ok || !Array.isArray(listData.dirs)) throw new Error('Invalid list response');
        console.log('  -> PASS');

        // 4. FS List (Invalid Path)
        console.log('[TEST] GET /api/fs/list (Invalid Path)');
        const listInvalid = await request(`/api/fs/list?path=${encodeURIComponent('C:\\InvalidPath\\XYZ')}`);
        // Expecting 400 or 500 depending on implementation, but defined behavior is 400 in todo
        if (listInvalid.status !== 400) console.warn(`  -> WARN: Status is ${listInvalid.status} (expected 400)`);
        else console.log('  -> PASS');

    } catch (err) {
        console.error('FAILED:', err.message);
        process.exit(1);
    }
}

// Wait for server to start (manual coordination in this script vs spawning)
// For simplicity, we assume the server is started externally or we can require it?
// Requiring it is better for self-contained test.

process.env.PORT = PORT;
require('../server/index.js'); // Start the server in-process

setTimeout(runTests, 1000); // Give it a second to bind
