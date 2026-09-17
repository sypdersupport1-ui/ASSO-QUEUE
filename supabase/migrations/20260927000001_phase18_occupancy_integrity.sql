-- ============================================================================
-- QUEUEFLOW PHASE 18: SEATING OCCUPANCY INTEGRITY CORRECTION
-- 1. Fix free_seats default behavior (remove static DEFAULT 2).
-- 2. Add BEFORE INSERT OR UPDATE trigger to guarantee free_seats = capacity - occupied_seats.
-- 3. Add CHECK constraints to enforce occupancy bounds and invariants.
-- ============================================================================

-- 1. Remove confusing static DEFAULT 2 on free_seats
ALTER TABLE public.restaurant_tables
  ALTER COLUMN free_seats SET DEFAULT 0;

ALTER TABLE public.restaurant_tables
  ALTER COLUMN occupied_seats SET DEFAULT 0;

-- 2. Trigger to keep free_seats synchronized with capacity - occupied_seats
CREATE OR REPLACE FUNCTION public.sync_restaurant_table_seats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If table is set to AVAILABLE or CLEANING, occupied_seats must be 0
  IF NEW.status IN ('AVAILABLE', 'CLEANING') AND (TG_OP = 'INSERT' OR OLD.status != NEW.status OR NEW.occupied_seats = OLD.occupied_seats) THEN
    NEW.occupied_seats := 0;
  END IF;

  IF NEW.occupied_seats IS NULL THEN
    NEW.occupied_seats := 0;
  END IF;

  -- Guarantee free_seats is strictly capacity - occupied_seats
  NEW.free_seats := NEW.capacity - NEW.occupied_seats;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_restaurant_table_seats ON public.restaurant_tables;
CREATE TRIGGER trg_sync_restaurant_table_seats
BEFORE INSERT OR UPDATE ON public.restaurant_tables
FOR EACH ROW
EXECUTE FUNCTION public.sync_restaurant_table_seats();

-- 3. Enforce constraints
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_occupancy_bounds;
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_free_seats_bounds;
ALTER TABLE public.restaurant_tables
  DROP CONSTRAINT IF EXISTS chk_table_free_seats_invariant;

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_occupancy_bounds
  CHECK (occupied_seats >= 0 AND occupied_seats <= capacity);

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_free_seats_bounds
  CHECK (free_seats >= 0 AND free_seats <= capacity);

ALTER TABLE public.restaurant_tables
  ADD CONSTRAINT chk_table_free_seats_invariant
  CHECK (free_seats = capacity - occupied_seats);
