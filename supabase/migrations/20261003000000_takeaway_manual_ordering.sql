-- ============================================================================
-- Migration: 20261003000000_takeaway_manual_ordering.sql
-- Description: Adds takeaway_manual_ordering_enabled column to restaurants table.
-- Supports: Takeaway manual / counter ordering without requiring digital menu setup.
-- Workflow: Customer comes -> In Queue -> Called to Counter -> Place Order -> Items Received
-- ============================================================================

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS takeaway_manual_ordering_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.restaurants.takeaway_manual_ordering_enabled IS
  'Enables manual takeaway flow where customers queue, order at the counter verbally/manually, and receive items without requiring digital menu configuration.';
