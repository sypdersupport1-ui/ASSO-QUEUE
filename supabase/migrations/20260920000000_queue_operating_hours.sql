-- Phase 2E Queue Operating Hours: weekly schedule + schedule-aware join
-- Convention: day_of_week 0=Sunday .. 6=Saturday (matches EXTRACT(DOW FROM ...))
-- Times are local restaurant time (restaurants.timezone, IANA). No offsets stored per row.

-- 1. Schedule table
CREATE TABLE IF NOT EXISTS public.restaurant_queue_hours (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  opens_at TIME NOT NULL DEFAULT '00:00',
  closes_at TIME NOT NULL DEFAULT '23:59',
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_restaurant_queue_hours_day UNIQUE (restaurant_id, day_of_week),
  CONSTRAINT valid_queue_hours_interval CHECK (
    is_closed = true OR opens_at != closes_at
  )
);

CREATE INDEX IF NOT EXISTS idx_queue_hours_restaurant ON public.restaurant_queue_hours (restaurant_id);

-- 2. Optional closing-soon threshold (restaurant-level, minutes before close to hint CLOSING_SOON)
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS closing_soon_minutes INT NOT NULL DEFAULT 30 CHECK (closing_soon_minutes >= 5 AND closing_soon_minutes <= 120);

-- 3. RLS
ALTER TABLE public.restaurant_queue_hours ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant isolation for restaurant_queue_hours" ON public.restaurant_queue_hours;
CREATE POLICY "Tenant isolation for restaurant_queue_hours"
  ON public.restaurant_queue_hours FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())))
  WITH CHECK (public.is_super_admin(auth.uid()) OR restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid())));

-- 4. Backfill: always-open schedule for existing restaurants (preserves current behavior)
INSERT INTO public.restaurant_queue_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
SELECT r.id, d.day, '00:00'::time, '23:59'::time, false
FROM public.restaurants r
CROSS JOIN (SELECT generate_series(0,6) AS day) d
ON CONFLICT (restaurant_id, day_of_week) DO NOTHING;

-- 5. Realtime publication (idempotent, restaurant-level subscription reuses existing pattern)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'restaurant_queue_hours'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.restaurant_queue_hours;
  END IF;
END $$;
ALTER TABLE public.restaurant_queue_hours REPLICA IDENTITY FULL;

-- 6. Schedule-aware join: extend join_queue_atomic with operating-hours enforcement
-- Precedence: lifecycle > queue_enabled > manual PAUSED/CLOSED > scheduled hours > OPEN/CLOSING_SOON
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

  -- Scheduled hours check (authoritative, restaurant-local time)
  -- Manual OPEN/CLOSING_SOON still require schedule to be open
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

  -- If no schedule rows exist, treat as always open (safe default for legacy)
  IF v_today IS NULL AND v_yesterday IS NULL THEN
    v_sched_open := true;
  ELSE
    -- Today's interval
    IF v_today IS NOT NULL AND COALESCE(v_today.is_closed, false) = false THEN
      IF v_today.opens_at < v_today.closes_at THEN
        IF v_local_time >= v_today.opens_at AND v_local_time < v_today.closes_at THEN
          v_sched_open := true;
        END IF;
      ELSIF v_today.opens_at > v_today.closes_at THEN
        -- Cross-midnight: open from opens_at tonight onward
        IF v_local_time >= v_today.opens_at THEN
          v_sched_open := true;
        END IF;
      END IF;
    END IF;
    -- Yesterday's cross-midnight spill (opened yesterday, closes today)
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

COMMENT ON TABLE public.restaurant_queue_hours IS 'Weekly queue schedule. day_of_week 0=Sunday..6=Saturday. Times are restaurant-local. opens_at>closes_at = cross-midnight. is_closed = closed day. Default 00:00-23:59 open (preserves legacy behavior).';
COMMENT ON COLUMN public.restaurants.closing_soon_minutes IS 'Minutes before scheduled close to hint CLOSING_SOON. Manual state stays authoritative; no auto-transition in this phase.';
