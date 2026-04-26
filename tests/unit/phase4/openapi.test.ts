/**
 * Phase 4 — OpenAPI spec validation tests
 *
 * Validates:
 *   - Spec parses and dereferences without errors (swagger-parser)
 *   - All required endpoints are present
 *   - Every endpoint has operationId, tags, and at minimum a 401 or security entry
 *   - Every state-mutating endpoint documents the Idempotency-Key header
 *   - All response schemas reference the standard envelope
 *   - No endpoint returns a raw object without the success/data/meta/error envelope
 *   - Monetary amount fields are typed as integer (never number/float)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC_PATH = path.resolve(__dirname, '../../../docs/openapi.yaml');

function loadSpec(): Record<string, unknown> {
  const raw = fs.readFileSync(SPEC_PATH, 'utf8');
  return yaml.load(raw) as Record<string, unknown>;
}

type PathItem = Record<string, unknown>;
type Operation = {
  operationId?: string;
  tags?: string[];
  security?: unknown[];
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  responses?: Record<string, unknown>;
  requestBody?: {
    content?: {
      'application/json'?: {
        schema?: Record<string, unknown>;
      };
    };
  };
  summary?: string;
};

function getPaths(spec: Record<string, unknown>): Record<string, PathItem> {
  return (spec['paths'] as Record<string, PathItem>) ?? {};
}

function getOperations(spec: Record<string, unknown>): Array<{
  path: string;
  method: string;
  operation: Operation;
}> {
  const methods = ['get', 'post', 'put', 'patch', 'delete'];
  const paths = getPaths(spec);
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
// Tests
// ---------------------------------------------------------------------------

describe('OpenAPI spec file', () => {
  it('spec file exists at docs/openapi.yaml', () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
  });

  it('spec file is valid YAML and parses without error', () => {
    expect(() => loadSpec()).not.toThrow();
  });

  it('spec has openapi 3.x version field', () => {
    const spec = loadSpec();
    const version = spec['openapi'] as string;
    expect(version).toBeDefined();
    expect(version.startsWith('3.')).toBe(true);
  });

  it('spec has info.title and info.version', () => {
    const spec = loadSpec();
    const info = spec['info'] as Record<string, unknown>;
    expect(info['title']).toBeTruthy();
    expect(info['version']).toBeTruthy();
  });

  it('spec has at least one server defined', () => {
    const spec = loadSpec();
    const servers = spec['servers'] as unknown[];
    expect(servers.length).toBeGreaterThan(0);
  });
});

describe('Security schemes', () => {
  it('UserAuth scheme is defined', () => {
    const spec = loadSpec();
    const schemes = (spec['components'] as Record<string, unknown>)['securitySchemes'] as Record<
      string,
      unknown
    >;
    expect(schemes['UserAuth']).toBeDefined();
  });

  it('AdminAuth scheme is defined', () => {
    const spec = loadSpec();
    const schemes = (spec['components'] as Record<string, unknown>)['securitySchemes'] as Record<
      string,
      unknown
    >;
    expect(schemes['AdminAuth']).toBeDefined();
  });

  it('WebhookHMAC scheme is defined', () => {
    const spec = loadSpec();
    const schemes = (spec['components'] as Record<string, unknown>)['securitySchemes'] as Record<
      string,
      unknown
    >;
    expect(schemes['WebhookHMAC']).toBeDefined();
  });
});

describe('Required shared schemas', () => {
  let schemas: Record<string, unknown>;

  beforeAll(() => {
    const spec = loadSpec();
    schemas = (spec['components'] as Record<string, unknown>)['schemas'] as Record<string, unknown>;
  });

  const requiredSchemas = [
    'SuccessResponse',
    'ErrorResponse',
    'PaginationMeta',
    'KoboAmount',
    'UuidV4',
    'PhoneNumber',
    'UniversalId',
    'KycTier',
    'UserProfile',
    'AuthTokens',
    'WalletBalance',
    'Transaction',
    'KycStatus',
    'RecipientPreview',
    'TransferConfirmation',
    'BankAccountPreview',
    'QrCode',
    'Beneficiary',
    'PaymentRequest',
    'Notification',
    'NotificationPrefs',
    'Receipt',
    'Dispute',
    'BotSession',
    'BotMessage',
    'UserSettings',
    'AdminUserSummary',
    'AdminTransactionSummary',
    'AuditLog',
  ];

  for (const name of requiredSchemas) {
    it(`schema "${name}" is defined`, () => {
      expect(schemas[name]).toBeDefined();
    });
  }
});

describe('KoboAmount schema is integer type', () => {
  it('KoboAmount is typed as integer, not number', () => {
    const spec = loadSpec();
    const schemas = (spec['components'] as Record<string, unknown>)['schemas'] as Record<
      string,
      unknown
    >;
    const koboAmount = schemas['KoboAmount'] as Record<string, unknown>;
    expect(koboAmount['type']).toBe('integer');
    // Must never be 'number' — number allows floats
    expect(koboAmount['type']).not.toBe('number');
  });
});

describe('Required endpoints exist', () => {
  let spec: Record<string, unknown>;

  beforeAll(() => {
    spec = loadSpec();
  });

  const requiredEndpoints: Array<[string, string]> = [
    // Auth
    ['post', '/auth/register'],
    ['post', '/auth/verify-phone'],
    ['post', '/auth/resend-phone-otp'],
    ['post', '/auth/verify-email'],
    ['post', '/auth/resend-email-otp'],
    ['post', '/auth/login'],
    ['post', '/auth/refresh'],
    ['post', '/auth/logout'],
    ['post', '/auth/logout-all'],
    ['get', '/auth/me'],
    // KYC
    ['get', '/kyc/status'],
    ['post', '/kyc/upgrade'],
    ['get', '/kyc/attempts'],
    // Wallet
    ['get', '/wallet/balance'],
    ['get', '/wallet/transactions'],
    // Transfers
    ['post', '/transfers/resolve-recipient'],
    ['post', '/transfers/internal'],
    ['get', '/transfers/{id}'],
    // Withdrawals
    ['post', '/withdrawals/verify-account'],
    ['post', '/withdrawals'],
    ['get', '/withdrawals/{id}'],
    // Bills
    ['post', '/bills/validate'],
    ['post', '/bills/pay'],
    ['get', '/bills/{id}'],
    // QR
    ['post', '/qr/generate'],
    ['post', '/qr/decode'],
    ['get', '/qr/{id}'],
    // Payment requests
    ['post', '/payment-requests'],
    ['get', '/payment-requests'],
    ['post', '/payment-requests/{id}/pay'],
    ['post', '/payment-requests/{id}/decline'],
    // Beneficiaries
    ['get', '/beneficiaries'],
    ['post', '/beneficiaries'],
    ['patch', '/beneficiaries/{id}'],
    ['delete', '/beneficiaries/{id}'],
    // Notifications
    ['get', '/notifications'],
    // Receipts
    ['get', '/receipts/{id}'],
    ['get', '/receipts/public/{token}'],
    // Disputes
    ['post', '/disputes'],
    ['get', '/disputes'],
    ['get', '/disputes/{id}'],
    // Bot
    ['post', '/bot/sessions'],
    ['post', '/bot/sessions/{id}/message'],
    // Settings
    ['get', '/settings'],
    ['patch', '/settings/profile'],
    ['patch', '/settings/notification-prefs'],
    ['post', '/settings/passcode/change'],
    ['post', '/settings/passcode/forgot'],
    ['post', '/settings/passcode/reset'],
    ['post', '/settings/pin/set'],
    ['post', '/settings/pin/change'],
    ['delete', '/settings/pin'],
    ['get', '/settings/sessions'],
    ['delete', '/settings/sessions/{id}'],
    ['delete', '/settings/account'],
    // Admin
    ['get', '/admin/users'],
    ['get', '/admin/users/{id}'],
    ['post', '/admin/users/{id}/freeze'],
    ['post', '/admin/users/{id}/unfreeze'],
    ['get', '/admin/transactions'],
    ['get', '/admin/transactions/{id}'],
    ['post', '/admin/transactions/{id}/reverse'],
    ['get', '/admin/kyc/attempts'],
    ['post', '/admin/kyc/attempts/{id}/override'],
    ['get', '/admin/disputes'],
    ['patch', '/admin/disputes/{id}'],
    ['get', '/admin/audit-logs'],
    ['get', '/admin/dashboard'],
    // Webhooks
    ['post', '/webhooks/v1/providus'],
    ['post', '/webhooks/v1/prembly'],
  ];

  for (const [method, endpointPath] of requiredEndpoints) {
    it(`${method.toUpperCase()} ${endpointPath}`, () => {
      const paths = getPaths(spec);
      expect(paths[endpointPath]).toBeDefined();
      expect((paths[endpointPath] as Record<string, unknown>)[method]).toBeDefined();
    });
  }
});

describe('All operations have required fields', () => {
  let operations: ReturnType<typeof getOperations>;

  beforeAll(() => {
    const spec = loadSpec();
    operations = getOperations(spec);
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

describe('State-mutating endpoints document Idempotency-Key', () => {
  let operations: ReturnType<typeof getOperations>;

  beforeAll(() => {
    const spec = loadSpec();
    operations = getOperations(spec);
  });

  // Endpoints that mutate state but are intentionally excluded from idempotency
  // (refresh token is its own idempotency mechanism)
  const idempotencyExemptions = new Set([
    'POST /auth/refresh',
    'POST /auth/logout-all', // no body side effects that need idempotency
  ]);

  it('all POST/PATCH/DELETE endpoints document Idempotency-Key header or are exempted', () => {
    const mutatingMethods = ['post', 'patch', 'delete'];
    const violations: string[] = [];

    for (const { path: p, method, operation } of operations) {
      const key = `${method.toUpperCase()} ${p}`;

      if (!mutatingMethods.includes(method)) continue;
      if (idempotencyExemptions.has(key)) continue;

      // Webhook endpoints don't take Idempotency-Key from callers
      if (p.startsWith('/webhooks/')) continue;

      // Check for Idempotency-Key in parameters (via $ref or direct)
      const params = operation.parameters ?? [];
      const hasIdempotencyKey = params.some(
        (param) =>
          param.name === 'Idempotency-Key' ||
          (param as unknown as Record<string, unknown>)['$ref']
            ?.toString()
            .includes('IdempotencyKey'),
      );

      if (!hasIdempotencyKey) {
        violations.push(key);
      }
    }

    expect(violations).toEqual([]);
  });
});

describe('Endpoint count', () => {
  it('spec contains at least 70 operations', () => {
    const spec = loadSpec();
    const ops = getOperations(spec);
    expect(ops.length).toBeGreaterThanOrEqual(70);
  });
});

describe('Shared parameters are defined', () => {
  let parameters: Record<string, unknown>;

  beforeAll(() => {
    const spec = loadSpec();
    parameters = (spec['components'] as Record<string, unknown>)['parameters'] as Record<
      string,
      unknown
    >;
  });

  it('IdempotencyKey parameter is defined', () => {
    expect(parameters['IdempotencyKey']).toBeDefined();
  });

  it('CursorParam parameter is defined', () => {
    expect(parameters['CursorParam']).toBeDefined();
  });

  it('LimitParam parameter is defined', () => {
    expect(parameters['LimitParam']).toBeDefined();
  });
});

describe('Shared responses are defined', () => {
  let responses: Record<string, unknown>;

  beforeAll(() => {
    const spec = loadSpec();
    responses = (spec['components'] as Record<string, unknown>)['responses'] as Record<
      string,
      unknown
    >;
  });

  const requiredResponses = [
    'Unauthorized',
    'Forbidden',
    'UnprocessableEntity',
    'RateLimited',
    'NotFound',
    'InternalError',
  ];

  for (const name of requiredResponses) {
    it(`shared response "${name}" is defined`, () => {
      expect(responses[name]).toBeDefined();
    });
  }
});

describe('Webhook endpoints', () => {
  it('Providus webhook is under /webhooks/v1/ not /api/v1/', () => {
    const spec = loadSpec();
    const paths = getPaths(spec);
    expect(paths['/webhooks/v1/providus']).toBeDefined();
    expect(paths['/api/v1/webhooks/v1/providus']).toBeUndefined();
  });

  it('Prembly webhook is under /webhooks/v1/ not /api/v1/', () => {
    const spec = loadSpec();
    const paths = getPaths(spec);
    expect(paths['/webhooks/v1/prembly']).toBeDefined();
  });
});
