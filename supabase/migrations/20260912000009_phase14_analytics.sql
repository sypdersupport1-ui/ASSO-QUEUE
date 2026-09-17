-- QueueFlow Phase 14 Migration: Analytics & Operational Intelligence
-- Target Database: PostgreSQL / Supabase

-- ============================================================================
-- 1. QUEUE METRICS SUMMARY RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_queue_metrics_summary(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_joined INT;
  v_total_seated INT;
  v_total_dropped INT;
  v_avg_wait_time_seconds INT;
BEGIN
  -- Validate permissions (must be part of restaurant)
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
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

  SELECT COALESCE(AVG(EXTRACT(EPOCH FROM (seated_at - joined_at))), 0)::INT INTO v_avg_wait_time_seconds
  FROM public.queue_entries
  WHERE restaurant_id = p_restaurant_id
    AND joined_at >= p_start_date
    AND joined_at <= p_end_date
    AND status = 'SEATED'
    AND seated_at IS NOT NULL;

  RETURN jsonb_build_object(
    'total_joined', v_total_joined,
    'total_seated', v_total_seated,
    'total_dropped', v_total_dropped,
    'avg_wait_time_seconds', v_avg_wait_time_seconds
  );
END;
$$;

-- ============================================================================
-- 2. HOURLY QUEUE VOLUME RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_hourly_queue_volume(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hour', hour_bucket,
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

-- ============================================================================
-- 3. COMMERCE METRICS SUMMARY RPC
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_commerce_metrics_summary(
  p_restaurant_id UUID,
  p_start_date TIMESTAMPTZ,
  p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total_orders INT;
  v_total_revenue NUMERIC;
BEGIN
  -- Validate permissions
  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = p_restaurant_id AND user_id = auth.uid() AND status = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'UNAUTHORIZED';
  END IF;

  -- Total completed/served orders
  SELECT COUNT(*) INTO v_total_orders
  FROM public.orders
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status IN ('COMPLETED', 'SERVED');

  -- Total revenue from successful payments
  SELECT COALESCE(SUM(amount - refunded_amount), 0) INTO v_total_revenue
  FROM public.payments
  WHERE restaurant_id = p_restaurant_id
    AND created_at >= p_start_date
    AND created_at <= p_end_date
    AND status = 'SUCCEEDED';

  RETURN jsonb_build_object(
    'total_orders', v_total_orders,
    'total_revenue', v_total_revenue
  );
END;
$$;

-- ============================================================================
-- 4. ADD ANALYTICS PERMISSIONS TO RBAC
-- ============================================================================
INSERT INTO public.permissions (key, domain, description)
VALUES 
  ('analytics.view', 'ANALYTICS', 'View restaurant operational and commerce analytics')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role, permission_id)
SELECT 'RESTAURANT_ADMIN', id FROM public.permissions WHERE key = 'analytics.view'
ON CONFLICT (role, permission_id) DO NOTHING;
