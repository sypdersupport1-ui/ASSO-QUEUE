-- Phase 1 Realtime Infrastructure: enable Supabase Realtime for operational tables
-- Postgres is truth, Realtime is delivery, Browser is presentation

-- 1. Set REPLICA IDENTITY FULL to ensure postgres_changes publishes full row (needed for UPDATE/DELETE)
ALTER TABLE public.queue_entries REPLICA IDENTITY FULL;
ALTER TABLE public.restaurant_tables REPLICA IDENTITY FULL;
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.notifications REPLICA IDENTITY FULL;
ALTER TABLE public.queue_events REPLICA IDENTITY FULL;
ALTER TABLE public.order_events REPLICA IDENTITY FULL;

-- 2. Add tables to supabase_realtime publication (idempotent)
DO $$
BEGIN
  -- queue_entries
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_entries;
  END IF;
  -- restaurant_tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'restaurant_tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_tables;
  END IF;
  -- orders
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;
  -- notifications
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
  -- queue_events (for timeline)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'queue_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.queue_events;
  END IF;
  -- order_events
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_events;
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- If publication doesn't exist (local dev), create it
  CREATE PUBLICATION supabase_realtime FOR TABLE public.queue_entries, public.restaurant_tables, public.orders, public.notifications, public.queue_events, public.order_events;
END $$;

-- 3. Ensure RLS still enforced for realtime (no policy change needed for staff - existing tenant isolation already covers realtime)
-- Customer broadcast channel does not require RLS (bearer token via channel name), so no anon policy weakening.

-- 4. Comment for observability
COMMENT ON TABLE public.queue_entries IS 'Realtime enabled: staff subscribed via restaurant_id=eq., customer via broadcast queue-entry:<id>';
COMMENT ON TABLE public.restaurant_tables IS 'Realtime enabled: staff subscribed via restaurant_id=eq.';
COMMENT ON TABLE public.orders IS 'Realtime enabled: staff/kitchen subscribed via restaurant_id=eq.';
