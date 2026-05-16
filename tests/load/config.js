export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API = `${BASE_URL}/api/v1`;

// ---------------------------------------------------------------------------
// Standard thresholds — applied to every test
// ---------------------------------------------------------------------------

export const THRESHOLDS = {
  // Error rate must stay below 1%
  http_req_failed: ['rate<0.01'],
  // 95% of requests must complete in under 500ms
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
};

// ---------------------------------------------------------------------------
// Common headers
// ---------------------------------------------------------------------------

export function jsonHeaders(token = null) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

export function idempotencyHeaders(token = null) {
  const { uuidv4 } = require('https://jslib.k6.io/k6-utils/1.4.0/index.js');
  return {
    ...jsonHeaders(token),
    'Idempotency-Key': uuidv4(),
  };
}

// ---------------------------------------------------------------------------
// Helper — check response and tag failures
// ---------------------------------------------------------------------------

import { check } from 'k6';

export function expectStatus(res, expectedStatus, label = '') {
  const ok = check(res, {
    [`${label} status ${expectedStatus}`]: (r) => r.status === expectedStatus,
  });
  if (!ok) {
    console.error(
      `[FAIL] ${label} — expected ${expectedStatus}, got ${res.status}: ${res.body?.slice(0, 200)}`,
    );
  }
  return ok;
}

export function expectSuccess(res, label = '') {
  const ok = check(res, {
    [`${label} success=true`]: (r) => {
      try {
        return JSON.parse(r.body).success === true;
      } catch {
        return false;
      }
    },
  });
  if (!ok) {
    console.error(`[FAIL] ${label} — body: ${res.body?.slice(0, 200)}`);
  }
  return ok;
}

// ---------------------------------------------------------------------------
// Random data generators
// ---------------------------------------------------------------------------

export function randomPhone() {
  const suffix = Math.floor(Math.random() * 90000000 + 10000000);
  return `+23480${suffix}`;
}

export function randomEmail() {
  const id = Math.random().toString(36).slice(2, 10);
  return `loadtest_${id}@flowkey-test.com`;
}

export function randomUsername() {
  const id = Math.random().toString(36).slice(2, 8);
  return `testuser_${id}`;
}
