-- ============================================================================
-- TAKEAWAY PHASE 4: PRODUCTION HARDENING & DUPLICATE ORDER INVARIANT
-- ============================================================================
-- Enforces at the database level that a queue entry can have at most one active
-- (non-cancelled) order. Prevents race conditions from concurrent customer or
-- staff submissions from ever inserting duplicate active orders for the same ticket.

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_active_queue_entry
  ON public.orders (queue_entry_id)
  WHERE queue_entry_id IS NOT NULL AND status NOT IN ('CANCELLED');
