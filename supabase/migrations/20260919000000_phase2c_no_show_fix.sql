-- Phase 2C Fix: Ensure transition_queue_entry_atomic handles no_show_at/reason correctly
-- This updates the function created in 20260917000000 to set no_show columns

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
  v_reason TEXT := COALESCE(p_reason, 'STAFF_MARKED_NO_SHOW');
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
  IF v_old_status = 'WAITING' THEN v_allowed := ARRAY['NOTIFIED','CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'NOTIFIED' THEN v_allowed := ARRAY['CALLED','CANCELLED','EXPIRED'];
  ELSIF v_old_status = 'CALLED' THEN v_allowed := ARRAY['NO_SHOW','CANCELLED','EXPIRED'];
  ELSE RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unknown current status %', v_old_status;
  END IF;
  IF NOT (p_target_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed. Allowed: %', v_old_status, p_target_status, array_to_string(v_allowed,',');
  END IF;
  -- Validate no-show reason
  IF p_target_status = 'NO_SHOW' AND v_reason NOT IN ('CUSTOMER_DID_NOT_RETURN','CUSTOMER_DID_NOT_RESPOND','STAFF_MARKED_NO_SHOW','OTHER') THEN
    v_reason := 'STAFF_MARKED_NO_SHOW';
  END IF;
  v_event_type := 'QUEUE_' || p_target_status;
  IF p_target_status = 'NOTIFIED' THEN
    UPDATE public.queue_entries SET status=p_target_status, notified_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CALLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, called_at=v_now, notified_at=COALESCE(notified_at,v_now), updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'CANCELLED' THEN
    UPDATE public.queue_entries SET status=p_target_status, cancelled_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'NO_SHOW' THEN
    UPDATE public.queue_entries SET status=p_target_status, no_show_at=v_now, no_show_reason=v_reason, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSIF p_target_status = 'EXPIRED' THEN
    UPDATE public.queue_entries SET status=p_target_status, expired_at=v_now, updated_at=v_now WHERE id=p_queue_entry_id AND status=v_old_status RETURNING * INTO v_current;
  ELSE
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: Unhandled target %', p_target_status;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_STATE_CONFLICT'; END IF;
  SELECT * INTO v_current FROM public.queue_entries WHERE id=p_queue_entry_id;
  INSERT INTO public.queue_events (restaurant_id,queue_entry_id,event_type,actor_user_id,metadata)
  VALUES (v_current.restaurant_id, v_current.id, v_event_type, p_actor_user_id, jsonb_build_object('previous_status',v_old_status,'new_status',p_target_status,'reason',v_reason));
  INSERT INTO public.outbox_events (restaurant_id,event_type,aggregate_type,aggregate_id,payload,status)
  VALUES (v_current.restaurant_id, v_event_type, 'QUEUE', v_current.id::text, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',v_reason,'actor',p_actor_user_id,'customerName',v_old_name,'displayNumber',v_old_display), 'PENDING');
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id,actor_user_id,action,entity_type,entity_id,metadata)
    VALUES (v_current.restaurant_id, p_actor_user_id, 'queue_entry_'||lower(p_target_status),'queue_entry',v_current.id, jsonb_build_object('previousStatus',v_old_status,'newStatus',p_target_status,'reason',v_reason));
  END IF;
  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id',v_current.restaurant_id,'entry_id',v_current.id,'event',v_event_type)::text);
  RETURN v_current;
END;
$$;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID,TEXT,UUID,TEXT) FROM PUBLIC, anon;
