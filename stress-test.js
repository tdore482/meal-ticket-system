const http = require('http');

const BASE_URL = 'http://localhost:3000';

function makeRequest(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(role) {
  let body;
  if (role === 'user') {
    body = { role: 'user', registrationNumber: 'REG001', pin: '1234' };
  } else if (role === 'vendor') {
    body = { role: 'vendor', vendorCode: 'cafe_a' };
  } else if (role === 'admin') {
    body = { role: 'admin', username: 'admin', password: 'admin123' };
  }
  
  const result = await makeRequest('POST', '/api/auth/login', body);
  return result.data.token || null;
}

async function runLoadTest(endpoint, requests, method = 'GET', body = null, headers = {}) {
  const startTime = Date.now();
  let success = 0;
  let failures = 0;
  const errors = [];

  const promises = [];
  for (let i = 0; i < requests; i++) {
    promises.push(
      makeRequest(method, endpoint, body, headers)
        .then(res => {
          if (res.status >= 200 && res.status < 300) success++;
          else {
            failures++;
            errors.push(`Status ${res.status}: ${JSON.stringify(res.data).slice(0, 100)}`);
          }
        })
        .catch(err => {
          failures++;
          errors.push(err.message);
        })
    );
  }

  await Promise.all(promises);
  const duration = (Date.now() - startTime) / 1000;
  const rps = requests / duration;

  return { requests, success, failures, duration, rps, errors: errors.slice(0, 5) };
}

async function runStressTests() {
  console.log('\n========================================');
  console.log('   STRESS TESTING MEAL TICKET SYSTEM   ');
  console.log('========================================\n');

  // 1. Health Check Endpoint (Baseline)
  console.log('📊 TEST 1: Health Check (Baseline)');
  const healthResult = await runLoadTest('/api/health', 100);
  console.log(`   Requests: ${healthResult.requests}, Success: ${healthResult.success}, Failed: ${healthResult.failures}`);
  console.log(`   Duration: ${healthResult.duration.toFixed(2)}s, RPS: ${healthResult.rps.toFixed(2)}`);

  // 2. Login Stress Test
  console.log('\n📊 TEST 2: Concurrent Logins (100 requests)');
  const loginResults = await Promise.all([
    runLoadTest('/api/auth/login', 50, 'POST', { role: 'user', registrationNumber: 'REG001', pin: '1234' }),
  ]);
  const loginResult = loginResults[0];
  console.log(`   Requests: ${loginResult.requests}, Success: ${loginResult.success}, Failed: ${loginResult.failures}`);
  console.log(`   Duration: ${loginResult.duration.toFixed(2)}s, RPS: ${loginResult.rps.toFixed(2)}`);
  if (loginResult.failures > 0) console.log(`   ⚠️ Errors: ${loginResult.errors[0]}`);

  // Get tokens for further tests
  const userToken = await login('user');
  const vendorToken = await login('vendor');
  const adminToken = await login('admin');

  console.log('\n📊 TEST 3: User Dashboard (Authenticated)');
  const dashboardResult = await runLoadTest('/api/user/dashboard', 100, 'GET', null, { 'Authorization': `Bearer ${userToken}` });
  console.log(`   Requests: ${dashboardResult.requests}, Success: ${dashboardResult.success}, Failed: ${dashboardResult.failures}`);
  console.log(`   Duration: ${dashboardResult.duration.toFixed(2)}s, RPS: ${dashboardResult.rps.toFixed(2)}`);

  console.log('\n📊 TEST 4: Admin Dashboard (Authenticated)');
  const adminResult = await runLoadTest('/api/admin/dashboard', 100, 'GET', null, { 'Authorization': `Bearer ${adminToken}` });
  console.log(`   Requests: ${adminResult.requests}, Success: ${adminResult.success}, Failed: ${adminResult.failures}`);
  console.log(`   Duration: ${adminResult.duration.toFixed(2)}s, RPS: ${adminResult.rps.toFixed(2)}`);

  // 5. QR Generation Stress Test
  console.log('\n📊 TEST 5: QR Token Generation (50 concurrent)');
  const qrResults = await Promise.all([
    runLoadTest('/api/user/generate-qr', 50, 'POST', {}, { 'Authorization': `Bearer ${userToken}` })
  ]);
  const qrResult = qrResults[0];
  console.log(`   Requests: ${qrResult.requests}, Success: ${qrResult.success}, Failed: ${qrResult.failures}`);
  console.log(`   Duration: ${qrResult.duration.toFixed(2)}s, RPS: ${qrResult.rps.toFixed(2)}`);
  if (qrResult.failures > 0) console.log(`   ⚠️ Errors: ${qrResult.errors[0]}`);

  // 6. Vendor QR Validation Stress Test
  console.log('\n📊 TEST 6: Vendor QR Validation (50 concurrent)');
  
  // First generate a valid QR token
  const qrGen = await makeRequest('POST', '/api/user/generate-qr', {}, { 'Authorization': `Bearer ${userToken}` });
  const validToken = qrGen.data.token;
  
  if (validToken) {
    const validationResult = await runLoadTest(
      '/api/vendor/validate-qr',
      50,
      'POST',
      { qrData: `REG:REG001|TOKEN:${validToken}` },
      { 'Authorization': `Bearer ${vendorToken}` }
    );
    console.log(`   Requests: ${validationResult.requests}, Success: ${validationResult.success}, Failed: ${validationResult.failures}`);
    console.log(`   Duration: ${validationResult.duration.toFixed(2)}s, RPS: ${validationResult.rps.toFixed(2)}`);
    if (validationResult.failures > 0) console.log(`   ⚠️ Errors: ${validationResult.errors[0]}`);
  }

  // 7. Spike Test - Sudden Load
  console.log('\n📊 TEST 7: Spike Test (200 sudden requests)');
  const spikeResult = await runLoadTest('/api/health', 200);
  console.log(`   Requests: ${spikeResult.requests}, Success: ${spikeResult.success}, Failed: ${spikeResult.failures}`);
  console.log(`   Duration: ${spikeResult.duration.toFixed(2)}s, RPS: ${spikeResult.rps.toFixed(2)}`);

  // 8. High Concurrency Test
  console.log('\n📊 TEST 8: High Concurrency (500 requests)');
  const highLoadResult = await runLoadTest('/api/health', 500);
  console.log(`   Requests: ${highLoadResult.requests}, Success: ${highLoadResult.success}, Failed: ${highLoadResult.failures}`);
  console.log(`   Duration: ${highLoadResult.duration.toFixed(2)}s, RPS: ${highLoadResult.rps.toFixed(2)}`);

  // Summary
  console.log('\n========================================');
  console.log('            TEST SUMMARY               ');
  console.log('========================================\n');
  
  const allResults = [
    { name: 'Health Check', ...healthResult },
    { name: 'Login', ...loginResult },
    { name: 'User Dashboard', ...dashboardResult },
    { name: 'Admin Dashboard', ...adminResult },
    { name: 'QR Generation', ...qrResult },
    { name: 'Spike Test', ...spikeResult },
    { name: 'High Load', ...highLoadResult }
  ];

  let totalRequests = 0;
  let totalSuccess = 0;
  let totalFailures = 0;

  allResults.forEach(r => {
    totalRequests += r.requests;
    totalSuccess += r.success;
    totalFailures += r.failures;
    const successRate = ((r.success / r.requests) * 100).toFixed(1);
    const status = r.failures === 0 ? '✅' : '⚠️';
    console.log(`${status} ${r.name}: ${successRate}% success (${r.rps.toFixed(1)} req/s)`);
  });

  console.log(`\n📈 Total: ${totalRequests} requests, ${totalSuccess} success, ${totalFailures} failures`);
  console.log(`   Overall Success Rate: ${((totalSuccess / totalRequests) * 100).toFixed(1)}%`);
}

runStressTests().catch(console.error);
