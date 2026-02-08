const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'github_projects.txt');

// 1. Cleanup
if (fs.existsSync(OUTPUT_FILE)) {
    fs.unlinkSync(OUTPUT_FILE);
    console.log('Cleaned up previous output file.');
}

// 2. Prepare Prompt
const promptText = `
SYSTEM INSTRUCTION: You are being driven by a script.
TASK: Utilise ton browser pour aller sur GitHub, et liste les projets sur lesquelle je travaille.
OUTPUT: Write the list of projects into the file: ${OUTPUT_FILE.replace(/\\/g, '/')}
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
        'Content-Length': postData.length
    }
};

// 3. Send Prompt
console.log('Sending GitHub task prompt...');
const req = http.request(options, (res) => {
    console.log(`Prompt sent. Status: ${res.statusCode}`);
});

req.on('error', (e) => {
    console.error(`Problem with request: ${e.message}`);
});

req.write(postData);
req.end();

// 4. Poll for file
console.log(`Waiting for file: ${OUTPUT_FILE}`);
const startTime = Date.now();
const TIMEOUT_MS = 180000; // 3 minutes for browser interaction

const checkInterval = setInterval(() => {
    if (fs.existsSync(OUTPUT_FILE)) {
        clearInterval(checkInterval);
        const content = fs.readFileSync(OUTPUT_FILE, 'utf8');
        console.log('---------------------------------------------------');
        console.log('SUCCESS! File created.');
        console.log('Content:', content);
        console.log('---------------------------------------------------');
        process.exit(0);
    }

    if (Date.now() - startTime > TIMEOUT_MS) {
        clearInterval(checkInterval);
        console.error('TIMEOUT! Output file was not created within 3 minutes.');
        process.exit(1);
    }
}, 2000);
