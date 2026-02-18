const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

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

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'antidex-fixture-'));
const FIXTURE_CWD = TEST_ROOT;

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

        // 5. Verify Bootstrap Files in CWD
        console.log('[TEST] Verify bootstrap skeleton in CWD');
        const expectedPaths = [
            'doc/DOCS_RULES.md',
            'doc/INDEX.md',
            'doc/SPEC.md',
            'doc/TODO.md',
            'doc/TESTING_PLAN.md',
            'doc/DECISIONS.md',
            'doc/GIT_WORKFLOW.md',
            'agents/manager.md',
            'agents/developer_codex.md',
            'agents/developer_antigravity.md',
            'agents/AG_cursorrules.md',
            'data/pipeline_state.json',
            'data/tasks',
            'data/mailbox/to_developer_codex',
            'data/mailbox/from_developer_codex',
            'data/mailbox/to_developer_antigravity',
            'data/mailbox/from_developer_antigravity',
            'data/antigravity_runs',
            'data/AG_internal_reports',
            'data/turn_markers',
            'data/recovery_log.jsonl'
        ];
        for (const rel of expectedPaths) {
            const full = path.join(FIXTURE_CWD, rel);
            if (!fs.existsSync(full)) throw new Error(`Missing expected bootstrap path: ${rel}`);
        }
        const statePath = path.join(FIXTURE_CWD, 'data', 'pipeline_state.json');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (!state.run_id || state.run_id !== runId) throw new Error('pipeline_state.json run_id mismatch');
        console.log('  -> PASS');

        // 6. Verify task file API returns "not exists" when no task yet
        console.log('[TEST] GET /api/pipeline/file (task)');
        const res6 = await request(`/api/pipeline/file?runId=${runId}&name=task`);
        if (res6.status !== 200) throw new Error(`Expected 200, got ${res6.status}`);
        const data6 = JSON.parse(res6.body);
        if (!data6.ok) throw new Error('Invalid task file response');
        if (data6.exists !== false) throw new Error('Expected task file to be missing');
        console.log('  -> PASS');

    } catch (err) {
        console.error('FAILED:', err.message);
        process.exit(1);
    } finally {
        if (process.env.KEEP_TEST_FIXTURE === '1') {
            console.log(`Keeping fixture at ${TEST_ROOT}`);
        } else {
            try {
                fs.rmSync(TEST_ROOT, { recursive: true, force: true });
            } catch (e) {
                console.warn(`WARN: failed to cleanup fixture ${TEST_ROOT}: ${e.message}`);
            }
        }
    }
}

process.env.PORT = PORT;
require('../server/index.js'); // Start server

setTimeout(runTests, 1000);
