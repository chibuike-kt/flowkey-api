import http from 'k6/http';
import { sleep } from 'k6';
import { API, jsonHeaders, expectStatus, expectSuccess } from './config.js';

export const options = {
  stages: [
    { duration: '2m', target: 10 }, // warm up
    { duration: '3m', target: 50 }, // ramp to 50 VUs
    { duration: '3m', target: 100 }, // ramp to 100 VUs — peak stress
    { duration: '2m', target: 100 }, // hold at 100 VUs
    { duration: '2m', target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
  },
};

const TOKEN = __ENV.TEST_BEARER_TOKEN || '';

export default function () {
  // Health check — always available, no auth needed
  const health = http.get(`${BASE_URL}/health`, {
    tags: { endpoint: 'health' },
  });
  expectStatus(health, 200, 'health');

  sleep(0.1);

  if (TOKEN) {
    // Balance — the most common authenticated read
    const balance = http.get(`${API}/wallet/balance`, {
      headers: jsonHeaders(TOKEN),
      tags: { endpoint: 'balance' },
    });
    expectStatus(balance, 200, 'balance');

    sleep(0.2);

    // Transaction list
    const txns = http.get(`${API}/wallet/transactions?limit=10`, {
      headers: jsonHeaders(TOKEN),
      tags: { endpoint: 'transactions' },
    });
    expectStatus(txns, 200, 'transactions');
  }

  sleep(0.5);
}
