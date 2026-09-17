-- QueueFlow Phase 15 Migration: Production Hardening
-- Adds atomic outbox event claiming with FOR UPDATE SKIP LOCKED
-- to prevent concurrent worker double-processing.
-- Also adds supporting performance indexes.

-- ============================================================================
-- 1. ATOMIC OUTBOX EVENT CLAIMING FUNCTION
-- ============================================================================
-- Uses SELECT ... FOR UPDATE SKIP LOCKED to safely claim a batch of pending
-- outbox events for processing. Concurrent workers will not receive the same
-- events because SKIP LOCKED causes other workers to skip already-locked rows.
--
-- This replaces the previous plain SELECT in OutboxService.getPendingEvents().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit INT DEFAULT 20)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.outbox_events
  WHERE status IN ('PENDING', 'FAILED')
    AND next_attempt_at <= NOW()
  ORDER BY next_attempt_at ASC
  LIMIT p_limit
  FOR UPDATE SKIP LOCKED;
END;
$$;

-- ============================================================================
-- 2. PERFORMANCE INDEXES FOR PRODUCTION QUERY PATTERNS
-- ============================================================================

-- Outbox polling — used heavily by the background worker
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending_poll
  ON public.outbox_events (next_attempt_at ASC)
  WHERE status IN ('PENDING', 'FAILED');

-- Queue status by token_hash — critical for every customer status check
-- (already created in Phase 8, but confirm it exists with correct column)
CREATE INDEX IF NOT EXISTS idx_queue_entries_token_hash
  ON public.queue_entries (token_hash)
  WHERE token_hash IS NOT NULL;

-- Active queue listing for staff dashboard
CREATE INDEX IF NOT EXISTS idx_queue_entries_active_restaurant
  ON public.queue_entries (restaurant_id, joined_at ASC, id ASC)
  WHERE status IN ('WAITING', 'NOTIFIED', 'CALLED');

-- Orders by restaurant + status for kitchen and order list views
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created
  ON public.orders (restaurant_id, status, created_at DESC);

-- Payments lookup for reconciliation and analytics
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_created
  ON public.payments (restaurant_id, created_at DESC)
  WHERE status = 'SUCCEEDED';

-- Notifications inbox for staff/customer polling
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS recipient_user_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_notifications_recipient_unread
  ON public.notifications (recipient_user_id, created_at DESC)
  WHERE is_read = FALSE;

-- Analytics: queue join date range scans
CREATE INDEX IF NOT EXISTS idx_queue_entries_joined_at_range
  ON public.queue_entries (restaurant_id, joined_at, status);

-- ============================================================================
-- 3. ADD ANALYTICS.VIEW PERMISSION IF MISSING
-- ============================================================================
-- (Idempotent — already seeded by Phase 14, but safe to re-run)
INSERT INTO public.permissions (key, domain, description)
VALUES ('analytics.view', 'ANALYTICS', 'View restaurant operational and commerce analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'analytics.view'
ON CONFLICT (role, permission_id) DO NOTHING;
