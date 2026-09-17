-- Migration: 20260930000000_customer_call_response.sql
-- Description: Customer Table-Call Response Flow
-- Adds call response tracking to queue_entries and creates atomic respond_to_call_atomic RPC.

-- 1. EXTEND QUEUE_ENTRIES WITH CALL RESPONSE TRACKING
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS call_response TEXT CHECK (call_response IS NULL OR call_response IN ('ACCEPTED', 'DELAY_REQUESTED', 'DECLINED')),
  ADD COLUMN IF NOT EXISTS call_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_delay_minutes INT CHECK (call_delay_minutes IS NULL OR call_delay_minutes > 0);

-- 2. CREATE ATOMIC CALL RESPONSE RPC
CREATE OR REPLACE FUNCTION public.respond_to_call_atomic(
  p_queue_entry_id UUID,
  p_token_hash TEXT,
  p_response TEXT,
  p_delay_minutes INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_restaurant public.restaurants%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_timeout_mins INT;
  v_delay_mins INT;
  v_event_type TEXT;
BEGIN
  -- 1. Validate response parameter
  IF p_response NOT IN ('ACCEPTED', 'DELAY_REQUESTED', 'DECLINED') THEN
    RAISE EXCEPTION 'INVALID_CALL_RESPONSE: %', p_response;
  END IF;

  -- 2. Lock queue entry row FOR UPDATE
  SELECT * INTO v_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- 3. Validate customer bearer token authentication
  IF v_entry.token_hash IS NULL OR v_entry.token_hash != p_token_hash THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- 4. Check terminal states
  IF v_entry.status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_TERMINAL: Cannot respond to call in status %', v_entry.status;
  END IF;

  -- 5. Must currently be in CALLED state
  IF v_entry.status != 'CALLED' THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_CALLED: Entry is in status %', v_entry.status;
  END IF;

  -- 6. Check call timeout against restaurant configuration (server-authoritative)
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = v_entry.restaurant_id;

  v_timeout_mins := COALESCE(v_restaurant.call_timeout_minutes, 15);

  IF v_entry.called_at IS NOT NULL AND v_now > v_entry.called_at + (v_timeout_mins || ' minutes')::INTERVAL THEN
    RAISE EXCEPTION 'CALL_EXPIRED: The response window of % minutes has elapsed', v_timeout_mins;
  END IF;

  -- 7. Idempotency: if already responded with the exact same response, return existing state
  IF v_entry.call_response = p_response THEN
    IF p_response != 'DELAY_REQUESTED' OR v_entry.call_delay_minutes = p_delay_minutes THEN
      RETURN jsonb_build_object(
        'success', true,
        'queueEntryId', v_entry.id,
        'status', v_entry.status,
        'callResponse', v_entry.call_response,
        'callRespondedAt', v_entry.call_responded_at,
        'callDelayMinutes', v_entry.call_delay_minutes,
        'idempotent', true
      );
    END IF;
  END IF;

  -- 8. Apply atomic transition according to customer decision
  IF p_response = 'ACCEPTED' THEN
    UPDATE public.queue_entries
    SET call_response = 'ACCEPTED',
        call_responded_at = v_now,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'QUEUE_CALL_ACCEPTED';

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      v_event_type,
      jsonb_build_object('response', 'ACCEPTED', 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      v_event_type,
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'response', 'ACCEPTED',
        'respondedAt', v_now
      ),
      'PENDING'
    );

  ELSIF p_response = 'DELAY_REQUESTED' THEN
    v_delay_mins := LEAST(60, GREATEST(1, COALESCE(p_delay_minutes, 10)));

    UPDATE public.queue_entries
    SET call_response = 'DELAY_REQUESTED',
        call_responded_at = v_now,
        call_delay_minutes = v_delay_mins,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'CUSTOMER_LATE';

    -- Integrates with existing late tracking
    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'CUSTOMER_LATE',
      jsonb_build_object('delayMinutes', v_delay_mins, 'reportedAt', v_now, 'fromCallResponse', true)
    );

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'QUEUE_CALL_DELAY_REQUESTED',
      jsonb_build_object('delayMinutes', v_delay_mins, 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      'QUEUE_CALL_DELAY_REQUESTED',
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'delayMinutes', v_delay_mins,
        'respondedAt', v_now
      ),
      'PENDING'
    );

  ELSIF p_response = 'DECLINED' THEN
    -- Declining call transitions entry to CANCELLED (existing cancellation semantics)
    UPDATE public.queue_entries
    SET status = 'CANCELLED',
        cancelled_at = v_now,
        call_response = 'DECLINED',
        call_responded_at = v_now,
        updated_at = v_now
    WHERE id = p_queue_entry_id
    RETURNING * INTO v_entry;

    v_event_type := 'QUEUE_CANCELLED';

    INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
    VALUES (
      v_entry.restaurant_id,
      v_entry.id,
      'QUEUE_CANCELLED',
      jsonb_build_object('reason', 'CUSTOMER_DECLINED_CALL', 'responded_at', v_now)
    );

    INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
    VALUES (
      v_entry.restaurant_id,
      'QUEUE_CANCELLED',
      'QUEUE',
      v_entry.id::text,
      jsonb_build_object(
        'queueEntryId', v_entry.id,
        'displayNumber', v_entry.display_number,
        'customerName', v_entry.customer_name,
        'reason', 'CUSTOMER_DECLINED_CALL',
        'cancelledAt', v_now
      ),
      'PENDING'
    );
  END IF;

  -- 9. Realtime notification ping to staff and listeners
  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', v_entry.restaurant_id,
    'entry_id', v_entry.id,
    'event', v_event_type,
    'call_response', v_entry.call_response
  )::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', v_entry.id,
    'status', v_entry.status,
    'callResponse', v_entry.call_response,
    'callRespondedAt', v_entry.call_responded_at,
    'callDelayMinutes', v_entry.call_delay_minutes
  );
END;
$$;

-- 3. PERMISSIONS: LEAST PRIVILEGE (service_role only, server-authenticated via qtoken)
REVOKE ALL ON FUNCTION public.respond_to_call_atomic(UUID, TEXT, TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_call_atomic(UUID, TEXT, TEXT, INT) TO service_role;
