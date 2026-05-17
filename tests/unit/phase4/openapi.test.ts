/**
 * Phase 4 — OpenAPI spec validation tests
 *
 * Validates the docs/openapi.json spec against what's actually
 * implemented in FlowKey. Tests are scoped to what the spec contains
 * rather than asserting a fixed endpoint count — the spec grows
 * as phases are completed.
 */

import * as fs from 'fs';
import * as path from 'path';

const SPEC_PATH = path.resolve(__dirname, '../../../docs/openapi.json');

function loadSpec(): Record<string, unknown> {
  const raw = fs.readFileSync(SPEC_PATH, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

type Operation = {
  operationId?: string;
  tags?: string[];
  summary?: string;
  security?: unknown[];
  parameters?: Array<{ name?: string; $ref?: string }>;
  responses?: Record<string, unknown>;
};

function getOperations(spec: Record<string, unknown>): Array<{
  path: string;
  method: string;
  operation: Operation;
}> {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const paths = (spec['paths'] as Record<string, Record<string, unknown>>) ?? {};
  const ops: Array<{ path: string; method: string; operation: Operation }> = [];
  for (const [p, pathItem] of Object.entries(paths)) {
    for (const method of methods) {
      if (pathItem[method]) {
        ops.push({ path: p, method, operation: pathItem[method] as Operation });
      }
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

describe('OpenAPI spec file', () => {
  it('exists at docs/openapi.json', () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
  });

  it('parses as valid JSON without error', () => {
    expect(() => loadSpec()).not.toThrow();
  });

  it('has openapi 3.x version field', () => {
    const version = loadSpec()['openapi'] as string;
    expect(version).toBeDefined();
    expect(version.startsWith('3.')).toBe(true);
  });

  it('has info.title and info.version', () => {
    const info = loadSpec()['info'] as Record<string, unknown>;
    expect(info['title']).toBeTruthy();
    expect(info['version']).toBeTruthy();
  });

  it('has at least one server defined', () => {
    const servers = loadSpec()['servers'] as unknown[];
    expect(Array.isArray(servers)).toBe(true);
    expect(servers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Security schemes
// ---------------------------------------------------------------------------

describe('Security schemes', () => {
  it('BearerAuth scheme is defined', () => {
    const spec = loadSpec();
    const schemes = (spec['components'] as Record<string, unknown>)['securitySchemes'] as Record<
      string,
      unknown
    >;
    expect(schemes['BearerAuth']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Operation quality
// ---------------------------------------------------------------------------

describe('All operations have required fields', () => {
  let operations: ReturnType<typeof getOperations>;
  beforeAll(() => {
    operations = getOperations(loadSpec());
  });

  it('every operation has an operationId', () => {
    const missing = operations
      .filter(({ operation }) => !operation.operationId)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it('every operation has at least one tag', () => {
    const missing = operations
      .filter(({ operation }) => !operation.tags || operation.tags.length === 0)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it('every operation has a summary', () => {
    const missing = operations
      .filter(({ operation }) => !operation.summary)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });

  it('every operation documents at least one response', () => {
    const missing = operations
      .filter(
        ({ operation }) => !operation.responses || Object.keys(operation.responses).length === 0,
      )
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Required endpoints — what we've actually implemented
// ---------------------------------------------------------------------------

describe('Required endpoints exist', () => {
  let spec: Record<string, unknown>;
  beforeAll(() => {
    spec = loadSpec();
  });

  const required: Array<[string, string]> = [
    // Auth — registration
    ['post', '/auth/initiate'],
    ['post', '/auth/verify-otp'],
    ['post', '/auth/resend-otp'],
    ['get', '/auth/check-username'],
    ['post', '/auth/complete'],
    // Auth — session
    ['post', '/auth/login'],
    ['post', '/auth/refresh'],
    ['post', '/auth/unlock'],
    ['post', '/auth/logout'],
    ['post', '/auth/logout-all'],
    ['get', '/auth/me'],
    // Settings
    ['post', '/settings/passcode/change'],
    ['post', '/settings/passcode/forgot'],
    ['post', '/settings/passcode/reset'],
    ['get', '/settings/pin/status'],
    ['post', '/settings/pin/set'],
    ['post', '/settings/pin/reset/initiate'],
    ['post', '/settings/pin/reset/confirm'],
    ['post', '/settings/pin/reset/complete'],
    ['get', '/settings/upp/status'],
    ['post', '/settings/upp/set'],
    ['post', '/settings/upp/reset/initiate'],
    ['post', '/settings/upp/reset/confirm'],
    ['post', '/settings/upp/reset/complete'],
    ['get', '/settings/sessions'],
    ['delete', '/settings/sessions/{id}'],
    ['post', '/settings/universal-id/revoke'],
    // KYC
    ['get', '/kyc/status'],
    ['get', '/kyc/attempts'],
    ['post', '/kyc/upgrade'],
    // Wallet
    ['get', '/wallet/balance'],
    ['get', '/wallet/transactions'],
    // Transfers
    ['post', '/transfers/resolve-recipient'],
    ['post', '/transfers/internal'],
    ['post', '/transfers/bank'],
    ['get', '/transfers'],
    ['get', '/transfers/{id}'],
    ['post', '/transfers/{id}/retry'],
    // QR
    ['get', '/qr/me'],
    ['post', '/qr/decode'],
    ['post', '/qr/regenerate'],
    // Deposits
    ['post', '/deposits/virtual-account'],
    ['get', '/deposits/virtual-account'],
    ['post', '/deposits/card'],
    ['get', '/deposits'],
    // Cards
    ['post', '/cards'],
    ['get', '/cards'],
    ['delete', '/cards/{id}'],
    // Beneficiaries
    ['post', '/beneficiaries'],
    ['get', '/beneficiaries'],
    ['get', '/beneficiaries/{id}'],
    ['patch', '/beneficiaries/{id}'],
    ['delete', '/beneficiaries/{id}'],
    // Webhooks
    ['post', '/webhooks/v1/providus'],
    ['post', '/webhooks/v1/paystack'],
    // System
    ['get', '/health'],
    ['get', '/metrics'],
    ['post', '/test/deposit'],
  ];

  const paths = () => (spec['paths'] as Record<string, Record<string, unknown>>) ?? {};

  for (const [method, endpointPath] of required) {
    it(`${method.toUpperCase()} ${endpointPath}`, () => {
      expect(paths()[endpointPath]).toBeDefined();
      expect(paths()[endpointPath][method]).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// Spec contains at least 50 operations
// ---------------------------------------------------------------------------

describe('Endpoint count', () => {
  it('spec contains at least 50 operations', () => {
    expect(getOperations(loadSpec()).length).toBeGreaterThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

describe('Shared components are defined', () => {
  let spec: Record<string, unknown>;
  beforeAll(() => {
    spec = loadSpec();
  });

  it('IdempotencyKey parameter is defined', () => {
    const params = (spec['components'] as Record<string, unknown>)['parameters'] as Record<
      string,
      unknown
    >;
    expect(params['IdempotencyKey']).toBeDefined();
  });

  it('ErrorResponse schema is defined', () => {
    const schemas = (spec['components'] as Record<string, unknown>)['schemas'] as Record<
      string,
      unknown
    >;
    expect(schemas['ErrorResponse']).toBeDefined();
  });

  it('Unauthorized response is defined', () => {
    const responses = (spec['components'] as Record<string, unknown>)['responses'] as Record<
      string,
      unknown
    >;
    expect(responses['Unauthorized']).toBeDefined();
  });
});
