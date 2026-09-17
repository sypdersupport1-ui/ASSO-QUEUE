-- ============================================================================
-- QUEUEFLOW PHASE 11 MIGRATION: ORDERS & KITCHEN OPERATIONS
-- ============================================================================

-- 1. UPDATE ORDERS SCHEMA FOR PHASE 11
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS order_token TEXT,
  ADD COLUMN IF NOT EXISTS order_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

-- Update CHECK constraint on orders.status to include Phase 11 FSM states
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_status_check 
  CHECK (status IN ('DRAFT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED', 'PENDING', 'ACCEPTED', 'IN_PREPARATION', 'COMPLETED'));

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_orders_token_hash ON public.orders (order_token_hash) WHERE order_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status ON public.orders (restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_queue_entry ON public.orders (queue_entry_id) WHERE queue_entry_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idempotency ON public.orders (restaurant_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- 2. ORDER EVENTS AUDIT TABLE (APPEND-ONLY)
CREATE TABLE IF NOT EXISTS public.order_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_events_order ON public.order_events (order_id, created_at DESC);

-- Enable RLS on order_events
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

-- 3. RLS POLICIES FOR ORDERS & ORDER_EVENTS
-- Staff RLS Policy for Order Events
DROP POLICY IF EXISTS "Staff can select order events in own restaurant" ON public.order_events;
CREATE POLICY "Staff can select order events in own restaurant"
  ON public.order_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships rm
      WHERE rm.restaurant_id = public.order_events.restaurant_id
        AND rm.user_id = auth.uid()
        AND rm.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "Staff can insert order events in own restaurant" ON public.order_events;
CREATE POLICY "Staff can insert order events in own restaurant"
  ON public.order_events FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships rm
      WHERE rm.restaurant_id = public.order_events.restaurant_id
        AND rm.user_id = auth.uid()
        AND rm.status = 'ACTIVE'
    )
  );

-- 4. SEED RBAC PERMISSIONS FOR ORDERS & KITCHEN MANAGEMENT
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('orders.view', 'ORDERS', 'View restaurant orders and order details'),
  ('orders.create', 'ORDERS', 'Create restaurant orders'),
  ('orders.update', 'ORDERS', 'Update restaurant order status'),
  ('orders.cancel', 'ORDERS', 'Cancel restaurant order'),
  ('kitchen.view', 'KITCHEN', 'View kitchen order tickets and queue'),
  ('kitchen.manage', 'KITCHEN', 'Manage kitchen order preparation and status')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key IN ('orders.view', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.view', 'kitchen.manage')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions WHERE key IN ('orders.view', 'orders.create', 'orders.update', 'orders.cancel', 'kitchen.view', 'kitchen.manage')
ON CONFLICT (role, permission_id) DO NOTHING;
