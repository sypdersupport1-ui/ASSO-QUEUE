# QueueFlow Production Readiness Checklist

> Generated: Phase 15 — Production Hardening
> Product: QueueFlow — Restaurant Digital Waiting Line SaaS

---

## 1. Authentication & Authorization

| Check | Status | Notes |
|-------|--------|-------|
| Supabase Auth JWT validation in middleware | ✅ PASS | `src/middleware.ts` |
| Dashboard routes require authenticated session | ✅ PASS | Middleware guards all `/dashboard/*` |
| Platform routes restricted to SUPER_ADMIN | ✅ PASS | `platform.*` permission required |
| RBAC deny-by-default model | ✅ PASS | `AuthorizationService.hasPermission()` |
| Staff permission overrides (ALLOW/DENY) | ✅ PASS | `staff_permission_overrides` table |
| Analytics page RBAC-enforced | ✅ PASS | `analytics.view` permission required |
| `requireAuth()` used in all protected services | ✅ PASS | `RestaurantAdminService`, `AuthorizationService` |
| Restaurant ID resolved server-side (never client-supplied) | ✅ PASS | `getAuthorizedRestaurantContext()` |

---

## 2. Multi-Tenant Isolation

| Check | Status | Notes |
|-------|--------|-------|
| Row Level Security (RLS) enabled on all tables | ✅ PASS | Phase 2–8 migrations |
| Admin client (`server-only`) guards service role | ✅ PASS | `src/lib/db/supabase/admin.ts` |
| Service role key never in `NEXT_PUBLIC_*` | ✅ PASS | Env schema enforces this |
| Cross-tenant writes blocked by RLS | ✅ PASS | `restaurant_id` RLS policies |
| Atomic seating validates tenant match | ✅ PASS | `seat_queue_entry_atomic` RPC |
| Atomic queue join validates restaurant ownership | ✅ PASS | `join_queue_atomic` RPC |

---

## 3. Customer Bearer Token Security

| Check | Status | Notes |
|-------|--------|-------|
| Raw token is `crypto.randomBytes(32)` (256-bit) | ✅ PASS | `token-utils.ts` |
| Only SHA-256 hash stored in database | ✅ PASS | `queue_entries.token_hash` |
| Raw token never logged | ✅ PASS | Redactor covers `token` key |
| Token used for read-only status lookup | ✅ PASS | No write access via token alone |
| Status page limited to token-holder's data only | ✅ PASS | Lookup is `WHERE token_hash = ?` |

---

## 4. Concurrency & Correctness

| Check | Status | Notes |
|-------|--------|-------|
| Queue join is atomic (capacity + duplicate check) | ✅ PASS | `join_queue_atomic` PostgreSQL RPC |
| Table seating is atomic (availability + tenant match) | ✅ PASS | `seat_queue_entry_atomic` PostgreSQL RPC |
| Queue FSM state transitions validated | ✅ PASS | `QueueService.updateQueueStatus()` |
| Order FSM state transitions validated | ✅ PASS | `OrderService` state machine |
| Payment FSM state transitions validated | ✅ PASS | `isValidPaymentTransition()` |
| Inventory deduction is atomic | ✅ PASS | `deduct_inventory_atomic` RPC |
| Outbox worker uses `FOR UPDATE SKIP LOCKED` | ✅ PASS | `claim_outbox_events` RPC (Phase 15) |
| Payment idempotency keys enforced | ✅ PASS | `payments.idempotency_key` UNIQUE index |
| Webhook event deduplication | ✅ PASS | `webhook_event_id` UNIQUE index |

---

## 5. API Security

| Check | Status | Notes |
|-------|--------|-------|
| Cron worker endpoint protected by `CRON_SECRET` | ✅ PASS | Constant-time comparison (Phase 15) |
| Payment webhook signature verified | ✅ PASS | Razorpay HMAC-SHA256 verification |
| Rate limiting on payment intent (5 req/min/IP) | ✅ PASS | Phase 15 |
| Rate limiting on payment verify (10 req/min/IP) | ✅ PASS | Phase 15 |
| Zod schema validation on all service inputs | ✅ PASS | All services use `schema.parse()` |
| `toSafeErrorResponse()` prevents stack trace leakage | ✅ PASS | `src/lib/errors/index.ts` |

---

## 6. HTTP Security Headers

| Header | Status | Notes |
|--------|--------|-------|
| `Strict-Transport-Security` | ✅ PASS | 2-year HSTS with preload |
| `X-Content-Type-Options: nosniff` | ✅ PASS | |
| `X-Frame-Options: DENY` | ✅ PASS | SAMEORIGIN for `/q/*` QR pages |
| `X-XSS-Protection` | ✅ PASS | |
| `Referrer-Policy` | ✅ PASS | strict-origin-when-cross-origin |
| `Permissions-Policy` | ✅ PASS | Phase 15 — disables camera, mic, geo, payment |
| `Content-Security-Policy` | ✅ PASS | Phase 15 — permissive but defined |
| `X-Powered-By` removed | ✅ PASS | `poweredByHeader: false` |

---

## 7. Observability & Logging

| Check | Status | Notes |
|-------|--------|-------|
| Structured JSON logging | ✅ PASS | `src/lib/logging/logger.ts` |
| PII redaction (phone, tokens, keys) | ✅ PASS | `src/lib/logging/redactor.ts` |
| Correlation ID propagation | ✅ PASS | `x-correlation-id` header |
| Outbox failures logged at ERROR level | ✅ PASS | Phase 15 — upgraded from console.error |
| Audit log for all staff actions | ✅ PASS | `audit_logs` table |
| Health endpoint with DB + Redis checks | ✅ PASS | Phase 15 — upgraded `/api/health` |

---

## 8. Background Workers

| Check | Status | Notes |
|-------|--------|-------|
| Transactional outbox pattern | ✅ PASS | `outbox_events` table |
| Exponential backoff on failures | ✅ PASS | `OutboxService.markFailed()` |
| Max retry cap | ✅ PASS | `max_retries` per event |
| Worker endpoint secured | ✅ PASS | `CRON_SECRET` required (Phase 15) |
| Concurrent-safe event claiming | ✅ PASS | `FOR UPDATE SKIP LOCKED` (Phase 15) |

---

## 9. Performance

| Check | Status | Notes |
|-------|--------|-------|
| Index on `queue_entries.token_hash` | ✅ PASS | Phase 15 migration |
| Index on active queue entries per restaurant | ✅ PASS | Phase 15 migration |
| Index on `outbox_events` pending poll | ✅ PASS | Phase 15 migration |
| Index on `orders` by restaurant+status | ✅ PASS | Phase 15 migration |
| Index on `payments` by restaurant+date | ✅ PASS | Phase 15 migration |
| Index on `notifications` unread by user | ✅ PASS | Phase 15 migration |
| Redis caching with in-memory fallback | ✅ PASS | `src/lib/redis/index.ts` |
| Analytics via PostgreSQL RPC functions | ✅ PASS | Phase 14 migrations |

---

## 10. Deployment Requirements

| Requirement | Status | Notes |
|-------------|--------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Required | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Required | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Server-only service role |
| `APPLICATION_URL` | Required | Your production domain |
| `CRON_SECRET` | **Required for production** | Protects worker endpoint |
| `REDIS_URL` | Recommended | Falls back to in-memory without it |
| `RAZORPAY_KEY_ID` | If using Razorpay | Payment provider |
| `RAZORPAY_KEY_SECRET` | If using Razorpay | Payment provider |
| `RAZORPAY_WEBHOOK_SECRET` | If using Razorpay | Webhook signature verification |
| All migrations applied | Required | Run `supabase db push` or apply sequentially |
| `analytics.view` permission seeded | Required | Phase 15 migration handles this |

---

## 11. CI/CD

| Check | Status | Notes |
|-------|--------|-------|
| Lint gate | ✅ PASS | `.github/workflows/ci.yml` |
| TypeScript gate | ✅ PASS | `.github/workflows/ci.yml` |
| Unit test gate | ✅ PASS | `.github/workflows/ci.yml` |
| Production build gate | ✅ PASS | `.github/workflows/ci.yml` |
| Integration tests (with secrets) | ✅ PASS | Runs on push to main/develop |

---

## Known Architectural Constraints

> [!NOTE]
> **Outbox Atomicity**: The outbox `publishEvent` call is not in the same PostgreSQL transaction as the domain mutation (e.g. queue join, order creation). This is because the Supabase JS client does not expose raw transaction handles. The outbox pattern still provides eventual delivery via retries — the only failure mode is if the main mutation succeeds and the outbox INSERT fails and the process crashes before logging. This risk is accepted and documented. A true transactional outbox would require a raw `pg` client or a PostgreSQL trigger.

> [!NOTE]
> **Rate Limiting Scope**: Rate limiting is applied at the per-IP level for payment endpoints. If the application sits behind a proxy that normalizes all IPs (e.g. single-IP NAT), limits may be hit faster. Ensure `x-forwarded-for` is trusted and forwarded correctly by the hosting platform (Vercel handles this automatically).
