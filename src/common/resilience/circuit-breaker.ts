import CircuitBreaker from 'opossum';
import { registry } from '../metrics/index';
import { logger } from '../utils/logger';
import { AppError, ErrorCode } from '../errors/AppError';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BreakerOptions {
  /** Human-readable name — used in logs and metrics */
  name: string;
  /** Timeout per call in ms. Default: 10000 */
  timeout?: number;
  /** % of failures before opening. Default: 50 */
  errorThresholdPercentage?: number;
  /** Ms to wait before trying half-open. Default: 30000 */
  resetTimeout?: number;
  /** Min calls before computing error rate. Default: 5 */
  volumeThreshold?: number;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createBreaker<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  options: BreakerOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): CircuitBreaker<any[], any> {
  const breaker = new CircuitBreaker(fn, {
    name: options.name,
    timeout: options.timeout ?? 10_000,
    errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
    resetTimeout: options.resetTimeout ?? 30_000,
    volumeThreshold: options.volumeThreshold ?? 5,
    // Don't trip on timeouts alone — only trip when error rate exceeds threshold
    allowWarmUp: true,
  });

  // ---------------------------------------------------------------------------
  // Logging
  // ---------------------------------------------------------------------------

  breaker.on('open', () => {
    logger.error(`Circuit breaker OPEN — ${options.name}`, {
      service: options.name,
      state: 'open',
    });
  });

  breaker.on('halfOpen', () => {
    logger.warn(`Circuit breaker HALF-OPEN — testing ${options.name}`, {
      service: options.name,
      state: 'half_open',
    });
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker CLOSED — ${options.name} recovered`, {
      service: options.name,
      state: 'closed',
    });
  });

  breaker.on('timeout', () => {
    logger.warn(`Circuit breaker timeout — ${options.name}`, {
      service: options.name,
      timeout_ms: options.timeout ?? 10_000,
    });
  });

  breaker.on('reject', () => {
    logger.warn(`Circuit breaker rejected call — ${options.name} is OPEN`, {
      service: options.name,
    });
  });

  // ---------------------------------------------------------------------------
  // Prometheus metrics — one gauge per breaker for state (0=closed,1=open,2=half)
  // ---------------------------------------------------------------------------

  const safeName = options.name.replace(/[^a-zA-Z0-9_]/g, '_');

  try {
    const { Gauge, Counter } = require('prom-client') as typeof import('prom-client');

    const stateGauge = new Gauge({
      name: `circuit_breaker_state_${safeName}`,
      help: `Circuit breaker state for ${options.name} (0=closed, 1=open, 2=half_open)`,
      registers: [registry],
    });

    const callsCounter = new Counter({
      name: `circuit_breaker_calls_total_${safeName}`,
      help: `Total calls through ${options.name} circuit breaker`,
      labelNames: ['outcome'], // success | failure | timeout | rejected
      registers: [registry],
    });

    breaker.on('close', () => stateGauge.set(0));
    breaker.on('open', () => stateGauge.set(1));
    breaker.on('halfOpen', () => stateGauge.set(2));

    breaker.on('success', () => callsCounter.inc({ outcome: 'success' }));
    breaker.on('failure', () => callsCounter.inc({ outcome: 'failure' }));
    breaker.on('timeout', () => callsCounter.inc({ outcome: 'timeout' }));
    breaker.on('reject', () => callsCounter.inc({ outcome: 'rejected' }));

    // Start closed
    stateGauge.set(0);
  } catch {
    // prom-client not available — metrics optional, breaker still works
  }

  // ---------------------------------------------------------------------------
  // Map opossum errors to AppError so the API returns clean responses
  // ---------------------------------------------------------------------------

  breaker.fallback(() => {
    throw new AppError(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      `${options.name} is temporarily unavailable. Please try again shortly.`,
    );
  });

  return breaker;
}

// ---------------------------------------------------------------------------
// Helper — fire a breaker and unwrap the result
// Throws AppError on open circuit or provider failure
// ---------------------------------------------------------------------------

export async function fire<T>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  breaker: CircuitBreaker<any[], T>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
): Promise<T> {
  return breaker.fire(...args) as Promise<T>;
}
