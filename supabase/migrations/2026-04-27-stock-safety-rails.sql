-- 2026-04-27-stock-safety-rails.sql
-- Enforce non-negative stock and whole-number "each" quantities at DB level.

BEGIN;

ALTER TABLE IF EXISTS public.stock_items
  ADD CONSTRAINT stock_items_non_negative_current_stock
  CHECK (current_stock >= 0) NOT VALID;

ALTER TABLE IF EXISTS public.front_stock
  ADD CONSTRAINT front_stock_non_negative_quantity
  CHECK (quantity >= 0) NOT VALID;

ALTER TABLE IF EXISTS public.front_stock
  ADD CONSTRAINT front_stock_each_whole_number_qty
  CHECK (
    lower(coalesce(unit, '')) <> 'each'
    OR quantity = trunc(quantity)
  ) NOT VALID;

ALTER TABLE IF EXISTS public.stock_issues
  ADD CONSTRAINT stock_issues_positive_qty
  CHECK (qty_issued > 0) NOT VALID;

COMMIT;

