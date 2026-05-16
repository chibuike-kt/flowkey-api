# FlowKey Load Tests

These tests use [k6](https://k6.io) — a separate binary, not an npm package.

## Install k6

**macOS:**
```bash
brew install k6
```

**Linux:**
```bash
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
  --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

**Windows:** Download from https://k6.io/docs/getting-started/installation/

## Environment variables

Set these before running:
```bash
export BASE_URL=https://your-api.render.com
export TEST_USER_EMAIL=loadtest@yourapp.com
export TEST_USER_PHONE=+2348000000000
```

For local testing:
```bash
export BASE_URL=http://localhost:3000
```

## Run a test

```bash
# Quick smoke test — 1 VU, 30 seconds
k6 run tests/load/smoke.js

# Auth flow — simulate concurrent registrations and logins
k6 run tests/load/auth.js

# Wallet flow — fund and transfer
k6 run tests/load/wallet.js

# Full system stress test — 2x expected peak
k6 run tests/load/stress.js

# Spike test — sudden burst
k6 run tests/load/spike.js
```

## What each test does

| Test | VUs | Duration | Purpose |
|---|---|---|---|
| `smoke.js` | 1 | 30s | Verify test setup works, API is reachable |
| `auth.js` | 20 | 3m | Registration, OTP, login, session refresh under concurrent load |
| `wallet.js` | 30 | 5m | Balance checks, deposit, transfer — the hot paths |
| `stress.js` | 100 | 10m | Ramp to 100 VUs — find the ceiling |
| `spike.js` | 0→200→0 | 3m | Sudden burst — test autoscaling and rate limiting |

## Pass/fail thresholds

Tests fail automatically if:
- HTTP error rate > 1%
- P95 latency > 500ms
- P99 latency > 1000ms

These match the P99 < 200ms target from the architecture blueprint — we're
being conservative here since some endpoints (KYC, transfers) legitimately
take longer.
