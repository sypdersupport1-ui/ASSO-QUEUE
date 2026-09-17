-- ============================================================================
-- QUEUEFLOW PHASE 8 MIGRATION: CORE QUEUE ENGINE & CONCURRENCY CONTROL
-- ============================================================================

-- 1. EXTEND RESTAURANTS WITH QUEUE CONFIGURATION
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS queue_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS max_queue_capacity INT NOT NULL DEFAULT 100 CHECK (max_queue_capacity > 0),
  ADD COLUMN IF NOT EXISTS min_party_size INT NOT NULL DEFAULT 1 CHECK (min_party_size > 0),
  ADD COLUMN IF NOT EXISTS max_party_size INT NOT NULL DEFAULT 20 CHECK (max_party_size >= min_party_size),
  ADD COLUMN IF NOT EXISTS call_timeout_minutes INT NOT NULL DEFAULT 15 CHECK (call_timeout_minutes > 0);

-- 2. EXTEND QUEUE_ENTRIES SCHEMA
ALTER TABLE public.queue_entries
  ADD COLUMN IF NOT EXISTS display_number TEXT,
  ADD COLUMN IF NOT EXISTS called_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update check constraint on queue_entries status to include CALLED and EXPIRED
ALTER TABLE public.queue_entries
  DROP CONSTRAINT IF EXISTS queue_entries_status_check;

ALTER TABLE public.queue_entries
  ADD CONSTRAINT queue_entries_status_check
  CHECK (status IN ('WAITING', 'CALLED', 'NOTIFIED', 'SEATED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'COMPLETED', 'REMOVED', 'SKIPPED'));

-- 3. UNIQUE ACTIVE CUSTOMER CONTACT INDEX (DUPLICATE JOIN PREVENTION)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_active_customer_phone
  ON public.queue_entries (restaurant_id, customer_phone)
  WHERE status IN ('WAITING', 'CALLED', 'NOTIFIED') AND customer_phone IS NOT NULL AND customer_phone != '';

-- 4. PERFORMANCE INDEX FOR POSITION CALCULATIONS & QUEUE LISTINGS
CREATE INDEX IF NOT EXISTS idx_queue_entries_position
  ON public.queue_entries (restaurant_id, status, joined_at, id);

CREATE INDEX IF NOT EXISTS idx_queue_events_queue_entry
  ON public.queue_events (queue_entry_id, created_at DESC);

-- 5. ATOMIC QUEUE JOIN DATABASE FUNCTION (CONCURRENCY & CAPACITY SAFE)
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
AS $$
DECLARE
  v_restaurant public.restaurants%ROWTYPE;
  v_active_count INT;
  v_queue_num INT;
  v_display_num TEXT;
  v_new_entry public.queue_entries%ROWTYPE;
BEGIN
  -- 1. Lock restaurant row for capacity/sequence concurrency safety
  SELECT * INTO v_restaurant
  FROM public.restaurants
  WHERE id = p_restaurant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RESTAURANT_NOT_FOUND';
  END IF;

  -- 2. Verify queue is enabled/open
  IF NOT v_restaurant.queue_enabled THEN
    RAISE EXCEPTION 'QUEUE_CLOSED';
  END IF;

  -- 3. Validate party size
  IF p_party_size < v_restaurant.min_party_size OR p_party_size > v_restaurant.max_party_size THEN
    RAISE EXCEPTION 'INVALID_PARTY_SIZE';
  END IF;

  -- 4. Enforce capacity limit
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED');

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL';
  END IF;

  -- 5. Check duplicate active phone
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY';
    END IF;
  END IF;

  -- 6. Generate next sequential queue number & display number
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id;

  v_display_num := 'Q-' || v_queue_num::text;

  -- 7. Insert queue entry
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
    p_customer_name,
    NULLIF(p_customer_phone, ''),
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

  -- 8. Insert queue lifecycle event
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
      'party_size', p_party_size,
      'display_number', v_display_num,
      'queue_number', v_queue_num
    )
  );

  RETURN v_new_entry;
END;
$$;

-- 6. ADD QUEUE SETTINGS PERMISSION TO RBAC CATALOG
INSERT INTO public.permissions (key, domain, description)
VALUES ('queue.settings.update', 'QUEUE', 'Update restaurant queue configuration and open/close state')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'queue.settings.update'
ON CONFLICT (role, permission_id) DO NOTHING;
