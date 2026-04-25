/**
 * FlowKey — Config Service
 *
 * Resolution order:
 *   development / test: process.env (populated by dotenv in server.ts)
 *   production:         AWS Secrets Manager → merged with process.env
 *
 * The config object is frozen after construction — no runtime mutation.
 * All consumers import `config` from this module. Never read process.env directly.
 */

import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppConfig {
  // Runtime
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  apiVersion: string;
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;

  // Database
  databaseUrl: string;
  shadowDatabaseUrl: string;

  // Redis
  redisUrl: string;
  redisKeyPrefix: string;

  // JWT
  jwtPrivateKey: string;
  jwtPublicKey: string;
  jwtAccessTokenTtl: number;
  jwtRefreshTokenTtl: number;
  jwtIssuer: string;
  jwtAudience: string;

  // Session
  maxSessionsPerUser: number;

  // OTP
  otpTtlSeconds: number;
  otpMaxAttempts: number;
  otpResendWindowSeconds: number;
  otpResendMax: number;

  // Argon2id
  argon2MemoryCost: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  argon2OutputLength: number;

  // Rate limiting
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
  authRateLimitMax: number;

  // Email (Nodemailer)
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;

  // Firebase
  firebaseServiceAccountPath: string;
  firebaseProjectId: string;

  // Prembly
  premblyApiBaseUrl: string;
  premblyApiKey: string;
  premblyWebhookSecret: string;
  premblyTimeoutMs: number;
  premblyCircuitBreakerThreshold: number;
  premblyCircuitBreakerCooldownMs: number;

  // Providus — UNCONFIRMED, populated when Phase 9 is reached
  providusApiBaseUrl: string;
  providusClientId: string;
  providusClientSecret: string;
  providusWebhookSecret: string;
  providusTimeoutMs: number;
  providusWebhookSlaMs: number;

  // AWS
  awsRegion: string;
  awsSecretName: string;

  // Internal signing
  qrHmacSecret: string;
  receiptHmacSecret: string;
  receiptUrlTtlSeconds: number;

  // Queue
  queuePrefix: string;
  queueDefaultRetries: number;
  queueDefaultBackoffMs: number;

  // Logging
  logLevel: 'error' | 'warn' | 'info' | 'debug';
  logFormat: 'json' | 'pretty';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `[Config] Required environment variable "${key}" is missing. ` +
        `Check .env.example for all required variables.`,
    );
  }
  return value;
}

function envInt(key: string, fallback: number): number {
  const value = process.env[key];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    throw new Error(`[Config] Environment variable "${key}" must be an integer. Got: "${value}"`);
  }
  return parsed;
}

function envBool(key: string, fallback: boolean): boolean {
  const value = process.env[key];
  if (!value) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

// ---------------------------------------------------------------------------
// AWS Secrets Manager resolver (production only)
// ---------------------------------------------------------------------------

async function resolveAwsSecrets(region: string, secretName: string): Promise<void> {
  const client = new SecretsManagerClient({ region });
  const command = new GetSecretValueCommand({ SecretId: secretName });

  try {
    const response = await client.send(command);
    if (!response.SecretString) {
      throw new Error(`[Config] AWS Secrets Manager returned empty secret for: ${secretName}`);
    }

    const secrets = JSON.parse(response.SecretString) as Record<string, string>;

    // Merge secrets into process.env — these override .env values in production
    // AWS secret keys use the same names as .env.example keys for consistency
    for (const [key, value] of Object.entries(secrets)) {
      if (typeof value === 'string') {
        process.env[key] = value;
      }
    }

    console.warn(`[Config] AWS Secrets Manager: resolved ${Object.keys(secrets).length} secrets`);
  } catch (error) {
    // In production, a secrets failure is a hard startup failure — do not proceed
    throw new Error(
      `[Config] Failed to resolve secrets from AWS Secrets Manager (${secretName}): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function buildConfig(): AppConfig {
  const nodeEnv = (process.env['NODE_ENV'] ?? 'development') as AppConfig['nodeEnv'];

  const config: AppConfig = {
    // Runtime
    nodeEnv,
    port: envInt('PORT', 3000),
    apiVersion: process.env['API_VERSION'] ?? 'v1',
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',

    // Database
    databaseUrl: requireEnv('DATABASE_URL'),
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'] ?? '',

    // Redis
    redisUrl: requireEnv('REDIS_URL'),
    redisKeyPrefix: process.env['REDIS_KEY_PREFIX'] ?? 'fk:',

    // JWT
    jwtPrivateKey: requireEnv('JWT_PRIVATE_KEY').replace(/\\n/g, '\n'),
    jwtPublicKey: requireEnv('JWT_PUBLIC_KEY').replace(/\\n/g, '\n'),
    jwtAccessTokenTtl: envInt('JWT_ACCESS_TOKEN_TTL', 900),
    jwtRefreshTokenTtl: envInt('JWT_REFRESH_TOKEN_TTL', 2592000),
    jwtIssuer: process.env['JWT_ISSUER'] ?? 'flowkey-api',
    jwtAudience: process.env['JWT_AUDIENCE'] ?? 'flowkey-app',

    // Session
    maxSessionsPerUser: envInt('MAX_SESSIONS_PER_USER', 5),

    // OTP
    otpTtlSeconds: envInt('OTP_TTL_SECONDS', 300),
    otpMaxAttempts: envInt('OTP_MAX_ATTEMPTS', 3),
    otpResendWindowSeconds: envInt('OTP_RESEND_WINDOW_SECONDS', 1800),
    otpResendMax: envInt('OTP_RESEND_MAX', 3),

    // Argon2id
    argon2MemoryCost: envInt('ARGON2_MEMORY_COST', 65536),
    argon2TimeCost: envInt('ARGON2_TIME_COST', 3),
    argon2Parallelism: envInt('ARGON2_PARALLELISM', 4),
    argon2OutputLength: envInt('ARGON2_OUTPUT_LENGTH', 32),

    // Rate limiting
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', 900000),
    rateLimitMaxRequests: envInt('RATE_LIMIT_MAX_REQUESTS', 100),
    authRateLimitMax: envInt('AUTH_RATE_LIMIT_MAX', 20),

    // Email
    smtpHost: process.env['SMTP_HOST'] ?? 'smtp.ethereal.email',
    smtpPort: envInt('SMTP_PORT', 587),
    smtpSecure: envBool('SMTP_SECURE', false),
    smtpUser: process.env['SMTP_USER'] ?? '',
    smtpPass: process.env['SMTP_PASS'] ?? '',
    smtpFrom: process.env['SMTP_FROM'] ?? 'FlowKey <noreply@flowkey.ng>',

    // Firebase
    firebaseServiceAccountPath: process.env['FIREBASE_SERVICE_ACCOUNT_PATH'] ?? '',
    firebaseProjectId: process.env['FIREBASE_PROJECT_ID'] ?? '',

    // Prembly
    premblyApiBaseUrl: process.env['PREMBLY_API_BASE_URL'] ?? '',
    premblyApiKey: process.env['PREMBLY_API_KEY'] ?? '',
    premblyWebhookSecret: process.env['PREMBLY_WEBHOOK_SECRET'] ?? '',
    premblyTimeoutMs: envInt('PREMBLY_TIMEOUT_MS', 15000),
    premblyCircuitBreakerThreshold: envInt('PREMBLY_CIRCUIT_BREAKER_THRESHOLD', 5),
    premblyCircuitBreakerCooldownMs: envInt('PREMBLY_CIRCUIT_BREAKER_COOLDOWN_MS', 60000),

    // Providus — UNCONFIRMED: these will be required fields when Phase 9 begins.
    // The assumption flag from Phase 1 remains open. Do not use these values until confirmed.
    providusApiBaseUrl: process.env['PROVIDUS_API_BASE_URL'] ?? '',
    providusClientId: process.env['PROVIDUS_CLIENT_ID'] ?? '',
    providusClientSecret: process.env['PROVIDUS_CLIENT_SECRET'] ?? '',
    providusWebhookSecret: process.env['PROVIDUS_WEBHOOK_SECRET'] ?? '',
    providusTimeoutMs: envInt('PROVIDUS_TIMEOUT_MS', 10000),
    providusWebhookSlaMs: envInt('PROVIDUS_WEBHOOK_SLA_MS', 600000),

    // AWS
    awsRegion: process.env['AWS_REGION'] ?? 'af-south-1',
    awsSecretName: process.env['AWS_SECRET_NAME'] ?? 'flowkey/production/api',

    // Internal signing
    qrHmacSecret: process.env['QR_HMAC_SECRET'] ?? '',
    receiptHmacSecret: process.env['RECEIPT_HMAC_SECRET'] ?? '',
    receiptUrlTtlSeconds: envInt('RECEIPT_URL_TTL_SECONDS', 259200),

    // Queue
    queuePrefix: process.env['QUEUE_PREFIX'] ?? 'flowkey',
    queueDefaultRetries: envInt('QUEUE_DEFAULT_RETRIES', 3),
    queueDefaultBackoffMs: envInt('QUEUE_DEFAULT_BACKOFF_MS', 5000),

    // Logging
    logLevel: (process.env['LOG_LEVEL'] ?? 'info') as AppConfig['logLevel'],
    logFormat: (process.env['LOG_FORMAT'] ?? 'json') as AppConfig['logFormat'],
  };

  return Object.freeze(config);
}

// ---------------------------------------------------------------------------
// Exported singleton — set after init()
// ---------------------------------------------------------------------------

let _config: AppConfig | null = null;

/**
 * Call once at application startup (in server.ts).
 * In production, resolves AWS Secrets Manager before building config.
 * In development/test, builds config directly from process.env.
 */
export async function initConfig(): Promise<void> {
  const nodeEnv = process.env['NODE_ENV'] ?? 'development';

  if (nodeEnv === 'production') {
    const region = process.env['AWS_REGION'] ?? 'af-south-1';
    const secretName = process.env['AWS_SECRET_NAME'] ?? 'flowkey/production/api';
    await resolveAwsSecrets(region, secretName);
  }

  _config = buildConfig();
}

/**
 * Access the application configuration.
 * Throws if initConfig() has not been called.
 */
export function config(): AppConfig {
  if (!_config) {
    throw new Error(
      '[Config] config() called before initConfig(). ' +
        'Call initConfig() at application startup before accessing config.',
    );
  }
  return _config;
}

/**
 * Reset config singleton — test use only.
 * Allows each test suite to reinitialise with different env values.
 */
export function _resetConfigForTesting(): void {
  _config = null;
}
