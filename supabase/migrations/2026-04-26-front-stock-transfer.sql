-- 2026-04-26-front-stock-transfer.sql
-- Add brand-safe front_stock schema + route Manufacturing/Sale issues into it.

BEGIN;

-- 1) Ensure front_stock is brand-scoped and stores unit.
ALTER TABLE IF EXISTS public.front_stock
  ADD COLUMN IF NOT EXISTS unit text,
  ALTER COLUMN brand_id SET NOT NULL;

-- Backfill unit for any existing rows (best-effort).
UPDATE public.front_stock fs
SET unit = si.unit
FROM public.stock_items si
WHERE si.id = fs.item_id
  AND si.brand_id = fs.brand_id
  AND fs.unit IS NULL;

ALTER TABLE IF EXISTS public.front_stock
  ALTER COLUMN unit SET NOT NULL;

ALTER TABLE IF EXISTS public.front_stock
  ADD CONSTRAINT IF NOT EXISTS front_stock_brand_id_fkey
  FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE CASCADE;

-- Make uniqueness multi-tenant safe.
ALTER TABLE IF EXISTS public.front_stock
  DROP CONSTRAINT IF EXISTS unique_item_location;

ALTER TABLE IF EXISTS public.front_stock
  ADD CONSTRAINT IF NOT EXISTS front_stock_unique_brand_item_location
  UNIQUE (brand_id, item_id, location_tag);

-- Helpful composite index for upsert/lookups.
CREATE INDEX IF NOT EXISTS idx_front_stock_brand_item_location
  ON public.front_stock (brand_id, item_id, location_tag);

-- 2) Expand stock_issues.issue_type allowed values.
ALTER TABLE IF EXISTS public.stock_issues
  DROP CONSTRAINT IF EXISTS stock_issues_issue_type_check;

ALTER TABLE IF EXISTS public.stock_issues
  ADD CONSTRAINT stock_issues_issue_type_check
  CHECK (issue_type IN ('Wastage','Expired','Staff Meal','Theft','Damage','Manufacturing','Sale'));

-- 3) Update the AFTER INSERT trigger function:
--    - Always deduct from stock_items.current_stock
--    - If issue_type is Manufacturing or Sale, also upsert into front_stock
CREATE OR REPLACE FUNCTION public.stock_issues_decrement_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_unit text;
  v_location_tag text;
BEGIN
  -- Fetch unit from stock_items (brand-scoped) and ensure the item exists.
  SELECT si.unit
  INTO v_unit
  FROM public.stock_items si
  WHERE si.id = NEW.stock_item_id
    AND si.brand_id = NEW.brand_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'stock_item % not found for brand %', NEW.stock_item_id, NEW.brand_id;
  END IF;

  -- Always decrement the referenced stock_item current_stock by qty_issued.
  UPDATE public.stock_items
  SET current_stock = current_stock - NEW.qty_issued,
      updated_at = now()
  WHERE id = NEW.stock_item_id
    AND brand_id = NEW.brand_id;

  -- Only route transfers to front_stock for Manufacturing and Sale.
  IF NEW.issue_type = 'Manufacturing' THEN
    v_location_tag := 'MANUFACTURING';
  ELSIF NEW.issue_type = 'Sale' THEN
    v_location_tag := 'SALE';
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.front_stock (brand_id, item_id, location_tag, quantity, unit, updated_at)
  VALUES (NEW.brand_id, NEW.stock_item_id, v_location_tag, NEW.qty_issued, v_unit, now())
  ON CONFLICT (brand_id, item_id, location_tag)
  DO UPDATE SET
    quantity = public.front_stock.quantity + EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    updated_at = now();

  RETURN NEW;
END;
$$;

COMMIT;

