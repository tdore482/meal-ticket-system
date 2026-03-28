const http = require('http');

const BASE_URL = 'http://localhost:3000';
let requestCount = 0;
let errorCount = 0;
let startTime = Date.now();

function makeRequest(path) {
  return new Promise((resolve) => {
    http.get(`${BASE_URL}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        requestCount++;
        if (res.statusCode >= 400) {
          errorCount++;
          if (errorCount <= 5) console.log(`Error ${res.statusCode}: ${path}`);
        }
        resolve();
      });
    }).on('error', () => {
      errorCount++;
      requestCount++;
      resolve();
    });
  });
}

async function soakTest() {
  console.log('🚀 Starting 30-second soak test...\n');
  
  const promises = [];
  
  const interval = setInterval(async () => {
    for (let i = 0; i < 20; i++) {
      promises.push(makeRequest('/api/health'));
    }
  }, 100);
  
  setTimeout(() => {
    clearInterval(interval);
    Promise.all(promises).then(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`\n📊 Soak Test Results:`);
      console.log(`   Total Requests: ${requestCount}`);
      console.log(`   Errors: ${errorCount}`);
      console.log(`   Duration: ${elapsed.toFixed(2)}s`);
      console.log(`   RPS: ${(requestCount / elapsed).toFixed(2)}`);
      console.log(`   Error Rate: ${((errorCount / requestCount) * 100).toFixed(2)}%`);
      process.exit(0);
    });
  }, 30000);
}

soakTest();
