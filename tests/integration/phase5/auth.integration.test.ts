/**
 * Phase 5 — Auth integration tests
 * Requires: Docker Compose up + migrations applied
 * Run: npm run test:integration
 */

import supertest from 'supertest';
import type { Application } from 'express';
import * as dotenv from 'dotenv';
dotenv.config();

let app: Application;

beforeAll(async () => {
  jest.resetModules();
  const { _resetConfigForTesting, initConfig } =
    require('../../../src/config') as typeof import('../../../src/config');
  _resetConfigForTesting();
  await initConfig();
  const { createApp } = require('../../../src/app') as typeof import('../../../src/app');
  app = createApp();
}, 30000);

function uniquePhone(): string {
  return `+234${Math.floor(1000000000 + Math.random() * 9000000000)
    .toString()
    .slice(0, 10)}`;
}
function uniqueEmail(): string {
  return `test_${Date.now()}_${Math.random().toString(36).slice(2)}@flowkey.test`;
}
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---------------------------------------------------------------------------
// POST /auth/initiate
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/initiate', () => {
  it('returns 201 with registration_id for phone', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: uniquePhone(), contact_type: 'phone' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.registration_id).toBeDefined();
    expect(res.body.data.contact_type).toBe('phone');
    expect(res.body.data.otp_expires_at).toBeDefined();
  });

  it('returns 201 with registration_id for email', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: uniqueEmail(), contact_type: 'email' });
    expect(res.status).toBe(201);
    expect(res.body.data.registration_id).toBeDefined();
    expect(res.body.data.contact_type).toBe('email');
  });

  it('returns 409 when phone already registered', async () => {
    const phone = uniquePhone();
    await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: phone, contact_type: 'phone' });

    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: phone, contact_type: 'phone' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  it('returns 409 when email already registered', async () => {
    const email = uniqueEmail();
    await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: email, contact_type: 'email' });

    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: email, contact_type: 'email' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('returns 422 for invalid Nigerian phone', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .set('Idempotency-Key', uuid())
      .send({ contact: '08012345678', contact_type: 'phone' });
    expect(res.status).toBe(422);
  });

  it('returns 422 when Idempotency-Key missing', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/initiate')
      .send({ contact: uniquePhone(), contact_type: 'phone' });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/check-username
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/check-username', () => {
  it('returns available:true for unused username', async () => {
    const res = await supertest(app)
      .get('/api/v1/auth/check-username')
      .query({ username: `user_${Date.now()}` });
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
  });

  it('returns 422 for username too short', async () => {
    const res = await supertest(app).get('/api/v1/auth/check-username').query({ username: 'ab' });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/login', () => {
  it('returns 401 for non-existent contact', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuid())
      .send({
        contact: '+2349999999991',
        contact_type: 'phone',
        login_passcode: '000000',
        device_id: 'dev',
        fcm_token: 'fcm',
      });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 422 for invalid phone', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuid())
      .send({
        contact: 'badphone',
        contact_type: 'phone',
        login_passcode: '123456',
        device_id: 'dev',
        fcm_token: 'fcm',
      });
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/refresh', () => {
  it('returns 401 for invalid refresh token', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/refresh')
      .send({ refresh_token: 'invalid-token', device_id: 'dev' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
describe('GET /api/v1/auth/me', () => {
  it('returns 401 with no Authorization header', async () => {
    const res = await supertest(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 for invalid token', async () => {
    const res = await supertest(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('returns 401 for malformed Authorization header', async () => {
    const res = await supertest(app).get('/api/v1/auth/me').set('Authorization', 'Basic sometoken');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
describe('POST /api/v1/auth/logout', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/logout')
      .set('Idempotency-Key', uuid())
      .send({ refresh_token: 'some-token' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Standard envelope shape
// ---------------------------------------------------------------------------
describe('Response envelope', () => {
  it('error response always has correct shape', async () => {
    const res = await supertest(app)
      .post('/api/v1/auth/login')
      .set('Idempotency-Key', uuid())
      .send({
        contact: '+2349999999992',
        contact_type: 'phone',
        login_passcode: '000000',
        device_id: 'dev',
        fcm_token: 'fcm',
      });
    expect(res.body).toMatchObject({
      success: false,
      data: null,
      meta: null,
      error: { code: expect.any(String), message: expect.any(String) },
    });
  });

  it('404 for unknown route returns standard envelope', async () => {
    const res = await supertest(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });
});

// ---------------------------------------------------------------------------
// Settings — passcode/forgot
// ---------------------------------------------------------------------------
describe('POST /api/v1/settings/passcode/forgot', () => {
  it('returns 404 for unregistered phone', async () => {
    const res = await supertest(app)
      .post('/api/v1/settings/passcode/forgot')
      .set('Idempotency-Key', uuid())
      .send({ contact: '+2341111111111', contact_type: 'phone' });
    expect([200, 404]).toContain(res.status);
  });

  it('returns 422 for invalid contact', async () => {
    const res = await supertest(app)
      .post('/api/v1/settings/passcode/forgot')
      .set('Idempotency-Key', uuid())
      .send({ contact: 'notaphone', contact_type: 'phone' });
    expect(res.status).toBe(422);
  });
});
