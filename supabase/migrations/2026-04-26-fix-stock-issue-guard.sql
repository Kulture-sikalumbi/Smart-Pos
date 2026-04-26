-- 2026-04-26-fix-stock-issue-guard.sql
-- Restore stock issue trigger compatibility with stock mutation guard.

BEGIN;

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
  -- Fetch and normalize source unit from stock_items (brand-scoped).
  SELECT CASE
           WHEN lower(trim(coalesce(si.unit, ''))) IN ('g', 'gram', 'grams') THEN 'kg'
           WHEN lower(trim(coalesce(si.unit, ''))) IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') THEN 'l'
           WHEN lower(trim(coalesce(si.unit, ''))) IN ('ltr', 'ltrs') THEN 'l'
           ELSE lower(trim(coalesce(si.unit, 'each')))
         END
    INTO v_unit
  FROM public.stock_items si
  WHERE si.id = NEW.stock_item_id
    AND si.brand_id = NEW.brand_id;

  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'stock_item % not found for brand %', NEW.stock_item_id, NEW.brand_id;
  END IF;

  -- Required by guard trigger on stock_items.
  PERFORM set_config('pmx.allow_stock_mutation', '1', true);

  UPDATE public.stock_items
  SET current_stock = current_stock - NEW.qty_issued,
      updated_at = now()
  WHERE id = NEW.stock_item_id
    AND brand_id = NEW.brand_id;

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

