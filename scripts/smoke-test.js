import http from 'http';
import WebSocket from '../server/node_modules/ws/index.js';

const BASE_URL = process.env.TEST_URL || 'http://localhost:8000';
const WS_URL = process.env.TEST_WS_URL || 'ws://localhost:8000/ws/live';

function fetchUrl(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(BASE_URL + urlPath, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

async function runSmokeTests() {
  console.log('====================================================');
  console.log(` Starting Production Smoke Test Suite against ${BASE_URL}`);
  console.log('====================================================');

  let passed = true;

  // 1. GET / -> returns index.html
  try {
    const resRoot = await fetchUrl('/');
    const isHtml = resRoot.status === 200 && resRoot.body.includes('<div id="root">');
    console.log(`[TEST 1] GET / -> Status: ${resRoot.status}, HTML Root Present: ${isHtml}`);
    if (!isHtml) passed = false;
  } catch (e) {
    console.error('[TEST 1 FAIL]', e.message);
    passed = false;
  }

  // 2. GET /some/deep/route -> returns index.html fallback
  try {
    const resDeep = await fetchUrl('/history/session_123');
    const isHtmlFallback = resDeep.status === 200 && resDeep.body.includes('<div id="root">');
    console.log(`[TEST 2] GET /history/session_123 -> Status: ${resDeep.status}, SPA Fallback HTML: ${isHtmlFallback}`);
    if (!isHtmlFallback) passed = false;
  } catch (e) {
    console.error('[TEST 2 FAIL]', e.message);
    passed = false;
  }

  // 3. GET /api/health -> returns success JSON
  try {
    const resHealth = await fetchUrl('/api/health');
    const json = JSON.parse(resHealth.body);
    const isOk = resHealth.status === 200 && json.status === 'ok';
    console.log(`[TEST 3] GET /api/health -> Status: ${resHealth.status}, JSON status: ${json.status}, HasApiKey: ${json.hasApiKey}`);
    if (!isOk) passed = false;
  } catch (e) {
    console.error('[TEST 3 FAIL]', e.message);
    passed = false;
  }

  // 4. GET /api/session-token -> token generation
  let sessionToken = '';
  try {
    const postRes = await new Promise((resolve, reject) => {
      const req = http.request(BASE_URL + '/api/session-token', { method: 'POST' }, (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
      req.end();
    });
    const json = JSON.parse(postRes.body);
    sessionToken = json.sessionToken || '';
    const hasToken = postRes.status === 200 && Boolean(sessionToken);
    console.log(`[TEST 4] POST /api/session-token -> Status: ${postRes.status}, Token Acquired: ${hasToken}`);
    if (!hasToken) passed = false;
  } catch (e) {
    console.error('[TEST 4 FAIL]', e.message);
    passed = false;
  }

  // 5. WebSocket Connection to ws://localhost:8000/ws/live?token=...
  if (sessionToken) {
    try {
      const wsUrlWithToken = `${WS_URL}?token=${sessionToken}&mode=rehearsal`;
      const wsResult = await new Promise((resolve) => {
        const ws = new WebSocket(wsUrlWithToken);
        const timeout = setTimeout(() => {
          ws.close();
          resolve({ success: false, reason: 'Timeout' });
        }, 5000);

        ws.on('open', () => {
          console.log('[TEST 5] WebSocket connection opened successfully!');
        });

        ws.on('message', (msg) => {
          clearTimeout(timeout);
          const msgStr = msg.toString();
          console.log('[TEST 5] Received WS message:', msgStr.slice(0, 100));
          ws.close();
          resolve({ success: true, message: msgStr });
        });

        ws.on('error', (err) => {
          clearTimeout(timeout);
          resolve({ success: false, reason: err.message });
        });
      });

      console.log(`[TEST 5] WebSocket /ws/live -> Handshake Success: ${wsResult.success}`);
      if (!wsResult.success) passed = false;
    } catch (e) {
      console.error('[TEST 5 FAIL]', e.message);
      passed = false;
    }
  }

  console.log('====================================================');
  if (passed) {
    console.log(' ALL SMOKE TESTS PASSED CLEANLY! READY FOR DEPLOYMENT.');
  } else {
    console.error(' SMOKE TEST SUITE ENCOUNTERED FAILURES!');
    process.exit(1);
  }
  console.log('====================================================');
}

runSmokeTests();
