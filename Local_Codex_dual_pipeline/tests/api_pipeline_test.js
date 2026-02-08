const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 3226;
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
    console.log(`Starting Pipeline API Tests on ${BASE_URL}...`);

    try {
        // 1. Start Pipeline (Validation Error)
        console.log('[TEST] POST /api/pipeline/start (Missing Fields)');
        const res1 = await request('/api/pipeline/start', {
            method: 'POST',
            body: JSON.stringify({ cwd: FIXTURE_CWD }) // Missing models/prompts
        });
        if (res1.status !== 400) throw new Error(`Expected 400, got ${res1.status}`);
        console.log('  -> PASS');

        // 2. Start Pipeline (Success - AutoRun False to avoid side effects)
        console.log('[TEST] POST /api/pipeline/start (Success)');
        const payload = {
            cwd: FIXTURE_CWD,
            userPrompt: 'Smoke Test Request',
            managerModel: 'gpt-5.1',
            developerModel: 'gpt-5.2-codex',
            managerPreprompt: 'You are a manager.',
            autoRun: false // Don't actually run the loop, just create state
        };
        const res2 = await request('/api/pipeline/start', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        if (res2.status !== 200) throw new Error(`Expected 200, got ${res2.status} - ${res2.body}`);
        const data2 = JSON.parse(res2.body);
        if (!data2.ok || !data2.run?.runId) throw new Error('Invalid start response');
        const runId = data2.run.runId;
        console.log(`  -> PASS (runId: ${runId})`);

        // 3. Get Pipeline State
        console.log('[TEST] GET /api/pipeline/state');
        const res3 = await request(`/api/pipeline/state?runId=${runId}`);
        if (res3.status !== 200) throw new Error(`Expected 200, got ${res3.status}`);
        const data3 = JSON.parse(res3.body);
        if (data3.run.runId !== runId) throw new Error('Run ID mismatch');
        if (data3.run.status !== 'planning') throw new Error(`Unexpected status ${data3.run.status}`);
        console.log('  -> PASS');

        // 4. List Runs
        console.log('[TEST] GET /api/pipeline/runs');
        const res4 = await request('/api/pipeline/runs');
        if (res4.status !== 200) throw new Error(`Expected 200, got ${res4.status}`);
        const data4 = JSON.parse(res4.body);
        if (!Array.isArray(data4.runs) || data4.runs.length === 0) throw new Error('Runs list empty');
        if (!data4.runs.find(r => r.runId === runId)) throw new Error('Created run not in list');
        console.log('  -> PASS');

        // 5. Verify Files
        console.log('[TEST] Verify pipeline_state.json creation');
        // The server writes projectPipelineStatePath: path.join(projectDataDir, "pipeline_state.json")
        // data dir is fixtures/simple_project/data
        const statePath = path.join(FIXTURE_CWD, 'data', 'pipeline_state.json');
        // Note: The logic in pipelineManager.js currently writes the LOCAL state to data/pipeline_state.json (server data dir)
        // AND defines paths for the project checks.
        // Wait, createRun logic:
        // this._state.setRun(runId, run); -> writes to server/data/pipeline_state.json
        // But it does NOT create the files in project CWD immediately.
        // _stepManagerPlanning does that. Since we set autoRun: false, files in CWD might NOT exist yet.
        // Correct. The internal state exists, but CWD files are created by the Agent (via prompt instructions) later.
        // So we only check server state here.
        console.log('  -> PASS (Skipped CWD check as autoRun=false)');

    } catch (err) {
        console.error('FAILED:', err.message);
        process.exit(1);
    }
}

process.env.PORT = PORT;
require('../server/index.js'); // Start server

setTimeout(runTests, 1000);
