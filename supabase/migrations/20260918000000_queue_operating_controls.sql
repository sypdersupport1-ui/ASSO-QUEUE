-- Phase 2B Queue Operating Controls: OPEN/PAUSED/CLOSING_SOON/CLOSED
-- queue_enabled remains master flag, operating_state is operational state
-- FULL is derived, not stored

-- 1. Add queue_operating_state column with safe default OPEN
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS queue_operating_state TEXT NOT NULL DEFAULT 'OPEN'
  CHECK (queue_operating_state IN ('OPEN','PAUSED','CLOSING_SOON','CLOSED'));

-- Backfill existing restaurants: if queue_enabled = false, keep effective CLOSED via queue_enabled check, but set operating_state to OPEN for consistency
-- (No data migration needed - default OPEN is safe because queue_enabled=false still blocks joins)

-- Index for frequent public QR reads
CREATE INDEX IF NOT EXISTS idx_restaurants_queue_operating_state ON public.restaurants (queue_operating_state) WHERE queue_operating_state != 'OPEN';

-- 2. Update join_queue_atomic to enforce operating state
CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  -- Operating state controls new intake: PAUSED/CLOSED block, OPEN/CLOSING_SOON allow
  IF v_restaurant.queue_operating_state = 'PAUSED' THEN
    RAISE EXCEPTION 'QUEUE_PAUSED';
  ELSIF v_restaurant.queue_operating_state = 'CLOSED' THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;
  -- CLOSING_SOON still allows joins (warning state, no timer yet)
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;
  SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  v_display_num := v_queue_num::text;
  INSERT INTO public.queue_entries (restaurant_id,customer_name,customer_phone,party_size,queue_number,display_number,status,token_hash,joined_at,created_at,updated_at)
  VALUES (p_restaurant_id, p_customer_name, NULLIF(p_customer_phone,''), p_party_size, v_queue_num, v_display_num, 'WAITING', p_token_hash, NOW(), NOW(), NOW())
  RETURNING * INTO v_new_entry;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,metadata)
  VALUES (p_restaurant_id, v_new_entry.id, 'QUEUE_JOINED', jsonb_build_object('party_size',p_party_size,'display_number',v_display_num,'queue_number',v_queue_num));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (p_restaurant_id, 'QUEUE_JOINED','QUEUE',v_new_entry.id::text, jsonb_build_object('customerName',p_customer_name,'partySize',p_party_size,'displayNumber',v_display_num,'queueNumber',v_queue_num), 'PENDING');
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',p_restaurant_id,'entry_id',v_new_entry.id,'event','QUEUE_JOINED')::text);
  RETURN v_new_entry;
END;
$$;
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID,TEXT,TEXT,INT,TEXT) TO anon, authenticated, service_role;

-- 3. New function to set operating state atomically with concurrency protection
CREATE OR REPLACE FUNCTION public.set_queue_operating_state(
  p_restaurant_id UUID,
  p_new_state TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.restaurants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current TEXT;
  v_restaurant public.restaurants%ROWTYPE;
  v_allowed TEXT[];
BEGIN
  IF p_new_state NOT IN ('OPEN','PAUSED','CLOSING_SOON','CLOSED') THEN
    RAISE EXCEPTION 'INVALID_OPERATING_STATE: %', p_new_state;
  END IF;
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  v_current := v_restaurant.queue_operating_state;
  IF v_current = p_new_state THEN
    RETURN v_restaurant; -- Idempotent no-op
  END IF;
  -- Canonical operating state transitions (allow all except no self-loop already handled)
  -- OPEN <-> PAUSED, OPEN <-> CLOSING_SOON, OPEN <-> CLOSED, PAUSED <-> OPEN/CLOSED, CLOSING_SOON <-> OPEN/CLOSED
  -- All are allowed except same-state (already handled). No invalid combos for now.
  -- Could restrict PAUSED->CLOSING_SOON etc. but spec says define whether PAUSED->CLOSED legal - we allow all.
  UPDATE public.restaurants SET queue_operating_state = p_new_state, updated_at = NOW() WHERE id = p_restaurant_id AND queue_operating_state = v_current RETURNING * INTO v_restaurant;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id;
  INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
  VALUES (p_restaurant_id, p_actor_user_id, 'queue_operating_state_changed', 'restaurant', p_restaurant_id, jsonb_build_object('previousState', v_current, 'newState', p_new_state, 'reason', p_reason));
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (p_restaurant_id, 'QUEUE_OPERATING_STATE_CHANGED', 'QUEUE', p_restaurant_id::text, jsonb_build_object('previousState', v_current, 'newState', p_new_state, 'reason', p_reason), 'PENDING');
  PERFORM pg_notify('queue_operating_state', json_build_object('restaurant_id', p_restaurant_id, 'previous', v_current, 'new', p_new_state)::text);
  RETURN v_restaurant;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_queue_operating_state(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_queue_operating_state(UUID,TEXT,UUID,TEXT) FROM PUBLIC, anon;

-- 4. Ensure queue_entries position still correct (no change, just comment)
COMMENT ON COLUMN public.restaurants.queue_operating_state IS 'Queue intake: OPEN (join allowed), PAUSED (join blocked, existing intact), CLOSING_SOON (join allowed, warning), CLOSED (join blocked). FULL is derived via active count >= max_queue_capacity. queue_enabled false overrides to CLOSED.';
