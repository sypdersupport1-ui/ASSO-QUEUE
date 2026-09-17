-- ============================================================================
-- QUEUEFLOW PHASE 1 TAKEAWAY: Core Foundation, Queue Lifecycle & Security
-- ============================================================================
-- This migration EXTENDS the existing Dine-In system.
-- It does NOT replace, rebuild, or duplicate any existing queue, seating,
-- table, notification, realtime, or order infrastructure.
--
-- Changes:
--   1. restaurants.takeaway_enabled   — per-restaurant Takeaway on/off switch
--   2. queue_entries.queue_type       — DINE_IN | TAKEAWAY discriminator (immutable)
--   3. Composite index for isolated position queries
--   4. Immutability trigger for queue_type
--   5. join_queue_atomic extended to accept p_queue_type (default DINE_IN)
--   6. seat_queue_entry_atomic guarded against TAKEAWAY entries
--   7. complete_takeaway_atomic — new RPC for Takeaway pickup completion
--   8. RBAC permissions seeding for Takeaway domain
-- ============================================================================

-- ============================================================================
-- 1. RESTAURANT TAKEAWAY CONFIGURATION
-- ============================================================================

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS takeaway_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.takeaway_enabled IS
  'Phase 1 Takeaway: when false (default) Takeaway queue creation is rejected at the RPC layer. '
  'Existing restaurants continue to work as Dine-In-only until explicitly enabled.';

-- ============================================================================
-- 2. QUEUE TYPE DISCRIMINATOR ON QUEUE_ENTRIES
-- ============================================================================

ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS queue_type TEXT NOT NULL DEFAULT 'DINE_IN'
  CHECK (queue_type IN ('DINE_IN', 'TAKEAWAY'));

COMMENT ON COLUMN public.queue_entries.queue_type IS
  'Immutable service type set at join time. DINE_IN (default): seating-based queue. '
  'TAKEAWAY: order/pickup queue that never receives a table assignment.';

-- Backfill historical entries: all existing rows are definitionally DINE_IN
UPDATE public.queue_entries
SET queue_type = 'DINE_IN'
WHERE queue_type IS NULL OR queue_type != 'DINE_IN';

-- ============================================================================
-- 3. COMPOSITE INDEX FOR TYPE-ISOLATED POSITION QUERIES
-- ============================================================================
-- This index makes queue position calculations for each service type fast
-- by filtering on (restaurant_id, queue_type, status) together.

CREATE INDEX IF NOT EXISTS idx_queue_entries_type_restaurant_status
  ON public.queue_entries(restaurant_id, queue_type, status, joined_at, id);

-- ============================================================================
-- 4. IMMUTABILITY TRIGGER — queue_type CANNOT CHANGE AFTER INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.enforce_queue_type_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire on UPDATE where queue_type is actually different
  IF TG_OP = 'UPDATE' AND OLD.queue_type IS DISTINCT FROM NEW.queue_type THEN
    RAISE EXCEPTION 'QUEUE_TYPE_IMMUTABLE: queue_type cannot be changed after creation (entry %, old=%, new=%)',
      OLD.id, OLD.queue_type, NEW.queue_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_queue_type_immutable ON public.queue_entries;
CREATE TRIGGER trg_queue_type_immutable
  BEFORE UPDATE ON public.queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_queue_type_immutable();

-- ============================================================================
-- 5. EXTEND join_queue_atomic — accept p_queue_type (default 'DINE_IN')
-- ============================================================================
-- Preserves ALL existing validation and behavior for DINE_IN entries.
-- Adds: queue_type validation, takeaway_enabled check, type-isolated capacity count.

CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id UUID,
  p_customer_name TEXT,
  p_customer_phone TEXT,
  p_party_size INT,
  p_token_hash TEXT,
  p_queue_type TEXT DEFAULT 'DINE_IN'
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
  -- Validate queue_type parameter server-side (client cannot bypass this)
  IF p_queue_type NOT IN ('DINE_IN', 'TAKEAWAY') THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TYPE: queue_type must be DINE_IN or TAKEAWAY, got %', p_queue_type;
  END IF;

  SELECT * INTO v_restaurant FROM public.restaurants WHERE id = p_restaurant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESTAURANT_NOT_FOUND'; END IF;
  IF v_restaurant.status != 'ACTIVE' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;

  -- Service-type specific enablement checks
  IF p_queue_type = 'DINE_IN' THEN
    IF NOT v_restaurant.queue_enabled THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
  ELSIF p_queue_type = 'TAKEAWAY' THEN
    IF NOT COALESCE(v_restaurant.takeaway_enabled, false) THEN
      RAISE EXCEPTION 'TAKEAWAY_DISABLED: Takeaway queue is not enabled for this restaurant';
    END IF;
  END IF;

  -- Operating state check (applies to both service types)
  DECLARE
    v_op_state TEXT;
  BEGIN
    v_op_state := COALESCE(
      (SELECT queue_operating_state FROM public.restaurants WHERE id = p_restaurant_id),
      'OPEN'
    );
    IF v_op_state = 'CLOSED' THEN RAISE EXCEPTION 'QUEUE_CLOSED'; END IF;
    IF v_op_state = 'PAUSED' THEN RAISE EXCEPTION 'QUEUE_PAUSED'; END IF;
  EXCEPTION WHEN undefined_column THEN
    NULL; -- queue_operating_state may not be present in older schema versions during testing
  END;

  -- Party size validation (DINE_IN only — Takeaway has no party size concept)
  IF p_queue_type = 'DINE_IN' THEN
    IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
      RAISE EXCEPTION 'INVALID_PARTY_SIZE';
    END IF;
  END IF;

  -- Capacity check: count only entries of the SAME queue_type (isolated queues)
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    AND queue_type = p_queue_type;

  IF v_active_count >= v_restaurant.max_queue_capacity THEN RAISE EXCEPTION 'QUEUE_FULL'; END IF;

  -- Duplicate phone check (per restaurant + queue_type, not cross-type)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
        AND queue_type = p_queue_type
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;

  -- Queue number: global sequential per restaurant (unchanged)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries WHERE restaurant_id = p_restaurant_id;

  v_display_num := v_queue_num::text;

  -- Insert new entry with queue_type
  INSERT INTO public.queue_entries (
    restaurant_id, customer_name, customer_phone, party_size,
    queue_number, display_number, status, token_hash, queue_type,
    joined_at, created_at, updated_at
  )
  VALUES (
    p_restaurant_id,
    p_customer_name,
    NULLIF(p_customer_phone, ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    p_queue_type,
    NOW(), NOW(), NOW()
  )
  RETURNING * INTO v_new_entry;

  -- Queue event
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, metadata)
  VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size', p_party_size,
      'display_number', v_display_num,
      'queue_number', v_queue_num,
      'queue_type', p_queue_type
    )
  );

  -- Outbox event for notification pipeline
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    p_restaurant_id,
    'QUEUE_JOINED',
    'QUEUE',
    v_new_entry.id::text,
    jsonb_build_object(
      'customerName', p_customer_name,
      'partySize', p_party_size,
      'displayNumber', v_display_num,
      'queueNumber', v_queue_num,
      'queueType', p_queue_type
    ),
    'PENDING'
  );

  -- Realtime broadcast
  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', p_restaurant_id,
    'entry_id', v_new_entry.id,
    'event', 'QUEUE_JOINED',
    'queue_type', p_queue_type
  )::text);

  RETURN v_new_entry;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID, TEXT, TEXT, INT, TEXT, TEXT) TO anon, authenticated, service_role;

-- ============================================================================
-- 6. GUARD seat_queue_entry_atomic — REJECT TAKEAWAY ENTRIES
-- ============================================================================
-- The existing seat_queue_entry_atomic RPC is extended with a single early
-- guard that rejects TAKEAWAY entries. All existing DINE_IN seating behavior
-- is completely unchanged.

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
  v_queue_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
  v_seating_count INT;
BEGIN
  SELECT * INTO v_queue_entry FROM public.queue_entries WHERE id = p_queue_entry_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND'; END IF;

  -- === TAKEAWAY SEATING GUARD (Phase 1) ===
  -- This is the authoritative server-side rejection. The front end may hide
  -- the seating button, but this guard makes it impossible to seat a Takeaway
  -- entry regardless of how the request is constructed.
  IF v_queue_entry.queue_type = 'TAKEAWAY' THEN
    RAISE EXCEPTION 'TAKEAWAY_CANNOT_BE_SEATED: Takeaway orders do not receive table assignments. Use complete_takeaway_atomic instead.';
  END IF;

  IF v_queue_entry.status NOT IN ('WAITING', 'NOTIFIED', 'CALLED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: status % cannot be seated', v_queue_entry.status;
  END IF;

  -- Load table
  SELECT * INTO v_table FROM public.restaurant_tables WHERE id = p_table_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND'; END IF;
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
  IF COALESCE((v_table AS public.restaurant_tables).is_archived::boolean, false) THEN RAISE EXCEPTION 'TABLE_ARCHIVED'; END IF;
  IF v_table.status NOT IN ('AVAILABLE', 'OCCUPIED') THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE'; END IF;

  v_seating_count := COALESCE(p_actual_guests, v_queue_entry.party_size);

  -- Validate combined table capacity if additional tables provided
  DECLARE
    v_total_capacity INT := v_table.free_seats;
    v_add_table_id UUID;
    v_add_table public.restaurant_tables%ROWTYPE;
  BEGIN
    IF p_additional_table_ids IS NOT NULL AND array_length(p_additional_table_ids, 1) > 0 THEN
      FOREACH v_add_table_id IN ARRAY p_additional_table_ids LOOP
        SELECT * INTO v_add_table FROM public.restaurant_tables WHERE id = v_add_table_id FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'TABLE_NOT_FOUND: additional table %', v_add_table_id; END IF;
        IF v_add_table.restaurant_id != v_queue_entry.restaurant_id THEN RAISE EXCEPTION 'TENANT_MISMATCH'; END IF;
        IF v_add_table.status NOT IN ('AVAILABLE', 'OCCUPIED') THEN RAISE EXCEPTION 'TABLE_NOT_AVAILABLE: additional table %', v_add_table_id; END IF;
        v_total_capacity := v_total_capacity + v_add_table.free_seats;
      END LOOP;

      IF v_total_capacity < v_seating_count THEN
        RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: combined capacity % < guests %', v_total_capacity, v_seating_count;
      END IF;

      -- Seat across multiple tables proportionally
      DECLARE
        v_remaining INT := v_seating_count;
        v_primary_alloc INT;
        v_add_alloc INT;
      BEGIN
        v_primary_alloc := LEAST(v_remaining, v_table.free_seats);
        v_remaining := v_remaining - v_primary_alloc;

        -- Update primary table
        UPDATE public.restaurant_tables SET
          status = 'OCCUPIED',
          occupied_seats = occupied_seats + v_primary_alloc,
          free_seats = GREATEST(0, free_seats - v_primary_alloc),
          updated_at = v_now
        WHERE id = p_table_id;

        -- Primary assignment
        INSERT INTO public.active_seating_assignments
          (restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary)
        VALUES
          (v_queue_entry.restaurant_id, p_queue_entry_id, p_table_id, v_primary_alloc, true)
        ON CONFLICT (queue_entry_id, table_id) DO UPDATE
          SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;

        FOREACH v_add_table_id IN ARRAY p_additional_table_ids LOOP
          SELECT * INTO v_add_table FROM public.restaurant_tables WHERE id = v_add_table_id;
          v_add_alloc := LEAST(v_remaining, v_add_table.free_seats);
          IF v_add_alloc > 0 THEN
            UPDATE public.restaurant_tables SET
              status = 'OCCUPIED',
              occupied_seats = occupied_seats + v_add_alloc,
              free_seats = GREATEST(0, free_seats - v_add_alloc),
              updated_at = v_now
            WHERE id = v_add_table_id;

            INSERT INTO public.active_seating_assignments
              (restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary)
            VALUES
              (v_queue_entry.restaurant_id, p_queue_entry_id, v_add_table_id, v_add_alloc, false)
            ON CONFLICT (queue_entry_id, table_id) DO UPDATE
              SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;

            v_remaining := v_remaining - v_add_alloc;
          END IF;
        END LOOP;
      END;
    ELSE
      -- Single table seating
      IF v_table.free_seats < v_seating_count THEN
        RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: table free_seats=% < guests=%', v_table.free_seats, v_seating_count;
      END IF;

      UPDATE public.restaurant_tables SET
        status = 'OCCUPIED',
        occupied_seats = occupied_seats + v_seating_count,
        free_seats = GREATEST(0, free_seats - v_seating_count),
        updated_at = v_now
      WHERE id = p_table_id;

      INSERT INTO public.active_seating_assignments
        (restaurant_id, queue_entry_id, table_id, guests_allocated, is_primary)
      VALUES
        (v_queue_entry.restaurant_id, p_queue_entry_id, p_table_id, v_seating_count, true)
      ON CONFLICT (queue_entry_id, table_id) DO UPDATE
        SET guests_allocated = EXCLUDED.guests_allocated, updated_at = v_now;
    END IF;
  END;

  -- Transition queue entry to SEATED
  UPDATE public.queue_entries SET
    status = 'SEATED',
    seated_table_id = p_table_id,
    seated_at = v_now,
    actual_guests = v_seating_count,
    updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_queue_entry;

  -- Queue event
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_queue_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'actual_guests', v_seating_count,
      'additional_tables', p_additional_table_ids,
      'seated_at', v_now
    )
  );

  -- Outbox
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_queue_entry.restaurant_id,
    'QUEUE_SEATED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'queueEntryId', p_queue_entry_id,
      'tableId', p_table_id,
      'actualGuests', v_seating_count,
      'seatedAt', v_now
    ),
    'PENDING'
  );

  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', v_queue_entry.restaurant_id,
    'entry_id', p_queue_entry_id,
    'event', 'QUEUE_SEATED'
  )::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'tableId', p_table_id,
    'status', 'SEATED',
    'seatedAt', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID, INT, UUID[]) FROM anon, authenticated;

-- ============================================================================
-- 7. complete_takeaway_atomic — TAKEAWAY PICKUP COMPLETION RPC
-- ============================================================================
-- Staff marks a Takeaway order as collected by customer.
-- Transitions WAITING/CALLED → COMPLETED (the Takeaway terminal state).
-- SEATED is never reachable for Takeaway entries.

CREATE OR REPLACE FUNCTION public.complete_takeaway_atomic(
  p_queue_entry_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry public.queue_entries%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
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

  -- Transition to COMPLETED
  UPDATE public.queue_entries SET
    status = 'COMPLETED',
    completed_at = v_now,
    updated_at = v_now
  WHERE id = p_queue_entry_id
  RETURNING * INTO v_entry;

  -- Queue event (TAKEAWAY_COMPLETED distinguishes from legacy QUEUE_COMPLETED)
  INSERT INTO public.queue_events (restaurant_id, queue_entry_id, event_type, actor_user_id, metadata)
  VALUES (
    v_entry.restaurant_id,
    p_queue_entry_id,
    'TAKEAWAY_COMPLETED',
    p_actor_user_id,
    jsonb_build_object(
      'queue_type', 'TAKEAWAY',
      'completed_at', v_now,
      'actor_user_id', p_actor_user_id,
      'display_number', v_entry.display_number,
      'customer_name', v_entry.customer_name
    )
  );

  -- Outbox for notification pipeline
  INSERT INTO public.outbox_events (restaurant_id, event_type, aggregate_type, aggregate_id, payload, status)
  VALUES (
    v_entry.restaurant_id,
    'TAKEAWAY_COMPLETED',
    'QUEUE',
    p_queue_entry_id::text,
    jsonb_build_object(
      'queueEntryId', p_queue_entry_id,
      'displayNumber', v_entry.display_number,
      'customerName', v_entry.customer_name,
      'queueType', 'TAKEAWAY',
      'completedAt', v_now
    ),
    'PENDING'
  );

  -- Realtime broadcast
  PERFORM pg_notify('queue_entry_update', json_build_object(
    'restaurant_id', v_entry.restaurant_id,
    'entry_id', p_queue_entry_id,
    'event', 'TAKEAWAY_COMPLETED',
    'queue_type', 'TAKEAWAY'
  )::text);

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'displayNumber', v_entry.display_number,
    'status', 'COMPLETED',
    'completedAt', v_now
  );
END;
$$;

-- Least privilege: only service_role (server-side authenticated calls only)
REVOKE ALL ON FUNCTION public.complete_takeaway_atomic(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_takeaway_atomic(UUID, UUID) TO service_role;

-- ============================================================================
-- 8. RBAC — TAKEAWAY DOMAIN PERMISSIONS
-- ============================================================================

INSERT INTO public.permissions (key, domain, description) VALUES
  ('takeaway.manage', 'TAKEAWAY', 'Manage takeaway queue: view, call, mark collected'),
  ('takeaway.complete', 'TAKEAWAY', 'Complete/mark takeaway orders as collected by customer')
ON CONFLICT (key) DO UPDATE SET
  domain = EXCLUDED.domain,
  description = EXCLUDED.description;

-- Grant Takeaway permissions to RESTAURANT_ADMIN and STAFF
INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key IN ('takeaway.manage', 'takeaway.complete')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions WHERE key IN ('takeaway.manage', 'takeaway.complete')
ON CONFLICT (role, permission_id) DO NOTHING;

-- ============================================================================
-- REALTIME: queue_entries already in publication — no change needed
-- The existing supabase_realtime publication covers queue_entries with FULL
-- replica identity. Takeaway entries will broadcast naturally.
-- ============================================================================
