const http = require('http');
const fs = require('fs');
const path = require('path');

const BROWSER_RESULT_FILE = path.join(__dirname, 'browser_result.txt');

// 1. Cleanup
if (fs.existsSync(BROWSER_RESULT_FILE)) {
    fs.unlinkSync(BROWSER_RESULT_FILE);
    console.log('Cleaned up previous browser result file.');
}

// 2. Prepare Prompt
const promptText = `
SYSTEM INSTRUCTION: You are part of a browser automation test.
TASK: Use your browser tool to visit "https://example.com".
TASK: Extract the page title (should be "Example Domain").
OUTPUT: Write the page title ONLY into the file: ${BROWSER_RESULT_FILE.replace(/\\/g, '/')}
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
console.log('Sending browser task prompt...');
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

// 4. Poll for file
console.log(`Waiting for file: ${BROWSER_RESULT_FILE}`);
const startTime = Date.now();
// Give browser tasks more time (e.g. 2 minutes)
const TIMEOUT_MS = 120000;

const checkInterval = setInterval(() => {
    if (fs.existsSync(BROWSER_RESULT_FILE)) {
        clearInterval(checkInterval);
        const content = fs.readFileSync(BROWSER_RESULT_FILE, 'utf8');
        console.log('---------------------------------------------------');
        console.log('SUCCESS! Browser result file created.');
        console.log('Content:', content);
        console.log('---------------------------------------------------');

        if (content.includes('Example Domain')) {
            console.log('VERIFICATION PASSED: Title matches expectation.');
        } else {
            console.log('VERIFICATION WARNING: Title does not match expected "Example Domain".');
        }
        process.exit(0);
    }

    if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(checkInterval);
        console.error('TIMEOUT! Browser result file was not created within 120 seconds.');
        process.exit(1);
    }
}, 2000);
