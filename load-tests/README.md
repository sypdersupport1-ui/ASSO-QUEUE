# ASSO Queue — Load Testing Infrastructure & Harness

This directory contains the architecture-aware **k6** load testing harness for ASSO Queue.

---

## Architecture Principles & Safety Rules

1. **PostgreSQL is Source of Truth**: Data correctness is as vital as latency. Performance without correctness is a failure.
2. **Environment Protection**: Load tests will **NEVER** target production. The environment guard (`config/environment.js`) automatically aborts execution if `LOAD_TEST_ENVIRONMENT=production` or if production URLs are passed.
3. **Rate Limit Awareness**: Tenant-scoped rate limits (`READ_ONLY: 60/min`, `QUEUE_JOIN: 5/min`, `QUEUE_STATUS: 65/min`) are active. Expected `429 Too Many Requests` status codes represent valid system protection and are distinguished from application `5xx` errors.
4. **Development Isolation**: All load testing work remains on the `load-testing` branch.

---

## Directory Structure

```
load-tests/
├── README.md                 # Execution documentation & safety guidelines
├── config/
│   └── environment.js        # Environment guard & target configuration
├── helpers/
│   └── metrics.js            # Custom k6 metrics, trends & counters
└── scenarios/
    ├── scenario_a_public_read.js   # Public metadata & health check read path
    ├── scenario_b_queue_join.js     # Controlled queue join concurrency
    ├── scenario_c_queue_status.js   # Customer token status lookups
    └── smoke_test_10vu.js           # Orchestrated 10-VU baseline smoke test
```

---

## Prerequisites & Installation

1. Install **k6**:
   - macOS: `brew install k6`
   - Linux: `sudo apt-get install k6` or download binary from [k6.io](https://k6.io)

2. Ensure the target local/staging server is running:
   ```bash
   npm run dev
   ```

---

## Running Load Tests

### 1. Execute 10-VU Baseline Smoke Test (Local Environment)
```bash
LOAD_TEST_ENVIRONMENT=local LOAD_TEST_BASE_URL=http://localhost:3000 k6 run load-tests/scenarios/smoke_test_10vu.js
```

### 2. Run Individual Scenarios
```bash
# Public Read Path
LOAD_TEST_ENVIRONMENT=local k6 run load-tests/scenarios/scenario_a_public_read.js

# Queue Join Path
LOAD_TEST_ENVIRONMENT=local k6 run load-tests/scenarios/scenario_b_queue_join.js
```

---

## Safety Guard Verification

Attempting to target production will immediately halt execution:
```bash
LOAD_TEST_ENVIRONMENT=production LOAD_TEST_BASE_URL=https://queueflow.com k6 run load-tests/scenarios/smoke_test_10vu.js
# Result: [LOAD TEST SAFETY GUARD] Execution refused! Target environment is explicitly set to 'production'.
```
