-- QueueFlow Phase 6 Migration: Restaurant Setup, Zones, Tables, State Machine & Tenant Constraints
-- Target Database: PostgreSQL / Supabase

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1. ZONES SCHEMA ENHANCEMENT
-- ============================================================================

ALTER TABLE public.restaurant_zones
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'INACTIVE'));

-- ============================================================================
-- 2. TABLES SCHEMA ENHANCEMENT
-- ============================================================================

-- Update table status constraint to support finite state machine: AVAILABLE, OCCUPIED, RESERVED, CLEANING, OUT_OF_SERVICE
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_status_check;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_status_check
  CHECK (status IN ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'OUT_OF_SERVICE'));

-- Add archival fields to preserve historical table references
ALTER TABLE public.restaurant_tables
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Ensure table capacity invariant (> 0 and <= 50)
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS restaurant_tables_capacity_check;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT restaurant_tables_capacity_check
  CHECK (capacity > 0 AND capacity <= 50);

-- ============================================================================
-- 3. CROSS-TENANT ZONE & TABLE INTEGRITY CONSTRAINT
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_table_zone_tenant()
RETURNS TRIGGER
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.zone_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.restaurant_zones
      WHERE id = NEW.zone_id
        AND restaurant_id = NEW.restaurant_id
        AND status = 'ACTIVE'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive zone assigned to table for this restaurant tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_table_zone_tenant ON public.restaurant_tables;
CREATE TRIGGER trg_check_table_zone_tenant
  BEFORE INSERT OR UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.check_table_zone_tenant();

-- ============================================================================
-- 4. PERFORMANCE INDEXING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_tables_restaurant_active ON public.restaurant_tables(restaurant_id, is_archived, status);
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_zone ON public.restaurant_tables(restaurant_id, zone_id);
CREATE INDEX IF NOT EXISTS idx_zones_restaurant_status ON public.restaurant_zones(restaurant_id, status);
