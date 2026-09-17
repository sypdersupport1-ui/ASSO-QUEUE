-- Phase 2 Queue Hardening: canonical FSM, seat eligibility, restaurant status, broadcast
-- Postgres is truth, no Redis

-- Ensure restaurants queue_operating_state is in realtime publication for dashboard sync
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='restaurants') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurants;
  END IF;
EXCEPTION WHEN OTHERS THEN
  CREATE PUBLICATION supabase_realtime FOR TABLE public.restaurants;
END $$;
ALTER TABLE public.restaurants REPLICA IDENTITY FULL;

-- 1. Harden join_queue_atomic: check restaurant.status = ACTIVE
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

-- 2. Harden seat_queue_entry_atomic: only WAITING/NOTIFIED/CALLED -> SEATED, reject legacy
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_queue_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_queue_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_queue_entry.status;
  END IF;
  SELECT * INTO v_table FROM public.restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND'; END IF;
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF v_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;
  IF v_table.status != 'AVAILABLE' THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'; END IF;
  IF v_table.capacity < v_queue_entry.party_size THEN RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY'; END IF;
  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_queue_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      -- Allow SUPER_ADMIN via is_super_admin check
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;
  UPDATE public.queue_entries SET status='SEATED', seated_table_id=p_table_id, seated_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id;
  UPDATE public.restaurant_tables SET status='OCCUPIED', updated_at=v_now WHERE id=p_table_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_queue_entry.restaurant_id, p_queue_entry_id, 'QUEUE_SEATED', p_actor_user_id, jsonb_build_object('table_id',p_table_id,'table_number',v_table.table_number,'party_size',v_queue_entry.party_size,'previous_status',v_queue_entry.status));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_queue_entry.restaurant_id, 'QUEUE_SEATED','QUEUE',p_queue_entry_id::text, jsonb_build_object('previousStatus',v_queue_entry.status,'newStatus','SEATED','customerName',v_queue_entry.customer_name,'displayNumber',v_queue_entry.display_number,'tableId',p_table_id), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_queue_entry.restaurant_id, p_actor_user_id, 'queue_entry_seated','queue_entry',p_queue_entry_id, jsonb_build_object('tableId',p_table_id,'tableNumber',v_table.table_number,'customerName',v_queue_entry.customer_name,'displayNumber',v_queue_entry.display_number));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_queue_entry.restaurant_id,'entry_id',p_queue_entry_id,'event','QUEUE_SEATED')::text);
  RETURN jsonb_build_object('success',true,'queueEntryId',p_queue_entry_id,'tableId',p_table_id,'tableNumber',v_table.table_number,'seatedAt',v_now);
END;
$$;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID,UUID,UUID) FROM anon;

-- 3. New atomic transition function for non-seating queue status changes (ensures outbox atomic)
CREATE OR REPLACE FUNCTION public.transition_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_target_status TEXT,
  p_actor_user_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current public.queue_entries%ROWTYPE;
  v_old_status TEXT;
  v_old_display TEXT;
  v_old_name TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_event_type TEXT;
  v_allowed TEXT[];
BEGIN
  SELECT * INTO v_current FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  v_old_status := v_current.status;
  v_old_display := v_current.display_number;
  v_old_name := v_current.customer_name;
  IF p_target_status = v_old_status THEN RETURN v_current; END IF;
  IF v_old_status IN ('SEATED','CANCELLED','NO_SHOW','EXPIRED','COMPLETED','REMOVED','SKIPPED') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Cannot transition from terminal state % to %', v_old_status, p_target_status;
  END IF;
  IF v_old_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: SEATED is terminal'; END IF;
  IF p_target_status = 'SEATED' THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Use seating operation for SEATED'; END IF;
  IF p_target_status IN ('COMPLETED','REMOVED','SKIPPED') THEN RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % is legacy', p_target_status; END IF;
  -- Canonical matrix
  IF v_old_status = 'WAITING' THEN v_allowed := ARRAY['NOTIFIED','CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'NOTIFIED' THEN v_allowed := ARRAY['CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'CALLED' THEN v_allowed := ARRAY['NO_SHOW','CANCELLED','EXPIRED'];
  ELSE RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unknown current status %', v_old_status;
  END IF;
  IF NOT (p_target_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed. Allowed: %', v_old_status, p_target_status, array_to_string(v_allowed,',');
  END IF;
  -- Prepare update
  v_event_type := 'QUEUE_' || p_target_status;
  IF p_target_status = 'NOTIFIED' THEN
    UPDATE public.queue_entries SET status=p_target_status, notified_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CALLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, called_at=v_now, notified_at=COALESCE(notified_at,v_now), updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CANCELLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, cancelled_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'NO_SHOW' THEN
    UPDATE public.queue_entries SET status=p_target_status, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'EXPIRED' THEN
    UPDATE public.queue_entries SET status=p_target_status, expired_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSE
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unhandled target %', p_target_status;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_current FROM public.queue_entries WHERE id=p_queue_entry_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_current.restaurant_id, v_current.id, v_event_type, p_actor_user_id, jsonb_build_object('previous_status',v_old_status,'new_status',p_target_status,'reason',p_reason));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_current.restaurant_id, v_event_type, 'QUEUE', v_current.id::text, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',p_reason,'actor',p_actor_user_id,'customerName',v_old_name,'displayNumber',v_old_display), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_current.restaurant_id, p_actor_user_id, 'queue_entry_'||lower(p_target_status),'queue_entry',v_current.id, jsonb_build_object('previousStatus',v_current.status,'newStatus',p_target_status,'reason',p_reason));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_current.restaurant_id,'entry_id',v_current.id,'event',v_event_type)::text);
  RETURN v_current;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM anon;
