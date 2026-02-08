const http = require('http');

const prompt = {
    prompt: "This is a test prompt from the Antigravity POC script. Please acknowledge this message by saying 'Message received'."
};

const data = JSON.stringify(prompt);

const options = {
    hostname: '127.0.0.1',
    port: 17375,
    path: '/send',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let responseData = '';
    res.on('data', (chunk) => {
        responseData += chunk;
    });

    res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log(`Response Body: ${responseData}`);
        if (res.statusCode === 200) {
            console.log('Prompt sent successfully!');
        } else {
            console.error('Failed to send prompt!');
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});

req.write(data);
req.end();
