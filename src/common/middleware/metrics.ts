import type { Request, Response, NextFunction } from 'express';
import { httpRequestsTotal, httpRequestDuration, httpRequestsInFlight } from '../metrics/index';

/**
 * Normalise a URL path to a low-cardinality route label.
 * Strips UUIDs, numeric IDs, and query strings.
 */
function normaliseRoute(req: Request): string {
  // Use Express matched route if available (most accurate)
  const matched = req.route?.path as string | undefined;
  if (matched) {
    const base = req.baseUrl ?? '';
    return `${base}${matched}`;
  }

  // Fall back to path with IDs stripped
  return req.path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    .replace(/\/\d+/g, '/:id');
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = process.hrtime.bigint();
  const method = req.method;

  // Skip the /metrics endpoint itself — don't record metrics about metrics
  if (req.path === '/metrics') {
    next();
    return;
  }

  // Increment in-flight gauge
  // Route isn't matched yet so use raw path (normalised later on response)
  httpRequestsInFlight.inc({ method, route: req.path });

  res.on('finish', () => {
    const route = normaliseRoute(req);
    const statusCode = String(res.statusCode);
    const durationNs = process.hrtime.bigint() - startTime;
    const durationS = Number(durationNs) / 1e9;

    // Decrement in-flight with original path, increment with normalised route
    httpRequestsInFlight.dec({ method, route: req.path });

    httpRequestsTotal.inc({ method, route, status_code: statusCode });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, durationS);
  });

  next();
}


