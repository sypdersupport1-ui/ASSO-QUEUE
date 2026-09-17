-- Performance Snappy: composite indexes for hot paths + queue active lookup
-- Run: psql or supabase db push - this is safe IF NOT EXISTS

-- 1. Queue active lookup (WAITING/CALLED/NOTIFIED) - used by getActiveQueue + dashboard KPIs
CREATE INDEX IF NOT EXISTS idx_queue_active_hot
  ON public.queue_entries (restaurant_id, status, joined_at)
  WHERE status IN ('WAITING','CALLED','NOTIFIED');

-- 2. Queue daily filtering by created_at (today calcs)
CREATE INDEX IF NOT EXISTS idx_queue_restaurant_created
  ON public.queue_entries (restaurant_id, created_at DESC);

-- 3. Orders hot path - kitchen display & dashboard orders (status + FIFO)
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_status_created
  ON public.orders (restaurant_id, status, created_at)
  WHERE status IN ('PLACED','CONFIRMED','PREPARING','READY');

-- 4. Payments lookup by restaurant + status (reconcile, list)
CREATE INDEX IF NOT EXISTS idx_payments_restaurant_status
  ON public.payments (restaurant_id, status, created_at DESC);

-- 5. Menu active available fast browse
CREATE INDEX IF NOT EXISTS idx_menu_items_active_available
  ON public.menu_items (restaurant_id, active, available, display_order)
  WHERE is_archived = false;

-- 6. Tables availability fast seating
CREATE INDEX IF NOT EXISTS idx_tables_available_capacity
  ON public.restaurant_tables (restaurant_id, status, capacity)
  WHERE status = 'AVAILABLE' AND is_archived = false;

-- 7. Outbox pending work already indexed, add cover for retries
CREATE INDEX IF NOT EXISTS idx_outbox_next_attempt_cover
  ON public.outbox_events (next_attempt_at) WHERE status IN ('PENDING','FAILED');

-- 8. Audit logs recent per restaurant
CREATE INDEX IF NOT EXISTS idx_audit_recent
  ON public.audit_logs (restaurant_id, created_at DESC);

-- Comment: no new tables needed for speed. Current 15 tables cover all flows.
-- If you add new tables (e.g., restaurant_settings, qr_scans), share schema and we will generate FK + RLS + indexes.
