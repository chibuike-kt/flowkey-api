/**
 * FlowKey — Prisma Client Singleton
 *
 * A single PrismaClient instance is shared across the application.
 *
 * NOTE ON TYPES IN THIS FILE:
 * Prisma generates its full TypeScript client into node_modules/.prisma/client
 * during `prisma generate`. Until that runs, the PrismaClient type is not
 * available at compile time. This file uses a runtime require() with a
 * minimal interface to allow compilation before generate has been run.
 *
 * In all normal environments (CI, dev, prod), `prisma generate` runs before
 * TypeScript compilation. The `skipLibCheck: true` in tsconfig handles the rest.
 *
 * Tests mock this module entirely via jest.mock().
 */

import { logger } from './logger.js';

// Minimal interface covering what the application uses from PrismaClient.
// The full generated client satisfies this interface — it's a subset, not a replacement.
interface PrismaEventEmitter {
  $on(event: 'error' | 'warn', listener: (e: { message: string; target: string }) => void): void;
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  $transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
  $disconnect(): Promise<void>;
}

// Minimal transaction interface — extended per-feature as models are added in Phase 3
export interface PrismaTransaction extends Omit<
  PrismaEventEmitter,
  '$transaction' | '$disconnect'
> {
  [key: string]: unknown;
}

// Runtime require — PrismaClient exists after `prisma generate`
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prismaModule = require('@prisma/client') as any;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
const prismaClient: PrismaEventEmitter = new prismaModule.PrismaClient({
  log: [
    { level: 'error', emit: 'event' },
    { level: 'warn', emit: 'event' },
    // Query logging disabled — queries can contain sensitive data.
    // Enable only in controlled debug environments, never in production.
  ],
});

prismaClient.$on('error', (e) => {
  logger.error('Prisma error', { message: e.message, target: e.target });
});

prismaClient.$on('warn', (e) => {
  logger.warn('Prisma warning', { message: e.message, target: e.target });
});

export const prisma = prismaClient;
