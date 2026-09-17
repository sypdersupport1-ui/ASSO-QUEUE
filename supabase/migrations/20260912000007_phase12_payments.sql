-- QueueFlow Phase 12 Migration: Payments Schema Extension, Payment Events, Permissions & RLS
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. EXTEND EXISTING PAYMENTS TABLE
-- ============================================================================

-- Update payments status check constraint to include all Phase 12 FSM states
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check 
  CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'COMPLETED', 'FAILED', 'REFUND_PENDING', 'REFUNDED'));

-- Add payment_method column
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method TEXT NOT NULL DEFAULT 'ONLINE'
  CHECK (payment_method IN ('ONLINE', 'PAY_AT_RESTAURANT', 'CASH', 'MANUAL'));

-- Add attempt_number
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number >= 1);

-- Add provider_order_id & provider_payment_id
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS provider_payment_id TEXT;

-- Add parent_payment_id for refunds or linked attempts
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS parent_payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

-- Add refunded_amount
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (refunded_amount >= 0);

-- Add webhook_event_id for deduplication
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS webhook_event_id TEXT;

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status ON public.payments(restaurant_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_order_status ON public.payments(order_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON public.payments(provider, provider_reference);
CREATE INDEX IF NOT EXISTS idx_payments_webhook_event ON public.payments(webhook_event_id) WHERE webhook_event_id IS NOT NULL;

-- ============================================================================
-- 2. APPEND-ONLY PAYMENT EVENTS AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.payment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    payment_id UUID NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('PAYMENT_CREATED', 'PAYMENT_PROCESSING', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'PAYMENT_REFUND_REQUESTED', 'PAYMENT_REFUNDED', 'PAYMENT_RECONCILED')),
    actor_type TEXT NOT NULL CHECK (actor_type IN ('SYSTEM', 'CUSTOMER', 'STAFF', 'WEBHOOK')),
    actor_id TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_events_payment ON public.payment_events(payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_events_restaurant ON public.payment_events(restaurant_id, created_at DESC);

-- ============================================================================
-- 3. PERMISSIONS SEEDING (RBAC)
-- ============================================================================

INSERT INTO public.permissions (key, domain, description) VALUES
  ('payments.manage', 'PAYMENTS', 'Full management of restaurant payments and attempts'),
  ('payments.reconcile', 'PAYMENTS', 'Perform transaction state reconciliation')
ON CONFLICT (key) DO UPDATE SET
  domain = EXCLUDED.domain,
  description = EXCLUDED.description;

-- Ensure RESTAURANT_ADMIN gets all payments permissions
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions
WHERE domain = 'PAYMENTS'
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- 4. ROW LEVEL SECURITY (RLS) FOR PAYMENTS & PAYMENT EVENTS
-- ============================================================================

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

-- Payments read policy
DROP POLICY IF EXISTS "Staff and admins view payments for assigned restaurant" ON public.payments;
CREATE POLICY "Staff and admins view payments for assigned restaurant"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Payments insert/update policies for staff
DROP POLICY IF EXISTS "Staff and admins manage payments for assigned restaurant" ON public.payments;
CREATE POLICY "Staff and admins manage payments for assigned restaurant"
  ON public.payments FOR ALL
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  )
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Payment Events read policy
DROP POLICY IF EXISTS "Staff and admins view payment events for assigned restaurant" ON public.payment_events;
CREATE POLICY "Staff and admins view payment events for assigned restaurant"
  ON public.payment_events FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );
