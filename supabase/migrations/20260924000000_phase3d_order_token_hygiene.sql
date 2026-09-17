-- Phase 3D: order bearer-token hygiene.
--
-- Raw order tokens must never persist server-side (only SHA-256 hashes in
-- orders.order_token_hash). Purge any raw tokens written by earlier builds.
-- The orders.order_token column is intentionally KEPT (nullable) for
-- backward compatibility, but application code must always write NULL.
-- Idempotent: safe to re-run.

UPDATE public.orders SET order_token = NULL WHERE order_token IS NOT NULL;
