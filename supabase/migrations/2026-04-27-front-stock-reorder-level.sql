-- 2026-04-27-front-stock-reorder-level.sql
-- Adds a per-location reorder level to front_stock for early low-stock warnings.

BEGIN;

ALTER TABLE public.front_stock
  ADD COLUMN IF NOT EXISTS reorder_level numeric NOT NULL DEFAULT 0;

COMMIT;

