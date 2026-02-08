const http = require('http');

const options = {
    hostname: '127.0.0.1',
    port: 17375,
    path: '/health',
    method: 'GET'
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });

    res.on('end', () => {
        console.log(`Status Code: ${res.statusCode}`);
        console.log(`Response Body: ${data}`);
        if (res.statusCode === 200) {
            console.log('Connection test passed!');
        } else {
            console.error('Connection test failed!');
            process.exit(1);
        }
    });
});

req.on('error', (error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
});

req.end();
