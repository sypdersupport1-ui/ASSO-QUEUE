-- Migration: Add missing no_show columns to queue_entries
ALTER TABLE public.queue_entries 
  ADD COLUMN IF NOT EXISTS no_show_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS no_show_reason TEXT;
