import http from 'k6/http';
import { sleep, check } from 'k6';
import {
  API,
  THRESHOLDS,
  jsonHeaders,
  expectStatus,
  expectSuccess,
  randomEmail,
} from './config.js';

export const options = {
  stages: [
    { duration: '30s', target: 10 }, // ramp up to 10 VUs
    { duration: '2m', target: 20 }, // hold at 20 VUs
    { duration: '30s', target: 0 }, // ramp down
  ],
  thresholds: {
    ...THRESHOLDS,
    // Auth endpoints specifically — tighter budget
    'http_req_duration{endpoint:login}': ['p(95)<400'],
    'http_req_duration{endpoint:refresh}': ['p(95)<200'],
  },
};

const BEARER_TOKEN = __ENV.TEST_BEARER_TOKEN || '';
const REFRESH_TOKEN = __ENV.TEST_REFRESH_TOKEN || '';

export default function () {
  // -------------------------------------------------------------------------
  // 1. Registration initiate (no OTP follow-up — just test the endpoint)
  // -------------------------------------------------------------------------
  const email = randomEmail();
  const initiate = http.post(
    `${API}/auth/initiate`,
    JSON.stringify({ contact: email, contact_type: 'email' }),
    { headers: jsonHeaders(), tags: { endpoint: 'initiate' } },
  );
  expectStatus(initiate, 201, 'initiate registration');

  sleep(0.5);

  // -------------------------------------------------------------------------
  // 2. Login with test credentials
  // -------------------------------------------------------------------------
  if (BEARER_TOKEN) {
    const refresh = http.post(
      `${API}/auth/refresh`,
      JSON.stringify({ refresh_token: REFRESH_TOKEN }),
      { headers: jsonHeaders(), tags: { endpoint: 'refresh' } },
    );
    expectStatus(refresh, 200, 'token refresh');

    let newToken = BEARER_TOKEN;
    if (refresh.status === 200) {
      try {
        newToken = JSON.parse(refresh.body).data.access_token;
      } catch (_) {}
    }

    sleep(0.3);

    // -------------------------------------------------------------------------
    // 3. Authenticated request — wallet balance
    // -------------------------------------------------------------------------
    const balance = http.get(`${API}/wallet/balance`, {
      headers: jsonHeaders(newToken),
      tags: { endpoint: 'balance' },
    });
    expectStatus(balance, 200, 'wallet balance');
    expectSuccess(balance, 'wallet balance');

    sleep(0.3);

    // -------------------------------------------------------------------------
    // 4. PIN status check
    // -------------------------------------------------------------------------
    const pinStatus = http.get(`${API}/settings/pin/status`, {
      headers: jsonHeaders(newToken),
      tags: { endpoint: 'pin_status' },
    });
    expectStatus(pinStatus, 200, 'pin status');
  }

  sleep(1);
}

