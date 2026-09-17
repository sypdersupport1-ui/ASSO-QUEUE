-- Phase 3C: Staff invitation system
-- Adds INVITED membership state + invitation timestamps for the secure
-- staff onboarding flow (Supabase Auth invite -> accept -> ACTIVE).
--
-- Idempotent: safe to re-run. Replaces ANY existing CHECK constraint on
-- restaurant_memberships.status with the canonical three-state check, so
-- partial applies of earlier drafts cannot leave a conflicting constraint.

DO $m$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a
      ON a.attrelid = c.conrelid
     AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.restaurant_memberships'::regclass
      AND c.contype = 'c'
      AND a.attname = 'status'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.restaurant_memberships DROP CONSTRAINT %I',
      r.conname
    );
  END LOOP;

  ALTER TABLE public.restaurant_memberships
    ADD CONSTRAINT restaurant_memberships_status_check
    CHECK (status IN ('ACTIVE', 'INVITED', 'INACTIVE'));
END
$m$;

-- When the invitation email was (re-)sent. NULL for pre-3C staff.
ALTER TABLE public.restaurant_memberships
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ;

-- When the employee accepted the invitation (password set + activation).
-- NULL until INVITED -> ACTIVE via the accept-invitation flow.
ALTER TABLE public.restaurant_memberships
  ADD COLUMN IF NOT EXISTS invitation_accepted_at TIMESTAMPTZ;
