import http from 'k6/http';
import { sleep, check } from 'k6';
import { BASE_URL, API, jsonHeaders, randomEmail } from './config.js';

export const options = {
  stages: [
    { duration: '10s', target: 5 }, // baseline
    { duration: '30s', target: 200 }, // sudden spike to 200 VUs
    { duration: '1m', target: 200 }, // hold spike
    { duration: '30s', target: 5 }, // drop back to baseline
    { duration: '30s', target: 0 }, // ramp down
  ],
  thresholds: {
    // During a spike, 429s are expected — don't count them as failures
    // Only 5xx responses are real failures
    'http_req_failed{expected_response:false}': ['rate<0.05'],
    http_req_duration: ['p(99)<2000'], // more lenient during spike
  },
};

const TOKEN = __ENV.TEST_BEARER_TOKEN || '';

export default function () {
  // Health check — rate limited but should never 500
  const health = http.get(`${BASE_URL}/health`);
  check(health, {
    'health not 500': (r) => r.status !== 500,
    'health not 503': (r) => r.status !== 503,
  });

  sleep(0.1);

  // Auth initiate — rate limited endpoint, expect some 429s during spike
  const email = randomEmail();
  const initiate = http.post(
    `${API}/auth/initiate`,
    JSON.stringify({ contact: email, contact_type: 'email' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(initiate, {
    'initiate not 500': (r) => r.status !== 500,
    'initiate is 201 or 429': (r) => r.status === 201 || r.status === 429,
  });

  sleep(0.2);

  if (TOKEN) {
    const balance = http.get(`${API}/wallet/balance`, { headers: jsonHeaders(TOKEN) });
    check(balance, {
      'balance not 500': (r) => r.status !== 500,
    });
  }

  sleep(0.3);
}
