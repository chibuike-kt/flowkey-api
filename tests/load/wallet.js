import http from 'k6/http';
import { sleep } from 'k6';
import {
  API,
  THRESHOLDS,
  jsonHeaders,
  idempotencyHeaders,
  expectStatus,
  expectSuccess,
} from './config.js';

export const options = {
  stages: [
    { duration: '1m', target: 20 }, // ramp to 20 VUs
    { duration: '3m', target: 30 }, // hold at 30 VUs — normal traffic
    { duration: '1m', target: 0 }, // ramp down
  ],
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{endpoint:balance}': ['p(95)<150'], // balance should be very fast
    'http_req_duration{endpoint:transactions}': ['p(95)<300'],
    'http_req_duration{endpoint:deposit_test}': ['p(95)<500'],
  },
};

const TOKEN = __ENV.TEST_BEARER_TOKEN || '';
const RECIPIENT_WALLET_ID = __ENV.TEST_RECIPIENT_WALLET_ID || '';

export default function () {
  if (!TOKEN) {
    console.warn('TEST_BEARER_TOKEN not set — skipping authenticated tests');
    sleep(2);
    return;
  }

  // -------------------------------------------------------------------------
  // 1. Wallet balance — most frequent read, should be very fast
  // -------------------------------------------------------------------------
  const balance = http.get(`${API}/wallet/balance`, {
    headers: jsonHeaders(TOKEN),
    tags: { endpoint: 'balance' },
  });
  expectStatus(balance, 200, 'wallet balance');
  expectSuccess(balance, 'wallet balance');

  sleep(0.2);

  // -------------------------------------------------------------------------
  // 2. Transaction history — paginated read
  // -------------------------------------------------------------------------
  const txns = http.get(`${API}/wallet/transactions?limit=20`, {
    headers: jsonHeaders(TOKEN),
    tags: { endpoint: 'transactions' },
  });
  expectStatus(txns, 200, 'transactions');

  sleep(0.3);

  // -------------------------------------------------------------------------
  // 3. Test deposit (dev/staging only) — fund wallet
  // -------------------------------------------------------------------------
  const deposit = http.post(
    `${API}/test/deposit`,
    JSON.stringify({ amount_kobo: 100000, narration: 'k6 load test' }),
    { headers: jsonHeaders(TOKEN), tags: { endpoint: 'deposit_test' } },
  );
  expectStatus(deposit, 201, 'test deposit');

  sleep(0.5);

  // -------------------------------------------------------------------------
  // 4. Virtual account — GET (most users will fetch this frequently)
  // -------------------------------------------------------------------------
  const va = http.get(`${API}/deposits/virtual-account`, {
    headers: jsonHeaders(TOKEN),
    tags: { endpoint: 'virtual_account' },
  });
  expectStatus(va, 200, 'virtual account');

  sleep(0.3);

  // -------------------------------------------------------------------------
  // 5. Beneficiary list — frequent read in transfer flow
  // -------------------------------------------------------------------------
  const beneficiaries = http.get(`${API}/beneficiaries`, {
    headers: jsonHeaders(TOKEN),
    tags: { endpoint: 'beneficiaries' },
  });
  expectStatus(beneficiaries, 200, 'beneficiaries list');

  sleep(1);
}
