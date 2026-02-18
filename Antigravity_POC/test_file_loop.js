const http = require('http');
const fs = require('fs');
const path = require('path');

const RESPONSE_FILE = path.join(__dirname, 'response.txt');

// 1. Cleanup previous run
if (fs.existsSync(RESPONSE_FILE)) {
    fs.unlinkSync(RESPONSE_FILE);
    console.log('Cleaned up previous response file.');
}

// 2. Prepare prompt
const promptText = `
SYSTEM INSTRUCTION: You are part of a test loop.
TASK: Calculate 123 * 456.
OUTPUT: Write the result ONLY (no other text) into the file: ${RESPONSE_FILE.replace(/\\/g, '/')}
`;

const postData = JSON.stringify({
    prompt: promptText
});

const options = {
    hostname: '127.0.0.1',
    port: 17375,
    path: '/send',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData, 'utf8')
    }
};

// 3. Send Prompt
console.log('Sending prompt...');
const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => (responseData += chunk));
    res.on('end', () => {
        console.log(`Prompt sent. Status: ${res.statusCode}`);
        if (res.statusCode !== 200) {
            console.error(`Connector error: ${responseData}`);
            process.exit(1);
        }
    });
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();

// 4. Poll for file creation
console.log(`Waiting for file: ${RESPONSE_FILE}`);
const startTime = Date.now();
const TIMEOUT_MS = 60000; // 60 seconds timeout

const checkInterval = setInterval(() => {
    if (fs.existsSync(RESPONSE_FILE)) {
        clearInterval(checkInterval);
        const content = fs.readFileSync(RESPONSE_FILE, 'utf8');
        console.log('---------------------------------------------------');
        console.log('SUCCESS! File created.');
        console.log('Content:', content);
        console.log('---------------------------------------------------');

        if (content.trim() === '56088') {
            console.log('VERIFICATION PASSED: Calculation is correct.');
        } else {
            console.log('VERIFICATION WARNING: Content is not exactly 56088, please check.');
        }
        process.exit(0);
    }

    if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(checkInterval);
        console.error('TIMEOUT! File was not created within 60 seconds.');
        process.exit(1);
    }
}, 1000);
