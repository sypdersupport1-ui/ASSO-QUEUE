-- ============================================================================
-- QUEUEFLOW PHASE 10 MIGRATION: QUEUE OPERATIONS, ETA ENGINE & ATOMIC SEATING
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH ETA CONFIGURATION
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS avg_service_time_mins INT NOT NULL DEFAULT 15 CHECK (avg_service_time_mins > 0),
  ADD COLUMN IF NOT EXISTS service_capacity_units INT NOT NULL DEFAULT 3 CHECK (service_capacity_units > 0),
  ADD COLUMN IF NOT EXISTS eta_buffer_mins INT NOT NULL DEFAULT 5 CHECK (eta_buffer_mins >= 0),
  ADD COLUMN IF NOT EXISTS almost_your_turn_threshold INT NOT NULL DEFAULT 3 CHECK (almost_your_turn_threshold >= 1);

-- 2. EXTEND QUEUE_ENTRIES WITH SEATED TABLE REFERENCE
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS seated_table_id UUID REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_queue_entries_seated_table
  ON public.queue_entries (seated_table_id) WHERE seated_table_id IS NOT NULL;

-- 3. ATOMIC SEATING DATABASE FUNCTION (RACE CONDITION & CAPACITY SAFE)
CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id UUID,
  p_actor_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_queue_entry public.queue_entries%ROWTYPE;
  v_table public.restaurant_tables%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  -- 1. Lock Queue Entry row for atomic transition
  SELECT * INTO v_queue_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Verify queue entry is in a seatable status
  IF v_queue_entry.status IN ('SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED') THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_ALREADY_SEATED';
  END IF;

  -- 2. Lock Target Table row for atomic reservation
  SELECT * INTO v_table
  FROM public.restaurant_tables
  WHERE id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND';
  END IF;

  -- Verify table belongs to the same tenant
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  -- Verify table is currently AVAILABLE
  IF v_table.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'TABLE_NOT_AVAILABLE';
  END IF;

  -- Verify table capacity is sufficient for party size
  IF v_table.capacity < v_queue_entry.party_size THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY';
  END IF;

  -- 3. Perform Atomic Updates
  -- Update Queue Entry status -> SEATED
  UPDATE public.queue_entries
  SET
    status = 'SEATED',
    seated_table_id = p_table_id,
    seated_at = v_now,
    updated_at = v_now
  WHERE id = p_queue_entry_id;

  -- Update Table status -> OCCUPIED
  UPDATE public.restaurant_tables
  SET
    status = 'OCCUPIED',
    updated_at = v_now
  WHERE id = p_table_id;

  -- 4. Record Queue Event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    actor_user_id,
    metadata
  ) VALUES (
    v_queue_entry.restaurant_id,
    p_queue_entry_id,
    'QUEUE_SEATED',
    p_actor_user_id,
    jsonb_build_object(
      'table_id', p_table_id,
      'table_number', v_table.table_number,
      'party_size', v_queue_entry.party_size,
      'previous_status', v_queue_entry.status
    )
  );

  -- 5. Record Audit Log
  IF p_actor_user_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      restaurant_id,
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata
    ) VALUES (
      v_queue_entry.restaurant_id,
      p_actor_user_id,
      'queue_entry_seated',
      'queue_entry',
      p_queue_entry_id,
      jsonb_build_object(
        'tableId', p_table_id,
        'tableNumber', v_table.table_number,
        'customerName', v_queue_entry.customer_name,
        'displayNumber', v_queue_entry.display_number
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'queueEntryId', p_queue_entry_id,
    'tableId', p_table_id,
    'tableNumber', v_table.table_number,
    'seatedAt', v_now
  );
END;
$$;

-- 4. ADD NOTIFY AND NO_SHOW PERMISSIONS TO RBAC CATALOG
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('queue.notify', 'QUEUE', 'Notify customer that turn is approaching'),
  ('queue.no_show', 'QUEUE', 'Mark called customer entry as no-show')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key IN ('queue.notify', 'queue.no_show')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'STAFF', id FROM public.permissions WHERE key IN ('queue.notify', 'queue.no_show')
ON CONFLICT (role, permission_id) DO NOTHING;
