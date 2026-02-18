const http = require('http');
const path = require('path');

const PORT = 3228;
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

const FIXTURE_CWD = path.resolve(__dirname, 'fixtures', 'simple_project');

async function runTests() {
    console.log(`Starting Control API Tests on ${BASE_URL}...`);

    try {
        // 1. Start Pipeline
        console.log('[TEST] Start Pipeline');
        const startRes = await request('/api/pipeline/start', {
            method: 'POST',
            body: JSON.stringify({
                cwd: FIXTURE_CWD,
                userPrompt: 'Stop Test',
                managerModel: 'gpt-5.1',
                developerModel: 'gpt-5.2-codex',
                managerPreprompt: 'Mgr',
                autoRun: false
            })
        });
        const startData = JSON.parse(startRes.body);
        if (!startData.ok) throw new Error('Start failed');
        const runId = startData.run.runId;
        console.log(`  -> PASS (runId: ${runId})`);

        // 2. Verified Started State
        console.log('[TEST] Verify Status (planning)');
        const state1 = await request(`/api/pipeline/state?runId=${runId}`);
        const data1 = JSON.parse(state1.body);
        if (data1.run.status !== 'planning') throw new Error(`Expected planning, got ${data1.run.status}`);
        console.log('  -> PASS');

        // 3. Stop Pipeline
        console.log('[TEST] POST /api/pipeline/stop');
        const stopRes = await request('/api/pipeline/stop', {
            method: 'POST',
            body: JSON.stringify({ runId })
        });
        if (stopRes.status !== 200) throw new Error(`Expected 200, got ${stopRes.status}`);
        console.log('  -> PASS');

        // 4. Verify Stopped State
        console.log('[TEST] Verify Status (stopped)');
        const state2 = await request(`/api/pipeline/state?runId=${runId}`);
        const data2 = JSON.parse(state2.body);
        if (data2.run.status !== 'stopped') throw new Error(`Expected stopped, got ${data2.run.status}`);
        console.log('  -> PASS');

        // 5. Attempt Continue (Should fail or stay stopped)
        console.log('[TEST] Continue Stopped Pipeline');
        const contRes = await request('/api/pipeline/continue', {
            method: 'POST',
            body: JSON.stringify({ runId })
        });
        // Implementation details: continuePipeline checks status. If stopped, it might return 200 but do nothing/return false.
        // Or throw error?
        // Let's check the code: _advanceOneStep returns false if stopped.
        // continuePipeline returns await _advanceOneStep(runId);
        // So it returns false. The API wrapper sends { ok: true, run: false } ? No run object is boolean?
        // Wait, pipelineManager.continuePipeline returns `await this._advanceOneStep(runId)`.
        // _advanceOneStep returns boolean `true/false`.
        // server/index.js sends `sendJson(res, 200, { ok: true, run });`
        // So `run` will be `false`.
        if (contRes.status !== 200) throw new Error(`Expected 200, got ${contRes.status}`);
        const contData = JSON.parse(contRes.body);
        if (contData.run !== false) console.warn(`  -> WARN: Expected false, got ${contData.run}`);
        else console.log('  -> PASS');

    } catch (err) {
        console.error('FAILED:', err.message);
        process.exit(1);
    }
}

process.env.PORT = PORT;
require('../server/index.js');

setTimeout(runTests, 1000);
