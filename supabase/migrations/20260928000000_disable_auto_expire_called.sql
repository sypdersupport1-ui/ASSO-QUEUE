-- Migration: 20260928000000_disable_auto_expire_called.sql
-- Description: Keep timed out / overdue called queue entries in the active queue instead of clearing them automatically.
-- Adds auto_expire_called column to restaurants (default false).
-- Updates expire_overdue_called_queue_entries() so it ONLY expires entries if r.auto_expire_called IS TRUE.

ALTER TABLE public.restaurants 
  ADD COLUMN IF NOT EXISTS auto_expire_called BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.auto_expire_called IS 'When true, overdue called queue entries are automatically transitioned to NO_SHOW. When false (default), called entries remain in the queue as Overdue so staff can seat them or manually decide to mark no-show.';

CREATE OR REPLACE FUNCTION public.expire_overdue_called_queue_entries(p_limit INT DEFAULT 50)
RETURNS TABLE (expired_count INT, expired_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids UUID[] := '{}';
  v_count INT := 0;
BEGIN
  -- Step 1: lock + transition overdue rows ONLY for restaurants that explicitly opted into auto-expire
  WITH overdue AS (
    SELECT qe.id
    FROM public.queue_entries qe
    JOIN public.restaurants r ON r.id = qe.restaurant_id
    WHERE qe.status = 'CALLED'
      AND qe.called_at IS NOT NULL
      AND r.auto_expire_called IS TRUE
      AND r.call_timeout_minutes IS NOT NULL
      AND r.call_timeout_minutes > 0
      AND NOW() > qe.called_at + (r.call_timeout_minutes || ' minutes')::INTERVAL
    ORDER BY qe.called_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE OF qe SKIP LOCKED
  ),
  updated AS (
    UPDATE public.queue_entries qe
    SET status = 'NO_SHOW',
        no_show_at = NOW(),
        no_show_reason = 'CUSTOMER_DID_NOT_RESPOND',
        updated_at = NOW()
    FROM overdue o
    WHERE qe.id = o.id AND qe.status = 'CALLED'
    RETURNING qe.id, qe.restaurant_id, qe.customer_name, qe.display_number
  )
  SELECT COALESCE(array_agg(u.id), '{}'), count(*) INTO v_ids, v_count FROM updated u;

  -- Step 2: side effects for exactly the transitioned rows (same transaction = atomic)
  IF v_count > 0 THEN
    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    SELECT qe.restaurant_id, qe.id, 'QUEUE_NO_SHOW',
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true)
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    SELECT qe.restaurant_id, 'QUEUE_NO_SHOW', 'QUEUE', qe.id::text,
           jsonb_build_object('reason', 'CUSTOMER_DID_NOT_RESPOND', 'auto', true,
                              'customerName', qe.customer_name, 'displayNumber', qe.display_number),
           'PENDING'
    FROM public.queue_entries qe
    WHERE qe.id = ANY (v_ids);
  END IF;

  -- pg_notify per expired row (best-effort realtime; polling fallback covers failures)
  IF v_count > 0 THEN
    PERFORM pg_notify('queue_entry_update',
      json_build_object('event', 'QUEUE_NO_SHOW', 'auto', true, 'count', v_count)::text);
  END IF;

  RETURN QUERY SELECT v_count, COALESCE(v_ids, '{}');
END;
$$;

REVOKE ALL ON FUNCTION public.expire_overdue_called_queue_entries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) TO service_role;
