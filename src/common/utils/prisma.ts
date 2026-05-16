import { logger } from './logger';

type PrismaEvent = { message: string; target: string };

interface PrismaEventEmitter {
  $on(event: 'error' | 'warn', listener: (e: PrismaEvent) => void): void;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $transaction<T>(
    fn: (tx: PrismaTransaction) => Promise<T>,
    options?: { isolationLevel?: string },
  ): Promise<T>;
  $disconnect(): Promise<void>;
}

export interface PrismaTransaction extends Omit<
  PrismaEventEmitter,
  '$transaction' | '$disconnect'
> {
  [key: string]: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PrismaClient = (require('@prisma/client') as any).PrismaClient;

const connectionLimit = parseInt(process.env['CONNECTION_LIMIT'] ?? '5', 10);
const poolTimeout = parseInt(process.env['POOL_TIMEOUT'] ?? '10', 10);

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const client = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
  datasources: {
    db: {
      url: buildDatabaseUrl(),
    },
  },
}) as PrismaEventEmitter;

client.$on('error', (e: PrismaEvent) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

client.$on('warn', (e: PrismaEvent) => {
  logger.warn('Prisma warning', { message: e.message, target: e.target });
});

export const prisma = client;

// ---------------------------------------------------------------------------
// Build the DATABASE_URL with pooling parameters
// ---------------------------------------------------------------------------

function buildDatabaseUrl(): string {
  const raw = process.env['DATABASE_URL'];
  if (!raw) return ''; // will fail at startup with a clear error

  try {
    const url = new URL(raw);

    // PgBouncer in transaction mode requires prepared statements disabled
    url.searchParams.set('pgbouncer', 'true');

    // Prisma connection pool limits — stay within Supabase's connection budget
    url.searchParams.set('connection_limit', String(connectionLimit));
    url.searchParams.set('pool_timeout', String(poolTimeout));

    // Statement cache size must be 0 when using PgBouncer (transaction mode)
    url.searchParams.set('statement_cache_size', '0');

    return url.toString();
  } catch {
    // If URL parsing fails (e.g. in test env with a placeholder URL),
    // return the raw value — Prisma will surface the error clearly
    return raw;
  }
}
