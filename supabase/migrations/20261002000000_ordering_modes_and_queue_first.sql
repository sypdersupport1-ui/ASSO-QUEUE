-- ============================================================================
-- QUEUEFLOW: ORDERING MODES & QUEUE-FIRST REVISION
-- Migration: 20261002000000_ordering_modes_and_queue_first.sql
--
-- 1. Adds 4 independent per-outlet ordering capability configurations to restaurants:
--    - dine_in_customer_ordering_enabled
--    - dine_in_staff_ordering_enabled
--    - takeaway_customer_ordering_enabled
--    - takeaway_staff_ordering_enabled
-- 2. Updates complete_takeaway_atomic RPC to enforce that order-backed Takeaway tickets
--    cannot be marked ITEMS RECEIVED while the order is still PREPARING.
-- ============================================================================

-- 1. ADD ORDERING CAPABILITY COLUMNS TO RESTAURANTS
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS dine_in_customer_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS dine_in_staff_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS takeaway_customer_ordering_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS takeaway_staff_ordering_enabled BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.restaurants.dine_in_customer_ordering_enabled IS
  'When true, Dine-In guests holding a queue ticket can browse the menu and self-order.';
COMMENT ON COLUMN public.restaurants.dine_in_staff_ordering_enabled IS
  'When true, staff can take orders for Dine-In guests from the dashboard.';
COMMENT ON COLUMN public.restaurants.takeaway_customer_ordering_enabled IS
  'When true, Takeaway guests holding a queue ticket can browse the menu and self-order.';
COMMENT ON COLUMN public.restaurants.takeaway_staff_ordering_enabled IS
  'When true, staff can take orders for Takeaway guests at the counter when called.';

-- 2. UPDATE complete_takeaway_atomic RPC FOR "ITEMS RECEIVED" FINAL COMPLETION
-- Enforces: For order-backed Takeaway tickets, orders cannot be completed while in PREPARING.
-- Must be READY (or no active order exists).
CREATE OR REPLACE FUNCTION public.complete_takeaway_atomic(
  p_queue_entry_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_order_status TEXT;
  v_order_id UUID;
BEGIN
  -- Lock and fetch entry
  SELECT * INTO v_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- MUST be a Takeaway entry
  IF v_entry.queue_type != 'TAKEAWAY' THEN
    RAISE EXCEPTION 'NOT_TAKEAWAY_ENTRY: complete_takeaway_atomic can only be used for TAKEAWAY entries (entry % is %)',
      p_queue_entry_id, v_entry.queue_type;
  END IF;

  -- Must be in a completable state
  IF v_entry.status NOT IN ('WAITING', 'CALLED', 'NOTIFIED') THEN
    RAISE EXCEPTION 'TAKEAWAY_ENTRY_NOT_COMPLETABLE: Entry is in status %, must be WAITING, CALLED, or NOTIFIED to complete',
      v_entry.status;
  END IF;

  -- Idempotency: already COMPLETED
  IF v_entry.status = 'COMPLETED' THEN
    RETURN jsonb_build_object(
      'success', true,
      'queueEntryId', v_entry.id,
      'status', 'COMPLETED',
      'completedAt', v_entry.completed_at,
      'idempotent', true
    );
  END IF;

  -- Rule 1 Check: If an active linked order exists, verify it is not PREPARING
  SELECT id, status INTO v_order_id, v_order_status
  FROM public.orders
  WHERE queue_entry_id = p_queue_entry_id
    AND status NOT IN ('CANCELLED', 'SERVED')
  LIMIT 1;

  IF v_order_status = 'PREPARING' THEN
    RAISE EXCEPTION 'CANNOT_RECEIVE_WHILE_PREPARING: Order is currently being prepared. It must be marked READY before items can be received.';
  END IF;

  -- Transition queue entry to COMPLETED (ITEMS RECEIVED)
  UPDATE public.queue_entries SET
    status = 'COMPLETED',
    completed_at = v_now,
    updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;

  -- Transition any active linked orders to SERVED
  IF v_order_id IS NOT NULL THEN
    UPDATE public.orders SET
      status = 'SERVED',
      updated_at = v_now
    WHERE id = v_order_id;
  END IF;

  -- Queue event (ITEMS_RECEIVED marks final handover)
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_entry.restaurant_id,
    p_queue_entry_id,
    'TAKEAWAY_ITEMS_RECEIVED',
    p_actor_user_id,
    jsonb_build_object(
      'queue_type', 'TAKEAWAY',
      'completed_at', v_now,
      'actor_user_id', p_actor_user_id,
      'display_number', v_entry.display_number,
      'customer_name', v_entry.customer_name,
      'stage', 'ITEMS_RECEIVED'
    )
  );

  -- Outbox for notification pipeline
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_entry.restaurant_id,
    'TAKEAWAY_ITEMS_RECEIVED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'queueEntryId', p_queue_entry_id,
      'displayNumber', v_entry.display_number,
      'customerName', v_entry.customer_name,
      'queueType', 'TAKEAWAY',
      'completedAt', v_now,
      'stage', 'ITEMS_RECEIVED'
    ),
    'PENDING'
  );

  -- Realtime broadcast
  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', v_entry.restaurant_id,
    'entry_id', p_queue_entry_id,
    'event', 'TAKEAWAY_ITEMS_RECEIVED',
    'queue_type', 'TAKEAWAY',
    'status', 'COMPLETED'
  )::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'displayNumber', v_entry.display_number,
    'status', 'COMPLETED',
    'completedAt', v_now,
    'stage', 'ITEMS_RECEIVED'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_takeaway_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_takeaway_atomic(UUID, UUID) TO service_role;
