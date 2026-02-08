const readline = require('readline');

// Standard JSON-RPC 2.0 simulation for Codex App Server
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
});

function send(msg) {
    console.log(JSON.stringify(msg));
}

rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
        msg = JSON.parse(line);
    } catch (e) {
        return;
    }

    const { id, method, params } = msg;

    if (method === 'initialize') {
        send({ id, result: { serverInfo: { name: 'mock-codex', version: '1.0.0' } } });
    }
    else if (method === 'model/list') {
        send({ id, result: { models: [{ id: 'mock-gpt-5' }, { id: 'mock-gpt-4' }] } });
    }
    else if (method === 'thread/start' || method === 'thread/resume') {
        send({ id, result: { thread: { id: params.threadId || 'mock-thread-123' } } });
    }
    else if (method === 'turn/start') {
        // 1. Acknowledge start
        const turnId = 'mock-turn-' + Date.now();
        send({ id, result: { turn: { id: turnId } } });

        // 2. Notify turn started
        send({ method: 'turn/started', params: { threadId: params.threadId, turn: { id: turnId } } });

        // 3. Stream content (simulated)
        const predefinedResponse = "Hello! I am a MOCK Codex agent. I received your prompt: \"" + (params.input?.[0]?.text || "") + "\"";
        const chunks = predefinedResponse.split(/(.{10})/g).filter(Boolean); // split into chunks

        let i = 0;
        const interval = setInterval(() => {
            if (i >= chunks.length) {
                clearInterval(interval);
                // 4. Complete
                send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: predefinedResponse } } });
                send({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } });
            } else {
                send({ method: 'item/agentMessage/delta', params: { delta: chunks[i] } });
                i++;
            }
        }, 100);
    }
});
