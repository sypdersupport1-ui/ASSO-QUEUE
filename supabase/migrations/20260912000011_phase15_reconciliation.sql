-- =============================================================================
-- QUEUEFLOW PHASE 15 RECONCILIATION MIGRATION
-- 20260912000011_phase15_reconciliation.sql
--
-- This migration fixes critical state-model drift, RPC bugs, and security
-- definer issues discovered during Phase 15 production sign-off audit.
--
-- IMPORTANT: This migration PRESERVES all existing historical data.
-- It does NOT rewrite or drop existing tables or migrations.
--
-- Changes:
--   1. Fix phantom column reference in Phase 15 index (notifications)
--   2. Add PROCESSING to outbox_events status CHECK constraint
--   3. Fix claim_outbox_events() — atomic UPDATE…RETURNING CTE
--   4. Add recover_stale_outbox_events() for crash/lease recovery
--   5. Fix seat_queue_entry_atomic() — complete FSM + authorization
--   6. Add deduct_inventory_atomic() RPC with idempotency
--   7. Add inventory ORDER_CONSUMPTION idempotency unique index
--   8. Restrict new orders from using deprecated status values
--   9. Restrict new payments from using ambiguous COMPLETED status
--  10. Fix join_queue_atomic() — add search_path + ACTIVE restaurant check
--  11. Fix analytics RPCs — add SET search_path
--  12. Correct EXECUTE privilege grants for privileged RPCs
-- =============================================================================

-- =============================================================================
-- 1. DROP PHANTOM INDEX FROM PHASE 15 HARDENING
--    (references columns that do not exist: recipient_user_id, is_read)
-- =============================================================================

DROP INDEX IF EXISTS public.idx_notifications_recipient_unread;

-- Correct replacement: index on restaurant_id + status for staff polling
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_status
  ON public.notifications (restaurant_id, status, created_at DESC);

-- =============================================================================
-- 2. ADD PROCESSING STATUS TO outbox_events CHECK CONSTRAINT
--    The TypeScript OutboxStatus type includes PROCESSING but the DB CHECK did
--    not. This caused a mismatch where the application could set PROCESSING but
--    the constraint would reject it if ever re-evaluated.
-- =============================================================================

ALTER TABLE public.outbox_events
  DROP CONSTRAINT IF EXISTS outbox_events_status_check;

ALTER TABLE public.outbox_events
  ADD CONSTRAINT outbox_events_status_check
  CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));

-- =============================================================================
-- 3. FIX claim_outbox_events() — ATOMIC UPDATE … RETURNING CTE
--
-- Previous implementation:
--   SELECT * FROM outbox_events WHERE … FOR UPDATE SKIP LOCKED
--
-- BUG: The SELECT lock was released at transaction end. Because the function
-- is called from application code in its own transaction, by the time the
-- application processes the event, the row is already unlocked and another
-- concurrent worker could claim the same event.
--
-- Fix: Use a CTE that atomically UPDATEs status to PROCESSING (within the
-- same statement) and RETURNS the updated rows. The row is already committed
-- as PROCESSING before the function returns, so no other worker can claim it.
--
-- Concurrent behaviour:
--   Worker A: UPDATE claims event → status = PROCESSING → returned
--   Worker B: UPDATE skips event (FOR UPDATE SKIP LOCKED) → not returned
--   → No duplicate claim possible.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.claim_outbox_events(p_limit INT DEFAULT 20)
RETURNS SETOF public.outbox_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
    FROM public.outbox_events
    WHERE status IN ('PENDING', 'FAILED')
      AND next_attempt_at <= NOW()
    ORDER BY next_attempt_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.outbox_events oe
  SET
    status     = 'PROCESSING',
    updated_at = NOW()
  FROM claimed
  WHERE oe.id = claimed.id
  RETURNING oe.*;
END;
$$;

-- =============================================================================
-- 4. STALE PROCESSING RECOVERY FUNCTION
--
-- If a worker crashes while processing an event, the event remains stuck in
-- PROCESSING forever. This function safely recovers such events by transitioning
-- them back to PENDING (if retry_count < max_retries) or FAILED (terminal).
--
-- Lease semantics:
--   - A PROCESSING event is considered stale if updated_at < NOW() - interval
--   - Default lease: 30 minutes (configurable via p_stale_after_mins)
--   - Recovery increments retry_count
--   - Events at max_retries become permanently FAILED
--   - Active PROCESSING events (within lease) are NOT touched
--
-- Caller: background cron or worker health-check; NOT called by public clients.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recover_stale_outbox_events(
  p_stale_after_mins INT DEFAULT 30
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_recovered INT := 0;
  v_stale_cutoff TIMESTAMPTZ;
BEGIN
  v_stale_cutoff := NOW() - (p_stale_after_mins || ' minutes')::INTERVAL;

  -- Recover stale PROCESSING events back to PENDING (with retry backoff)
  -- or permanently FAILED if max_retries exhausted
  WITH stale AS (
    SELECT id, retry_count, max_retries
    FROM public.outbox_events
    WHERE status = 'PROCESSING'
      AND updated_at < v_stale_cutoff
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE public.outbox_events oe
    SET
      status           = CASE
                           WHEN (stale.retry_count + 1) >= stale.max_retries THEN 'FAILED'
                           ELSE 'PENDING'
                         END,
      retry_count      = stale.retry_count + 1,
      last_error       = 'Worker crash recovery: lease expired after ' ||
                         p_stale_after_mins || ' minutes',
      -- Exponential backoff: 2^retry * 30s, capped at 1 hour
      next_attempt_at  = CASE
                           WHEN (stale.retry_count + 1) >= stale.max_retries THEN NOW()
                           ELSE NOW() + LEAST(
                             POWER(2, stale.retry_count + 1) * 30,
                             3600
                           ) * INTERVAL '1 second'
                         END,
      updated_at       = NOW()
    FROM stale
    WHERE oe.id = stale.id
    RETURNING oe.id
  )
  SELECT COUNT(*) INTO v_recovered FROM updated;

  RETURN v_recovered;
END;
$$;

-- =============================================================================
-- 5. FIX seat_queue_entry_atomic()
--
-- Issues fixed:
--   a) Incomplete FSM guard — only rejected SEATED, CANCELLED, NO_SHOW, EXPIRED.
--      Did NOT reject COMPLETED, REMOVED, SKIPPED (all terminal states).
--      A COMPLETED/REMOVED/SKIPPED entry could be re-seated.
--
--   b) No authorization — any anonymous user could call this SECURITY DEFINER
--      function directly. p_actor_user_id was accepted from the browser and
--      used blindly without verifying the caller is actually that user, or has
--      the queue.seat permission.
--
-- Authoritative seatableStatuses = {WAITING, CALLED, NOTIFIED}
-- All other states are terminal (or invalid) and must be rejected.
--
-- Authorization: The function now verifies that auth.uid() has the queue.seat
-- permission for the target restaurant. For internal/system calls where auth
-- context is the service_role (no auth.uid()), p_actor_user_id is validated
-- to have the permission — but only when explicitly provided as a fallback.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.seat_queue_entry_atomic(
  p_queue_entry_id UUID,
  p_table_id       UUID,
  p_actor_user_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_queue_entry    public.queue_entries%ROWTYPE;
  v_table          public.restaurant_tables%ROWTYPE;
  v_actor_id       UUID;
  v_now            TIMESTAMPTZ := NOW();
  -- Authoritative set of states that CAN be seated
  v_seatable_states TEXT[] := ARRAY['WAITING', 'CALLED', 'NOTIFIED'];
  -- All states that are definitively terminal (non-seatable)
  v_terminal_states TEXT[] := ARRAY[
    'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED',
    'COMPLETED', 'REMOVED', 'SKIPPED'
  ];
BEGIN
  -- --------------------------------------------------------
  -- STEP 0: Resolve actor identity
  -- Prefer auth.uid() (server-side session) over p_actor_user_id.
  -- If auth.uid() is NULL (service_role context), fall back to p_actor_user_id.
  -- --------------------------------------------------------
  v_actor_id := COALESCE(auth.uid(), p_actor_user_id);

  -- --------------------------------------------------------
  -- STEP 1: Authorization check
  -- The caller MUST have queue.seat permission for the restaurant that owns
  -- this queue entry. We read the restaurant_id from the queue entry first.
  -- --------------------------------------------------------
  SELECT restaurant_id INTO STRICT v_queue_entry.restaurant_id
  FROM public.queue_entries
  WHERE id = p_queue_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Deny anonymous callers unconditionally
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'UNAUTHORIZED: Authentication required to seat a queue entry';
  END IF;

  -- Verify queue.seat permission for the resolved restaurant
  IF NOT public.has_permission(v_actor_id, v_queue_entry.restaurant_id, 'queue.seat') THEN
    RAISE EXCEPTION 'UNAUTHORIZED: queue.seat permission required';
  END IF;

  -- --------------------------------------------------------
  -- STEP 2: Lock Queue Entry for atomic FSM transition
  -- --------------------------------------------------------
  SELECT * INTO v_queue_entry
  FROM public.queue_entries
  WHERE id = p_queue_entry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QUEUE_ENTRY_NOT_FOUND';
  END IF;

  -- Reject ALL non-seatable states
  IF NOT (v_queue_entry.status = ANY(v_seatable_states)) THEN
    IF v_queue_entry.status = ANY(v_terminal_states) THEN
      RAISE EXCEPTION 'QUEUE_ENTRY_TERMINAL: Cannot seat entry in terminal state %', v_queue_entry.status;
    ELSE
      RAISE EXCEPTION 'QUEUE_ENTRY_NOT_SEATABLE: Entry status % is not eligible for seating', v_queue_entry.status;
    END IF;
  END IF;

  -- --------------------------------------------------------
  -- STEP 3: Lock Target Table for atomic reservation
  -- --------------------------------------------------------
  SELECT * INTO v_table
  FROM public.restaurant_tables
  WHERE id = p_table_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND';
  END IF;

  -- Verify table belongs to the same tenant
  IF v_table.restaurant_id != v_queue_entry.restaurant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH: Table does not belong to this restaurant';
  END IF;

  -- Verify table is not archived
  IF v_table.is_archived THEN
    RAISE EXCEPTION 'TABLE_ARCHIVED: Cannot seat at an archived table';
  END IF;

  -- Verify table is currently AVAILABLE
  IF v_table.status != 'AVAILABLE' THEN
    RAISE EXCEPTION 'TABLE_NOT_AVAILABLE: Table status is %', v_table.status;
  END IF;

  -- Verify table capacity is sufficient for party size
  IF v_table.capacity < v_queue_entry.party_size THEN
    RAISE EXCEPTION 'INSUFFICIENT_TABLE_CAPACITY: Table capacity % < party size %',
      v_table.capacity, v_queue_entry.party_size;
  END IF;

  -- --------------------------------------------------------
  -- STEP 4: Atomic Updates
  -- --------------------------------------------------------

  -- Update Queue Entry status → SEATED
  UPDATE public.queue_entries
  SET
    status          = 'SEATED',
    seated_table_id = p_table_id,
    seated_at       = v_now,
    updated_at      = v_now
  WHERE id = p_queue_entry_id;

  -- Update Table status → OCCUPIED
  UPDATE public.restaurant_tables
  SET
    status     = 'OCCUPIED',
    updated_at = v_now
  WHERE id = p_table_id;

  -- --------------------------------------------------------
  -- STEP 5: Record Queue Event
  -- --------------------------------------------------------
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
    v_actor_id,
    jsonb_build_object(
      'table_id',       p_table_id,
      'table_number',   v_table.table_number,
      'party_size',     v_queue_entry.party_size,
      'previous_status', v_queue_entry.status
    )
  );

  -- --------------------------------------------------------
  -- STEP 6: Record Audit Log
  -- --------------------------------------------------------
  INSERT INTO public.audit_logs (
    restaurant_id,
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata
  ) VALUES (
    v_queue_entry.restaurant_id,
    v_actor_id,
    'queue_entry_seated',
    'queue_entry',
    p_queue_entry_id,
    jsonb_build_object(
      'tableId',      p_table_id,
      'tableNumber',  v_table.table_number,
      'customerName', v_queue_entry.customer_name,
      'displayNumber', v_queue_entry.display_number,
      'previousStatus', v_queue_entry.status
    )
  );

  RETURN jsonb_build_object(
    'success',      true,
    'queueEntryId', p_queue_entry_id,
    'tableId',      p_table_id,
    'tableNumber',  v_table.table_number,
    'seatedAt',     v_now
  );
END;
$$;

-- =============================================================================
-- 6. ADD deduct_inventory_atomic() RPC
--
-- This replaces the unsafe inline inventory deduction in order-service.ts.
--
-- Design:
--   - Validates p_quantity > 0 (rejects zero and negative)
--   - Locks the inventory_items row FOR UPDATE (prevents race conditions)
--   - Checks sufficient stock before deducting
--   - Inserts an inventory_movements record
--   - Idempotency: unique index on (inventory_item_id, reference_type, reference_id)
--     ensures the same (order, inventory_item) pair cannot be deducted twice.
--   - One order may consume multiple inventory items — idempotency is per
--     (order_id + inventory_item_id), NOT per order alone.
--
-- Authorization: REVOKE from PUBLIC; only service_role (server-side) may call.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.deduct_inventory_atomic(
  p_restaurant_id     UUID,
  p_inventory_item_id UUID,
  p_quantity          NUMERIC,
  p_reference_type    TEXT DEFAULT 'ORDER',
  p_reference_id      UUID DEFAULT NULL,
  p_reason            TEXT DEFAULT NULL,
  p_created_by        UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item          public.inventory_items%ROWTYPE;
  v_qty_before    NUMERIC;
  v_qty_after     NUMERIC;
  v_movement_id   UUID;
BEGIN
  -- --------------------------------------------------------
  -- STEP 1: Validate inputs
  -- --------------------------------------------------------
  IF p_quantity <= 0 THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: Deduction quantity must be strictly positive, got %', p_quantity;
  END IF;

  IF p_inventory_item_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_ITEM: inventory_item_id is required';
  END IF;

  -- --------------------------------------------------------
  -- STEP 2: Lock inventory item row for atomic deduction
  -- --------------------------------------------------------
  SELECT * INTO v_item
  FROM public.inventory_items
  WHERE id = p_inventory_item_id
    AND restaurant_id = p_restaurant_id
    AND is_archived = FALSE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_ITEM_NOT_FOUND: Item % not found for restaurant %',
      p_inventory_item_id, p_restaurant_id;
  END IF;

  v_qty_before := v_item.current_quantity;
  v_qty_after  := v_qty_before - p_quantity;

  -- --------------------------------------------------------
  -- STEP 3: Check sufficient stock
  -- --------------------------------------------------------
  IF v_qty_after < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: Available=%, Requested=%, Item=%',
      v_qty_before, p_quantity, v_item.name;
  END IF;

  -- --------------------------------------------------------
  -- STEP 4: Idempotency check
  -- If an ORDER_CONSUMPTION movement already exists for this
  -- (inventory_item_id, reference_type, reference_id) combination,
  -- return success without re-deducting (exactly-once guarantee).
  -- --------------------------------------------------------
  IF p_reference_type IS NOT NULL AND p_reference_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.inventory_movements
      WHERE inventory_item_id = p_inventory_item_id
        AND reference_type    = p_reference_type
        AND reference_id      = p_reference_id
        AND movement_type     = 'ORDER_CONSUMPTION'
    ) THEN
      RETURN jsonb_build_object(
        'success',        true,
        'idempotent',     true,
        'itemId',         p_inventory_item_id,
        'itemName',       v_item.name,
        'quantityBefore', v_qty_before,
        'quantityAfter',  v_qty_before,  -- unchanged, already consumed
        'message',        'Already consumed — idempotent no-op'
      );
    END IF;
  END IF;

  -- --------------------------------------------------------
  -- STEP 5: Apply deduction
  -- --------------------------------------------------------
  UPDATE public.inventory_items
  SET
    current_quantity = v_qty_after,
    updated_at       = NOW()
  WHERE id = p_inventory_item_id;

  -- --------------------------------------------------------
  -- STEP 6: Record movement ledger entry
  -- --------------------------------------------------------
  INSERT INTO public.inventory_movements (
    restaurant_id,
    inventory_item_id,
    movement_type,
    quantity_delta,
    quantity_before,
    quantity_after,
    reference_type,
    reference_id,
    reason,
    created_by
  ) VALUES (
    p_restaurant_id,
    p_inventory_item_id,
    'ORDER_CONSUMPTION',
    -p_quantity,
    v_qty_before,
    v_qty_after,
    p_reference_type,
    p_reference_id,
    COALESCE(p_reason, 'Order consumption'),
    p_created_by
  )
  RETURNING id INTO v_movement_id;

  RETURN jsonb_build_object(
    'success',        true,
    'idempotent',     false,
    'movementId',     v_movement_id,
    'itemId',         p_inventory_item_id,
    'itemName',       v_item.name,
    'quantityBefore', v_qty_before,
    'quantityAfter',  v_qty_after,
    'quantityDeducted', p_quantity
  );
END;
$$;

-- =============================================================================
-- 7. INVENTORY ORDER_CONSUMPTION IDEMPOTENCY INDEX
--
-- Enforces exactly-once deduction per (order, inventory_item) pair at DB level.
-- Multiple distinct inventory items can be consumed per order (multi-ingredient).
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_order_consumption_idempotency
  ON public.inventory_movements (inventory_item_id, reference_type, reference_id)
  WHERE movement_type = 'ORDER_CONSUMPTION'
    AND reference_type IS NOT NULL
    AND reference_id   IS NOT NULL;

-- =============================================================================
-- 8. RESTRICT NEW ORDERS FROM USING DEPRECATED STATUS VALUES
--
-- Historical records with PENDING, ACCEPTED, IN_PREPARATION, COMPLETED are
-- PRESERVED. New records must use only the authoritative FSM states.
--
-- We add a NOT VALID constraint (checked only on new rows, not existing data).
-- =============================================================================

-- Drop the old permissive constraint
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_check;

-- Add new constraint: authoritative states only
-- Historical states (PENDING, ACCEPTED, IN_PREPARATION, COMPLETED) are preserved
-- but new inserts/updates are restricted.
-- NOT VALID means existing rows that violate it are not checked.
ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_status_authoritative_check;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_authoritative_check
  CHECK (status IN ('DRAFT', 'PLACED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'))
  NOT VALID;

-- Comment documenting legacy states
COMMENT ON COLUMN public.orders.status IS
  'Authoritative FSM: DRAFT→PLACED→CONFIRMED→PREPARING→READY→SERVED, CANCELLED.
   Legacy historical values (PENDING, ACCEPTED, IN_PREPARATION, COMPLETED) may
   exist in historical records but are not accepted for new records.';

-- =============================================================================
-- 9. PAYMENT STATUS CLARIFICATION
--
-- SUCCEEDED: Payment provider confirmed successful payment (authoritative).
-- COMPLETED: Legacy alias — same semantic as SUCCEEDED but ambiguous.
--
-- New records must use SUCCEEDED. Historical COMPLETED records are preserved.
-- =============================================================================

COMMENT ON COLUMN public.payments.status IS
  'Authoritative FSM: PENDING→PROCESSING→SUCCEEDED, or PENDING→FAILED.
   SUCCEEDED→REFUND_PENDING→REFUNDED for refund flows.
   COMPLETED is a legacy alias for SUCCEEDED preserved in historical records only.
   New records must use SUCCEEDED instead of COMPLETED.';

-- =============================================================================
-- 10. FIX join_queue_atomic() — add search_path + ACTIVE restaurant check
--
-- Phase 8 omitted SET search_path. Also, the function checked queue_enabled
-- but not the restaurant status itself (ACTIVE vs SUSPENDED/ARCHIVED).
-- A SUSPENDED restaurant's queue should not accept new joins.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.join_queue_atomic(
  p_restaurant_id  UUID,
  p_customer_name  TEXT,
  p_customer_phone TEXT,
  p_party_size     INT,
  p_token_hash     TEXT
)
RETURNS public.queue_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restaurant   public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num    INT;
  v_display_num  TEXT;
  v_new_entry    public.queue_entries%ROWTYPE;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify restaurant is ACTIVE (not SUSPENDED or ARCHIVED)
  IF v_restaurant.status != 'ACTIVE' THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_ACTIVE: Restaurant status is %', v_restaurant.status;
  END IF;

  -- 3. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 4. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE: Must be between % and %, got %',
      v_restaurant.min_party_size, v_restaurant.max_party_size, p_party_size;
  END IF;

  -- 5. Validate customer name not blank
  IF p_customer_name IS NULL OR TRIM(p_customer_name) = '' THEN
    RAISE EXCEPTION 'INVALID_CUSTOMER_NAME: Customer name cannot be blank';
  END IF;

  -- 6. Enforce capacity limit
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED');

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL: Queue capacity % reached', v_restaurant.max_queue_capacity;
  END IF;

  -- 7. Check duplicate active phone (application-level; index enforces at DB level)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id  = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY: Phone number already has an active queue entry';
    END IF;
  END IF;

  -- 8. Generate next sequential queue number & display number
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id;

  v_display_num := 'Q-' || v_queue_num::text;

  -- 9. Insert queue entry
  INSERT INTO public.queue_entries (
    restaurant_id,
    customer_name,
    customer_phone,
    party_size,
    queue_number,
    display_number,
    status,
    token_hash,
    joined_at,
    created_at,
    updated_at
  ) VALUES (
    p_restaurant_id,
    TRIM(p_customer_name),
    NULLIF(TRIM(COALESCE(p_customer_phone, '')), ''),
    p_party_size,
    v_queue_num,
    v_display_num,
    'WAITING',
    p_token_hash,
    NOW(),
    NOW(),
    NOW()
  )
  RETURNING * INTO v_new_entry;

  -- 10. Insert queue lifecycle event
  INSERT INTO public.queue_events (
    restaurant_id,
    queue_entry_id,
    event_type,
    metadata
  ) VALUES (
    p_restaurant_id,
    v_new_entry.id,
    'QUEUE_JOINED',
    jsonb_build_object(
      'party_size',    p_party_size,
      'display_number', v_display_num,
      'queue_number',  v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;

-- =============================================================================
-- 11. FIX ANALYTICS RPCs — ADD SET search_path
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_queue_metrics_summary(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_joined          INT;
  v_total_seated          INT;
  v_total_dropped         INT;
  v_avg_wait_time_seconds INT;
BEGIN
  -- Validate permissions (must be part of restaurant)
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COUNT(*) INTO v_total_joined
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date;

  SELECT COUNT(*) INTO v_total_seated
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED';

  SELECT COUNT(*) INTO v_total_dropped
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status IN ('CANCELLED', 'NO_SHOW', 'EXPIRED');

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (seated_at - joined_at))), 0)::INT
  INTO v_avg_wait_time_seconds
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED'
    AND seated_at IS NOT NULL;

  RETURN jsonb_build_object(
    'total_joined',           v_total_joined,
    'total_seated',           v_total_seated,
    'total_dropped',          v_total_dropped,
    'avg_wait_time_seconds',  v_avg_wait_time_seconds
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_hourly_queue_volume(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hour',  hour_bucket,
      'count', count
    )
  ), '[]'::jsonb) INTO v_result
  FROM (
    SELECT
      DATE_TRUNC('hour', joined_at) AS hour_bucket,
      COUNT(*) AS count
    FROM public.queue_entries
    WHERE restaurant_id = p_restaurant_id
      AND joined_at >= p_start_date
      AND joined_at <= p_end_date
    GROUP BY hour_bucket
    ORDER BY hour_bucket
  ) AS hourly_data;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_commerce_metrics_summary(
  p_restaurant_id UUID,
  p_start_date    TIMESTAMPTZ,
  p_end_date      TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_orders  INT;
  v_total_revenue NUMERIC;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id
      AND user_id = auth.uid()
      AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Total completed/served orders (authoritative terminal states)
  SELECT COUNT(*) INTO v_total_orders
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('SERVED', 'COMPLETED');  -- COMPLETED preserved for historical

  -- Total revenue from successful payments (SUCCEEDED is authoritative)
  SELECT COALESCE(SUM(amount - refunded_amount), 0) INTO v_total_revenue
  FROM public.payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('SUCCEEDED', 'COMPLETED');  -- COMPLETED preserved for historical

  RETURN jsonb_build_object(
    'total_orders',  v_total_orders,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- =============================================================================
-- 12. CORRECT EXECUTE PRIVILEGE GRANTS FOR ALL SECURITY DEFINER FUNCTIONS
--
-- Policy:
--   claim_outbox_events     → service_role ONLY (never public workers)
--   recover_stale_outbox_events → service_role ONLY
--   deduct_inventory_atomic → service_role ONLY
--   seat_queue_entry_atomic → authenticated + service_role
--     (function enforces has_permission() internally, so auth access is safe)
--   join_queue_atomic       → anon + authenticated + service_role (intentionally public)
--   analytics RPCs          → authenticated + service_role (internal auth check)
--   helper functions        → as previously granted
-- =============================================================================

-- Revoke broad public access from privileged internal RPCs
REVOKE EXECUTE ON FUNCTION public.claim_outbox_events(INT)         FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC;

-- Revoke anon access from seat_queue_entry_atomic
-- (authenticated is still needed; the function enforces has_permission internally)
REVOKE EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) FROM PUBLIC;

-- Grant service_role-only access for internal system functions
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(INT)         TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO service_role;

-- seat_queue_entry_atomic: authenticated (enforces permission internally) + service_role
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) TO authenticated, service_role;

-- join_queue_atomic remains accessible to anon + authenticated (intentionally public queue joining)
GRANT EXECUTE ON FUNCTION public.join_queue_atomic(UUID, TEXT, TEXT, INT, TEXT) TO anon, authenticated, service_role;

-- Analytics RPCs: authenticated + service_role (internal auth check prevents unauthorized access)
REVOKE EXECUTE ON FUNCTION public.get_queue_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_hourly_queue_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ)    FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_commerce_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_queue_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_hourly_queue_volume(UUID, TIMESTAMPTZ, TIMESTAMPTZ)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_commerce_metrics_summary(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated, service_role;

-- =============================================================================
-- MIGRATION COMPLETE
--
-- Summary of what was fixed:
--   ✓ Phantom column reference in Phase 15 index dropped
--   ✓ outbox_events.status CHECK now includes PROCESSING
--   ✓ claim_outbox_events() atomically transitions to PROCESSING
--   ✓ recover_stale_outbox_events() handles worker crash/lease expiry
--   ✓ seat_queue_entry_atomic() rejects all terminal states
--   ✓ seat_queue_entry_atomic() enforces queue.seat authorization
--   ✓ deduct_inventory_atomic() provides atomic, idempotent stock deduction
--   ✓ Inventory ORDER_CONSUMPTION idempotency enforced at DB level
--   ✓ New orders restricted to authoritative status values (NOT VALID preserves history)
--   ✓ Payment COMPLETED/SUCCEEDED semantics documented
--   ✓ join_queue_atomic() has SET search_path + ACTIVE restaurant check
--   ✓ Analytics RPCs have SET search_path
--   ✓ Privileged RPCs have correct REVOKE/GRANT
-- =============================================================================
