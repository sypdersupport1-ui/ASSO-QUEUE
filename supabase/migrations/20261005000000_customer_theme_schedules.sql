-- ============================================================================
-- Migration: 20261005000000_customer_theme_schedules.sql
-- Description: Adds canonical restaurant_customer_theme_schedules table with
--              GiST exclusion constraint to prevent overlapping active intervals,
--              half-open [start_at, end_at) semantics, timezone support, and RLS.
-- Purpose: Phase 5 Customer Theme Scheduling Engine.
-- Invariant: Zero festival-specific tables. Database stores theme identity only.
--            Presentation configuration only — zero effect on queue/order lifecycles.
-- ============================================================================

-- 1. Enable btree_gist extension for scalar + range GiST exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 2. Canonical Theme Schedule Table
CREATE TABLE IF NOT EXISTS public.restaurant_customer_theme_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  theme_key TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CANCELLED')),
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Positive duration constraint: end_at must strictly follow start_at
  CONSTRAINT valid_theme_schedule_interval CHECK (end_at > start_at),

  -- Overlap prevention: atomically prevent overlapping active schedules for the same restaurant
  -- Half-open interval semantics: [start_at, end_at)
  CONSTRAINT no_overlapping_active_theme_schedules EXCLUDE USING gist (
    restaurant_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  ) WHERE (status = 'ACTIVE')
);

-- 3. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_theme_schedules_restaurant_active
  ON public.restaurant_customer_theme_schedules (restaurant_id, status, start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_theme_schedules_restaurant_lookup
  ON public.restaurant_customer_theme_schedules (restaurant_id, created_at DESC);

-- 4. Row-Level Security (RLS)
ALTER TABLE public.restaurant_customer_theme_schedules ENABLE ROW LEVEL SECURITY;

-- Clean up any prior policy
DROP POLICY IF EXISTS "Tenant isolation for restaurant_customer_theme_schedules" ON public.restaurant_customer_theme_schedules;

-- 4a. SELECT Policy: Restaurant Admins and Staff can view schedules for assigned restaurants
DROP POLICY IF EXISTS "Allow viewing theme schedules for authorized restaurant members" ON public.restaurant_customer_theme_schedules;
CREATE POLICY "Allow viewing theme schedules for authorized restaurant members"
  ON public.restaurant_customer_theme_schedules
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    restaurant_id IN (SELECT public.get_user_restaurant_ids(auth.uid()))
  );

-- 4b. INSERT Policy: Only Restaurant Admins and Super Admins can create schedules
DROP POLICY IF EXISTS "Allow inserting theme schedules for restaurant admins" ON public.restaurant_customer_theme_schedules;
CREATE POLICY "Allow inserting theme schedules for restaurant admins"
  ON public.restaurant_customer_theme_schedules
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    public.has_restaurant_role(auth.uid(), restaurant_id, ARRAY['RESTAURANT_ADMIN'])
  );

-- 4c. UPDATE Policy: Only Restaurant Admins and Super Admins can modify schedules
DROP POLICY IF EXISTS "Allow updating theme schedules for restaurant admins" ON public.restaurant_customer_theme_schedules;
CREATE POLICY "Allow updating theme schedules for restaurant admins"
  ON public.restaurant_customer_theme_schedules
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    public.has_restaurant_role(auth.uid(), restaurant_id, ARRAY['RESTAURANT_ADMIN'])
  )
  WITH CHECK (
    public.is_super_admin(auth.uid()) OR
    public.has_restaurant_role(auth.uid(), restaurant_id, ARRAY['RESTAURANT_ADMIN'])
  );

-- 4d. DELETE Policy: Only Restaurant Admins and Super Admins can delete schedules
DROP POLICY IF EXISTS "Allow deleting theme schedules for restaurant admins" ON public.restaurant_customer_theme_schedules;
CREATE POLICY "Allow deleting theme schedules for restaurant admins"
  ON public.restaurant_customer_theme_schedules
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin(auth.uid()) OR
    public.has_restaurant_role(auth.uid(), restaurant_id, ARRAY['RESTAURANT_ADMIN'])
  );

-- 5. Documentation Comments
COMMENT ON TABLE public.restaurant_customer_theme_schedules IS
  'Phase 5: Canonical scheduling table for temporary customer theme overrides.';

COMMENT ON COLUMN public.restaurant_customer_theme_schedules.theme_key IS
  'Approved theme identifier resolved against canonical THEME_REGISTRY.';

COMMENT ON COLUMN public.restaurant_customer_theme_schedules.start_at IS
  'Inclusive UTC start timestamp [start_at.';

COMMENT ON COLUMN public.restaurant_customer_theme_schedules.end_at IS
  'Exclusive UTC end timestamp end_at).';

COMMENT ON COLUMN public.restaurant_customer_theme_schedules.timezone IS
  'Authoritative restaurant IANA timezone recorded when schedule was created.';

COMMENT ON COLUMN public.restaurant_customer_theme_schedules.status IS
  'Schedule lifecycle status: ACTIVE or CANCELLED.';
