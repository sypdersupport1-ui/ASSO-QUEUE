-- =============================================================================
-- Phase 17: Queue Number Formatting Fix
-- =============================================================================

-- Update join_queue_atomic to remove the Q- prefix
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
  v_cutoff       TIMESTAMPTZ;
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
  
  -- Calculate 5 AM cutoff
  v_cutoff := public.get_recent_5am_cutoff(v_restaurant.timezone);

  -- 6. Enforce capacity limit (Only consider entries joined after 5 AM cutoff)
  SELECT COUNT(*) INTO v_active_count
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
    AND joined_at >= v_cutoff;

  IF v_active_count >= v_restaurant.max_queue_capacity THEN
    RAISE EXCEPTION 'QUEUE_FULL: Queue capacity % reached', v_restaurant.max_queue_capacity;
  END IF;

  -- 7. Check duplicate active phone (Only consider entries joined after 5 AM cutoff)
  IF p_customer_phone IS NOT NULL AND p_customer_phone != '' THEN
    IF EXISTS (
      SELECT 1 FROM public.queue_entries
      WHERE restaurant_id  = p_restaurant_id
        AND customer_phone = p_customer_phone
        AND status IN ('WAITING', 'CALLED', 'NOTIFIED')
        AND joined_at >= v_cutoff
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_ENTRY: Phone number already has an active queue entry';
    END IF;
  END IF;

  -- 8. Generate next sequential queue number & display number for TODAY (since 5 AM)
  SELECT COALESCE(MAX(queue_number), 0) + 1 INTO v_queue_num
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= v_cutoff;

  v_display_num := v_queue_num::text;

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
