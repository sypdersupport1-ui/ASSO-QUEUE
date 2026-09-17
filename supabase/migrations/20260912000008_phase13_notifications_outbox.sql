-- QueueFlow Phase 13 Migration: Notifications Channel Extension, Outbox Pattern & Background Workers Schema
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. EXTEND NOTIFICATIONS TABLE SCHEMA
-- ============================================================================

-- Update channel CHECK constraint to support IN_APP, SMS, WHATSAPP, EMAIL, PUSH
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_channel_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_channel_check 
  CHECK (channel IN ('IN_APP', 'SMS', 'WHATSAPP', 'EMAIL', 'PUSH'));

-- Ensure recipient and message can be null for system in-app alerts if necessary
ALTER TABLE public.notifications ALTER COLUMN recipient DROP NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN provider SET DEFAULT 'IN_APP';

CREATE INDEX IF NOT EXISTS idx_notifications_queue_entry ON public.notifications(queue_entry_id) WHERE queue_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_order ON public.notifications(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notifications_status ON public.notifications(restaurant_id, status);

-- ============================================================================
-- 2. TRANSACTIONAL OUTBOX EVENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    aggregate_type TEXT NOT NULL CHECK (aggregate_type IN ('QUEUE', 'ORDER', 'PAYMENT', 'STAFF', 'SYSTEM')),
    aggregate_id TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INT NOT NULL DEFAULT 5 CHECK (max_retries >= 1),
    last_error TEXT,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_work ON public.outbox_events(status, next_attempt_at) WHERE status IN ('PENDING', 'FAILED');
CREATE INDEX IF NOT EXISTS idx_outbox_restaurant ON public.outbox_events(restaurant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate ON public.outbox_events(aggregate_type, aggregate_id);

-- ============================================================================
-- 3. ROW LEVEL SECURITY (RLS) FOR NOTIFICATIONS & OUTBOX
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outbox_events ENABLE ROW LEVEL SECURITY;

-- Notifications SELECT policy for staff
DROP POLICY IF EXISTS "Staff view notifications for assigned restaurant" ON public.notifications;
CREATE POLICY "Staff view notifications for assigned restaurant"
  ON public.notifications FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );

-- Outbox events RLS policy for staff & service role
DROP POLICY IF EXISTS "Staff view outbox events for assigned restaurant" ON public.outbox_events;
CREATE POLICY "Staff view outbox events for assigned restaurant"
  ON public.outbox_events FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (
      SELECT restaurant_id FROM public.restaurant_memberships
      WHERE user_id = auth.uid() AND status = 'ACTIVE'
    )
  );
