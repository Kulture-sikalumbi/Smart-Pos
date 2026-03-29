-- 2026-03-29-relax_guard_allow_price_updates.sql
-- Relax guard on stock_items to allow editing of price/metadata while still preventing
-- direct current_stock mutations unless explicitly allowed via pmx.allow_stock_mutation.

BEGIN;

-- Replace guard function: only prevent changes to current_stock (not cost_per_unit).
CREATE OR REPLACE FUNCTION public.guard_stock_items_mutations()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only guard direct changes to current_stock. Allow editing cost_per_unit and other fields
  -- through regular UPDATE statements.
  IF (NEW.current_stock IS DISTINCT FROM OLD.current_stock) THEN
    IF COALESCE(current_setting('pmx.allow_stock_mutation', true), '') <> '1' THEN
      RAISE EXCEPTION 'Direct stock mutations are disabled. Use GRV / POS / Production operations.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Recreate trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS trg_guard_stock_items_mutations ON public.stock_items;
CREATE TRIGGER trg_guard_stock_items_mutations
BEFORE UPDATE ON public.stock_items
FOR EACH ROW
EXECUTE FUNCTION public.guard_stock_items_mutations();

COMMIT;
