-- FIX schema gaps from context dump (truncated CHECK + missing uniques + missing perf indexes)
-- Safe to run; all IF NOT EXISTS

-- 1. Fix truncated orders.status CHECK (was `NOT VALI` -> `NOT VALID`)
-- The dump showed: CHECK (...) NOT VALI  <- syntax error, missing D
-- We recreate correctly as NOT VALID (skips validation of existing rows, validated later)
DO $$ BEGIN
  -- Drop broken constraint if it exists with truncated name (if import failed, it won't exist)
  ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status = ANY (ARRAY['DRAFT'::text,'PLACED'::text,'CONFIRMED'::text,'PREPARING'::text,'READY'::text,'SERVED'::text,'CANCELLED'::text]))
  NOT VALID;

-- Validate it (if you want strict)
-- ALTER TABLE public.orders VALIDATE CONSTRAINT orders_status_check;

-- 2. Missing UNIQUE constraints (app expects them for idempotency + tenant safety)
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_slug ON public.restaurants (slug);
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_restaurant_role ON public.restaurant_memberships (user_id, restaurant_id, role);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_table_number ON public.restaurant_tables (restaurant_id, table_number);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_zone_name ON public.restaurant_zones (restaurant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS unique_restaurant_category_name ON public.menu_categories (restaurant_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS unique_payment_idempotency ON public.payments (idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_order_idempotency ON public.orders (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_queue_token_hash ON public.queue_entries (token_hash) WHERE token_hash IS NOT NULL;

-- 3. Performance hot-path indexes (if 20260914 not yet applied, these cover it)
CREATE INDEX IF NOT EXISTS idx_queue_active_hot ON public.queue_entries (restaurant_id, status, joined_at) WHERE status IN ('WAITING','CALLED','NOTIFIED');
CREATE INDEX IF NOT EXISTS idx_queue_token_hash ON public.queue_entries (token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_created ON public.queue_entries (restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created ON public.orders (restaurant_id, status, created_at) WHERE status IN ('PLACED','CONFIRMED','PREPARING','READY');
CREATE INDEX IF NOT EXISTS idx_order_items_order ON public.order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status ON public.payments (restaurant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_menu_items_active_available ON public.menu_items (restaurant_id, active, available, display_order) WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS idx_tables_available_capacity ON public.restaurant_tables (restaurant_id, status, capacity) WHERE status = 'AVAILABLE' AND is_archived = false;
CREATE INDEX IF NOT EXISTS idx_outbox_pending_work ON public.outbox_events (status, next_attempt_at) WHERE status IN ('PENDING','FAILED');

-- 4. Optional: Real QR scan analytics (remove if you don't want tracking)
-- This replaces the fake 1482 scans on QR page with real data. App code will write here via RPC or edge log.
CREATE TABLE IF NOT EXISTS public.qr_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  ip_hash text,
  user_agent text,
  referer text
);
CREATE INDEX IF NOT EXISTS idx_qr_scans_restaurant_time ON public.qr_scans (restaurant_id, scanned_at DESC);
ALTER TABLE public.qr_scans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff view qr_scans" ON public.qr_scans;
CREATE POLICY "Staff view qr_scans" ON public.qr_scans FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT restaurant_id FROM public.restaurant_memberships WHERE user_id = auth.uid() AND status='ACTIVE'));
-- No INSERT policy for anon; inserts should be via service_role or RPC

-- 5. Ensure RLS enabled where your dump omitted it (idempotent)
ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
