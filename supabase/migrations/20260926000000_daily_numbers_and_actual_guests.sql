-- QueueFlow: daily queue numbers (1,2,3…) + actual guests arrived
--
-- 1. Queue numbers reset every business day at 5 AM restaurant-local time.
--    Previous join_queue_atomic used MAX(queue_number) over ALL history, so
--    numbers grew forever (e.g. 342, 343…). Now scoped to entries created
--    after the most recent 5 AM cutoff (get_recent_5am_cutoff), so each day
--    starts at 1. Within a day, FOR UPDATE on the restaurant row + COUNT
--    keeps joins serialized per restaurant.
-- 2. actual_guests: staff confirm how many guests REALLY arrived at seat time
--    (party_size = expected from join form; actual_guests = headcount at door).

-- 2a. Actual guests column (expected party_size stays untouched for history)
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS actual_guests INT CHECK (actual_guests IS NULL OR actual_guests >= 0);

-- 2b. Extend seat RPC to accept + persist actual guests (overload-safe:
--     old 3-arg calls keep working via default NULL)
--
-- IMPORTANT: CREATE OR REPLACE with a new signature ADDS an overload instead
-- of replacing the old one, leaving two ambiguous
-- seat_queue_entry_atomic variants (3-arg + 4-arg). Since the 4th parameter
-- has a DEFAULT, every 3-arg call matches BOTH overloads and Postgres /
-- PostgREST cannot choose ("best candidate function" error), and the fresh
-- overload inherits default PUBLIC execute grants (Phase 3E violation).
-- So: drop the legacy 3-arg overload first, then re-apply least privilege.
--
-- The body below is a faithful port of the 20260917 version (same checks,
-- same JSONB success return incl. seated_table_id persistence, audit log,
-- and pg_notify) plus actual_guests handling.
DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID);
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_actual_guests INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
BEGIN
  SELECT * INTO v_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'SEATED' THEN RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED'; END IF;
  IF v_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_entry.status;
  END IF;
  SELECT * INTO v_table FROM public.restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND'; END IF;
  IF v_table.restaurant_id != v_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;
  IF v_table.status != 'AVAILABLE' THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'; END IF;
  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      -- Allow SUPER_ADMIN via is_super_admin check
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;

  -- Actual headcount confirmed at the door (defaults to expected party size).
  -- 0 = nobody showed is a no-show, not a seat; must fit the table.
  IF p_actual_guests IS NOT NULL THEN
    IF p_actual_guests <= 0 THEN RAISE EXCEPTION 'INVALID_ACTUAL_GUESTS'; END IF;
    v_seating_count := p_actual_guests;
  ELSE
    v_seating_count := v_entry.party_size;
  END IF;
  IF v_table.capacity < v_seating_count THEN RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY'; END IF;

  UPDATE public.queue_entries
  SET status = 'SEATED',
      seated_table_id = p_table_id,
      seated_at = v_now,
      actual_guests = COALESCE(p_actual_guests, actual_guests, party_size),
      updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;
  UPDATE public.restaurant_tables SET status = 'OCCUPIED', updated_at = v_now WHERE id = p_table_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_entry.restaurant_id, p_queue_entry_id, 'QUEUE_SEATED', p_actor_user_id,
    jsonb_build_object('table_id',p_table_id,'table_number',v_table.table_number,'party_size',v_entry.party_size,
      'actual_guests',v_entry.actual_guests,'previous_status',v_entry.status));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_entry.restaurant_id, 'QUEUE_SEATED','QUEUE',p_queue_entry_id::text,
    jsonb_build_object('previousStatus',v_entry.status,'newStatus','SEATED','customerName',v_entry.customer_name,
      'displayNumber',v_entry.display_number,'tableId',p_table_id,'actualGuests',v_entry.actual_guests), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_entry.restaurant_id, p_actor_user_id, 'queue_entry_seated','queue_entry',p_queue_entry_id,
      jsonb_build_object('tableId',p_table_id,'tableNumber',v_table.table_number,'customerName',v_entry.customer_name,
        'displayNumber',v_entry.display_number,'actualGuests',v_entry.actual_guests));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_entry.restaurant_id,'entry_id',p_queue_entry_id,'event','QUEUE_SEATED')::text);
  RETURN jsonb_build_object('success',true,'queueEntryId',p_queue_entry_id,'tableId',p_table_id,
    'tableNumber',v_table.table_number,'seatedAt',v_now,'actualGuests',v_entry.actual_guests);
END;
$$;

-- Phase 3E least privilege on the surviving signature (service_role only —
-- the app authorizes via AuthorizationService before calling).
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT) TO service_role;

-- 1. Daily-reset join: same guards as 20260920000000, only the number
--    allocation changes (scoped to post-5AM-cutoff entries).
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
  v_local_now TIMESTAMPTZ;
  v_local_dow INT;
  v_local_time TIME;
  v_today RECORD;
  v_yesterday RECORD;
  v_sched_open BOOLEAN := false;
  v_cutoff TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  IF v_restaurant.queue_operating_state = 'PAUSED' THEN
    RAISE EXCEPTION 'QUEUE_PAUSED';
  ELSIF v_restaurant.queue_operating_state = 'CLOSED' THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  BEGIN
    v_local_now := timezone(COALESCE(v_restaurant.timezone, 'UTC'), NOW());
  EXCEPTION WHEN OTHERS THEN
    v_local_now := NOW();
  END;
  v_local_dow := EXTRACT(DOW FROM v_local_now)::INT;
  v_local_time := v_local_now::TIME;

  SELECT * INTO v_today FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = v_local_dow;
  SELECT * INTO v_yesterday FROM public.restaurant_queue_hours
    WHERE restaurant_id = p_restaurant_id AND day_of_week = (v_local_dow + 6) % 7;

  IF v_today IS NULL AND v_yesterday IS NULL THEN
    v_sched_open := true;
  ELSE
    IF v_today IS NOT NULL AND COALESCE(v_today.is_closed, false) = false THEN
      IF v_today.opens_at < v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at AND v_local_time < v_today.closes_at THEN
          v_sched_open := true;
        END IF;
      ELSIF v_today.opens_at > v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
    IF NOT v_sched_open AND v_yesterday IS NOT NULL AND COALESCE(v_yesterday.is_closed, false) = false THEN
      IF v_yesterday.opens_at > v_yesterday.closes_at THEN
        IF v_local_time < v_yesterday.closes_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
  END IF;

  IF NOT v_sched_open THEN
    RAISE EXCEPTION 'QUEUE_OUTSIDE_OPERATING_HOURS';
  END IF;

  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN RAISE EXCEPTION 'INVALID_PARTY_SIZE'; END IF;
  SELECT COUNT(*) INTO v_active_count FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND status IN ('WAITING','CALLED','NOTIFIED');
  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (SELECT 1 FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND customer_phone = p_customer_phone AND status IN ('WAITING','CALLED','NOTIFIED')) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;

  -- DAILY RESET: numbers restart at 1 after the 5 AM business-day cutoff.
  -- Falls back to all-history MAX only if the cutoff helper is missing.
  BEGIN
    v_cutoff := public.get_recent_5am_cutoff(COALESCE(v_restaurant.timezone, 'UTC'));
  EXCEPTION WHEN OTHERS THEN
    v_cutoff := NULL;
  END;
  IF v_cutoff IS NULL THEN
    SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;
  ELSE
    SELECT COALESCE(MAX(queue_number),0)+1 INTO v_queue_num FROM public.queue_entries WHERE restaurant_id = p_restaurant_id AND created_at >= v_cutoff;
  END IF;

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

COMMENT ON COLUMN public.queue_entries.actual_guests IS 'Headcount confirmed by staff at seat time. party_size = expected (join form); actual_guests = who really arrived.';
