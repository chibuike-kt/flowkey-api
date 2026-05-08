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

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
const client = new PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
  ],
}) as PrismaEventEmitter;

client.$on('error', (e: PrismaEvent) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

client.$on('warn', (e: PrismaEvent) => {
  logger.warn('Prisma warning', { message: e.message, target: e.target });
});

export const prisma = client;
