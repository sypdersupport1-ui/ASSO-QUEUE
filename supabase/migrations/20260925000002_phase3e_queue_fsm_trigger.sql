-- Phase 3E: enforce the canonical queue FSM at the database layer.
--
-- Demonstrated pre-fix: any same-restaurant member could UPDATE
-- queue_entries.status directly (RLS checks tenant only), jumping to legacy
-- COMPLETED/REMOVED/SKIPPED or resurrecting terminal rows — bypassing the
-- transition/seat RPC matrix entirely.
--
-- This BEFORE UPDATE trigger fires for EVERY role (including service_role;
-- only the table owner bypasses triggers, and no app path writes as owner).
-- It validates status CHANGES only; same-value rewrites and non-status
-- updates pass through untouched. The matrix mirrors the application
-- canonical FSM plus the seat path (active -> SEATED via seating).
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.enforce_queue_entry_fsm()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  -- SEATED is reachable from every active state: the seating operation seats
  -- directly from WAITING/NOTIFIED/CALLED (table assignment happens atomically
  -- in seat_queue_entry_atomic, not via CALLED first).
  IF NOT (
    (OLD.status = 'WAITING' AND NEW.status IN ('NOTIFIED', 'CALLED', 'SEATED', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'NOTIFIED' AND NEW.status IN ('CALLED', 'SEATED', 'CANCELLED', 'EXPIRED'))
    OR (OLD.status = 'CALLED' AND NEW.status IN ('SEATED', 'NO_SHOW', 'CANCELLED', 'EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'INVALID_QUEUE_TRANSITION: % -> % not allowed', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_queue_entry_fsm ON public.queue_entries;
CREATE TRIGGER trg_enforce_queue_entry_fsm
  BEFORE UPDATE OF status ON public.queue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_queue_entry_fsm();
