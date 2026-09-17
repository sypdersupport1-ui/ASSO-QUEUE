-- Phase 3E: constraint + RLS tightening (idempotent, safe to re-run).
--
-- 1. user_profiles INSERT was open (WITH CHECK(true) for any authenticated
--    user -> profile squatting with arbitrary ids). Restrict direct inserts
--    to self; the app writes via service_role (BYPASSRLS, unaffected).
-- 2. queue token_hash uniqueness was GLOBAL (cross-tenant squat/DoS).
--    Scope to (restaurant_id, token_hash). Data-safe: global uniqueness
--    implies scoped uniqueness.
-- 3. payments idempotency was GLOBAL (UNIQUE constraint + partial index).
--    Scope both to (restaurant_id, idempotency_key). Data-safe likewise.
-- 4. Direct authenticated UPDATE of queue_entries.status bypassed the FSM
--    (RLS checks tenant only). Revoke the column grant; all app writes go
--    through service_role RPCs/services (unaffected).
-- 5. Validate the orders status checks (no legacy violating rows exist).

-- 1. user_profiles INSERT: self-only for authenticated, open for service_role.
DROP POLICY IF EXISTS "Allow system insert" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Service role can insert profiles" ON public.user_profiles;
CREATE POLICY "Users can insert own profile"
  ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());
CREATE POLICY "Service role can insert profiles"
  ON public.user_profiles FOR INSERT TO service_role
  WITH CHECK (true);

-- 2. Scoped queue token uniqueness.
DROP INDEX IF EXISTS public.unique_queue_token_hash;
CREATE UNIQUE INDEX IF NOT EXISTS unique_queue_token_hash
  ON public.queue_entries (restaurant_id, token_hash)
  WHERE token_hash IS NOT NULL;

-- 3. Scoped payment idempotency.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_idempotency_key_key;
DROP INDEX IF EXISTS public.unique_payment_idempotency;
CREATE UNIQUE INDEX IF NOT EXISTS unique_payment_idempotency
  ON public.payments (restaurant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- 4. (Enforcement moved to 20260925000002: PostgreSQL privileges are purely
--    additive, so a column-level REVOKE cannot subtract from the table-level
--    UPDATE grant — a BEFORE UPDATE trigger enforces the FSM instead.)

-- 5. Validate orders status checks (legacy rows verified clean).
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;
ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_authoritative_check;
