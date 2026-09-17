-- ============================================================================
-- QUEUEFLOW PHASE 18: SEATING SYSTEM ARCHITECTURE UPGRADE
-- Supports:
-- 1. Table shapes (ROUND, SQUARE, RECTANGLE, BAR)
-- 2. Restaurant seating mode (SIMPLE vs STRICT)
-- 3. Live table occupancy tracking (occupied_seats, free_seats)
-- 4. active_seating_assignments junction table (multi-table & shared seating)
-- 5. Enhanced seat_queue_entry_atomic RPC supporting single, multi-table, and shared seating
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH SEATING MODE
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS seating_mode TEXT NOT NULL DEFAULT 'SIMPLE'
  CHECK (seating_mode IN ('SIMPLE', 'STRICT'));

COMMENT ON COLUMN public.restaurants.seating_mode IS 
  'Seating recommendation and assignment policy: SIMPLE (exclusive table assignment, no sharing) or STRICT (efficient capacity sharing permitted).';

-- 2. EXTEND RESTAURANT_TABLES WITH SHAPE & REALTIME OCCUPANCY
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS shape TEXT NOT NULL DEFAULT 'RECTANGLE'
  CHECK (shape IN ('ROUND', 'SQUARE', 'RECTANGLE', 'BAR'));

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS occupied_seats INT NOT NULL DEFAULT 0
  CHECK (occupied_seats >= 0);

ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS free_seats INT NOT NULL DEFAULT 2
  CHECK (free_seats >= 0);

-- Backfill free_seats and occupied_seats based on current status and capacity
UPDATE public.restaurant_tables
SET 
  occupied_seats = CASE WHEN status = 'OCCUPIED' THEN capacity ELSE 0 END,
  free_seats = CASE WHEN status = 'OCCUPIED' THEN 0 ELSE capacity END
WHERE free_seats IS NULL OR free_seats = 2;

-- 3. CREATE ACTIVE_SEATING_ASSIGNMENTS JUNCTION TABLE
CREATE TABLE IF NOT EXISTS public.active_seating_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  queue_entry_id UUID NOT NULL REFERENCES public.queue_entries(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.restaurant_tables(id) ON DELETE CASCADE,
  guests_allocated INT NOT NULL CHECK (guests_allocated > 0),
  is_primary BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_active_assignment_entry_table UNIQUE (queue_entry_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_active_assignments_restaurant ON public.active_seating_assignments(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_active_assignments_entry ON public.active_seating_assignments(queue_entry_id);
CREATE INDEX IF NOT EXISTS idx_active_assignments_table ON public.active_seating_assignments(table_id);

-- Enable RLS
ALTER TABLE public.active_seating_assignments ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "active_assignments_select" ON public.active_seating_assignments;
CREATE POLICY "active_assignments_select"
  ON public.active_seating_assignments
  FOR SELECT
  TO authenticated, service_role
  USING (
    public.is_super_admin(auth.uid()) OR
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships m
      WHERE m.restaurant_id = active_seating_assignments.restaurant_id
        AND m.user_id = auth.uid()
        AND m.status = 'ACTIVE'
    )
  );

DROP POLICY IF EXISTS "active_assignments_all" ON public.active_seating_assignments;
CREATE POLICY "active_assignments_all"
  ON public.active_seating_assignments
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. ATOMIC MULTI-TABLE & SHARED SEATING RPC
-- Upgrades seat_queue_entry_atomic to handle:
--   p_queue_entry_id: UUID
--   p_table_id: UUID (primary table)
--   p_actor_user_id: UUID (optional)
--   p_actual_guests: INT (optional)
--   p_additional_table_ids: UUID[] (optional for combined tables)

DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID, INT);
DROP FUNCTION IF EXISTS public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]);

CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL,
  p_actual_guests INT DEFAULT NULL,
  p_additional_table_ids UUID[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_primary_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
  v_total_capacity INT := 0;
  v_all_table_ids UUID[];
  v_cur_table_id UUID;
  v_cur_table public.restaurant_tables%ROWTYPE;
  v_remaining_guests INT;
  v_alloc INT;
  v_combined_numbers TEXT := '';
  v_restaurant public.restaurants%ROWTYPE;
BEGIN
  -- 1. Lock Queue Entry
  SELECT * INTO v_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;
  IF v_entry.status = 'SEATED' THEN RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED'; END IF;
  IF v_entry.status NOT IN ('WAITING','NOTIFIED','CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_entry.status;
  END IF;

  -- Get restaurant configuration
  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = v_entry.restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;

  -- Check actor permission if provided (defense in depth)
  IF p_actor_user_id IS NOT NULL THEN
    IF NOT public.has_restaurant_role(p_actor_user_id, v_entry.restaurant_id, ARRAY['RESTAURANT_ADMIN','STAFF']) THEN
      IF NOT public.is_super_admin(p_actor_user_id) THEN
        RAISE EXCEPTION 'UNAUTHORIZED';
      END IF;
    END IF;
  END IF;

  -- Determine confirmed headcount
  IF p_actual_guests IS NOT NULL THEN
    IF p_actual_guests <= 0 THEN RAISE EXCEPTION 'INVALID_ACTUAL_GUESTS'; END IF;
    v_seating_count := p_actual_guests;
  ELSE
    v_seating_count := v_entry.party_size;
  END IF;

  -- 2. Build list of table IDs (primary + additional)
  v_all_table_ids := ARRAY[p_table_id];
  IF p_additional_table_ids IS NOT NULL AND array_length(p_additional_table_ids, 1) > 0 THEN
    FOREACH v_cur_table_id IN ARRAY p_additional_table_ids LOOP
      IF v_cur_table_id IS NOT NULL AND NOT (v_cur_table_id = ANY(v_all_table_ids)) THEN
        v_all_table_ids := array_append(v_all_table_ids, v_cur_table_id);
      END IF;
    END LOOP;
  END IF;

  -- 3. Lock and validate all tables
  v_remaining_guests := v_seating_count;

  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND: %', v_cur_table_id; END IF;
    IF v_cur_table.restaurant_id != v_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
    IF v_cur_table.is_archived THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;

    -- Validate table availability according to mode:
    -- In SIMPLE mode, table must be AVAILABLE (or if already partially occupied, sharing is blocked)
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      IF v_cur_table.status != 'AVAILABLE' THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.capacity;
    ELSE
      -- In STRICT mode, table can be AVAILABLE or OCCUPIED if it has free_seats
      IF v_cur_table.status NOT IN ('AVAILABLE', 'OCCUPIED') THEN
        RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
      END IF;
      IF v_cur_table.free_seats <= 0 THEN
        RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: Table % has no free seats', v_cur_table.table_number;
      END IF;
      v_total_capacity := v_total_capacity + v_cur_table.free_seats;
    END IF;

    IF v_cur_table_id = p_table_id THEN
      v_primary_table := v_cur_table;
    END IF;

    IF v_combined_numbers = '' THEN
      v_combined_numbers := v_cur_table.table_number;
    ELSE
      v_combined_numbers := v_combined_numbers || ' + ' || v_cur_table.table_number;
    END IF;
  END LOOP;

  IF v_total_capacity < v_seating_count THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY';
  END IF;

  -- 4. Create Active Seating Assignments & update table occupancy
  FOREACH v_cur_table_id IN ARRAY v_all_table_ids LOOP
    SELECT * INTO v_cur_table FROM public.restaurant_tables WHERE id = v_cur_table_id;
    
    -- Calculate allocated seats for this table
    IF v_restaurant.seating_mode = 'SIMPLE' THEN
      v_alloc := LEAST(v_cur_table.capacity, v_remaining_guests);
    ELSE
      v_alloc := LEAST(v_cur_table.free_seats, v_remaining_guests);
    END IF;
    IF v_alloc <= 0 THEN v_alloc := 1; END IF;

    -- Record assignment in junction table
    INSERT INTO public.active_seating_assignments (
      restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary, created_at, updated_at
    ) VALUES (
      v_entry.restaurant_id, p_queue_entry_id, v_cur_table_id, v_alloc, (v_cur_table_id = p_table_id), v_now, v_now
    )
    ON CONFLICT (queue_entry_id, table_id) DO UPDATE
    SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;

    -- Update table occupied and free seats
    UPDATE public.restaurant_tables
    SET
      status = 'OCCUPIED',
      occupied_seats = occupied_seats + v_alloc,
      free_seats = GREATEST(0, capacity - (occupied_seats + v_alloc)),
      updated_at = v_now
    WHERE id = v_cur_table_id;

    v_remaining_guests := GREATEST(0, v_remaining_guests - v_alloc);
  END LOOP;

  -- 5. Update Queue Entry status -> SEATED
  UPDATE public.queue_entries
  SET status = 'SEATED',
      seated_table_id = p_table_id,
      seated_at = v_now,
      actual_guests = v_seating_count,
      updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;

  -- 6. Insert events & audit logs
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'table_number', v_primary_table.table_number,
      'combined_table_numbers', v_combined_numbers,
      'all_table_ids', v_all_table_ids,
      'party_size', v_entry.party_size,
      'actual_guests', v_entry.actual_guests,
      'previous_status', v_entry.status,
      'seating_mode', v_restaurant.seating_mode
    )
  );

  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_entry.restaurant_id,
    'QUEUE_SEATED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'previousStatus', v_entry.status,
      'newStatus', 'SEATED',
      'customerName', v_entry.customer_name,
      'displayNumber', v_entry.display_number,
      'tableId', p_table_id,
      'allTableIds', v_all_table_ids,
      'combinedTableNumbers', v_combined_numbers,
      'actualGuests', v_entry.actual_guests
    ),
    'PENDING'
  );

  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (restaurant_id, actor_user_id, action, entity_type, entity_id, metadata)
    VALUES (
      v_entry.restaurant_id,
      p_actor_user_id,
      'queue_entry_seated',
      'queue_entry',
      p_queue_entry_id,
      jsonb_build_object(
        'tableId', p_table_id,
        'tableNumber', v_primary_table.table_number,
        'allTableIds', v_all_table_ids,
        'combinedTableNumbers', v_combined_numbers,
        'customerName', v_entry.customer_name,
        'displayNumber', v_entry.display_number,
        'actualGuests', v_entry.actual_guests
      )
    );
  END IF;

  PERFORM pg_notify('queue_entry_update', json_build_object('restaurant_id', v_entry.restaurant_id, 'entry_id', p_queue_entry_id, 'event', 'QUEUE_SEATED')::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'tableId', p_table_id,
    'tableNumber', v_primary_table.table_number,
    'combinedTableNumbers', v_combined_numbers,
    'allTableIds', v_all_table_ids,
    'seatedAt', v_now,
    'actualGuests', v_entry.actual_guests
  );
END;
$$;

-- Phase 3E least privilege
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) TO service_role;
