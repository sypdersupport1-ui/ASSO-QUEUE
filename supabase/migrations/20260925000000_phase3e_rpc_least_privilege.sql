-- Phase 3E: least-privilege EXECUTE grants on SECURITY DEFINER RPCs.
--
-- Demonstrated pre-fix: any authenticated caller could seat / transition /
-- close ANY restaurant's queue rows (actor id trusted verbatim, NULL actor
-- skipped checks), any authenticated caller could mass-expire CALLED rows,
-- and ANONYMOUS callers could drain inventory and claim + read all tenants'
-- outbox payloads.
--
-- Fix: these functions are only ever invoked by trusted server code through
-- the service-role client (verified: all app call sites use createAdminClient;
-- pg_cron jobs run as the database owner, which bypasses grants). Restrict
-- EXECUTE to service_role. Authenticated/anon callers get "permission denied".
-- Idempotent: safe to re-run.

-- Queue mutations (app authorizes via AuthorizationService before calling).
REVOKE ALL ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seat_queue_entry_atomic(UUID, UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.transition_queue_entry_atomic(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_queue_entry_atomic(UUID, TEXT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.set_queue_operating_state(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_queue_operating_state(UUID, TEXT, UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.expire_overdue_called_queue_entries(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_overdue_called_queue_entries(INT) TO service_role;

-- Outbox worker primitives (service-role worker only).
REVOKE ALL ON FUNCTION public.claim_outbox_events(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_outbox_events(INT) TO service_role;

REVOKE ALL ON FUNCTION public.recover_stale_outbox_events(INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recover_stale_outbox_events(INT) TO service_role;

-- Inventory ledger (server-only callers; anon-accessible stock drain closed).
REVOKE ALL ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.deduct_inventory_atomic(UUID, UUID, NUMERIC, TEXT, UUID, TEXT, UUID) TO service_role;

-- Helper oracles: revoke anonymous enumeration (middleware + app use
-- authenticated sessions; service paths use service_role).
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.has_permission(UUID, UUID, TEXT) FROM anon;

-- Intentionally UNCHANGED (public by design):
--   join_queue_atomic (anonymous QR join; validated server-side in-function)
--   get_recent_5am_cutoff (pure timezone math, no state)
--   recommend_tables_for_queue_entry (read-only; action layer now passes actor)
--   metrics RPCs (validate tenant via auth.uid() internally)
