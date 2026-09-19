-- ============================================================================
-- Migration: 20261004000000_customer_theme_key.sql
-- Description: Adds customer_theme_key column to public.restaurants table.
-- Purpose: Phase 2 Customer Theme Engine Architecture.
-- Invariant: Defaults to 'default' so all existing restaurants seamlessly
-- resolve to the Phase 1 QueueFlow Premium visual language.
-- ============================================================================

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS customer_theme_key TEXT NOT NULL DEFAULT 'default';

COMMENT ON COLUMN public.restaurants.customer_theme_key IS
  'Active customer-facing theme identifier for the restaurant (e.g., default). Resolved against canonical theme registry.';
