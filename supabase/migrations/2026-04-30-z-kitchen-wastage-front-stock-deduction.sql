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
  v_front_qty numeric;
BEGIN
  -- Kitchen MANUFACTURING wastage should decrement front_stock directly,
  -- not back-office stock_items.
  IF upper(coalesce(NEW.source_module, '')) = 'KITCHEN'
     AND upper(coalesce(NEW.location_scope, '')) = 'MANUFACTURING'
     AND NEW.issue_type = 'Wastage'
  THEN
    SELECT fs.quantity
      INTO v_front_qty
    FROM public.front_stock fs
    WHERE fs.brand_id = NEW.brand_id
      AND fs.item_id = NEW.stock_item_id
      AND upper(coalesce(fs.location_tag, '')) = 'MANUFACTURING'
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'front_stock row not found for item % in MANUFACTURING', NEW.stock_item_id;
    END IF;

    IF coalesce(v_front_qty, 0) < NEW.qty_issued THEN
      RAISE EXCEPTION 'Insufficient MANUFACTURING front stock. Current: %, Requested: %', v_front_qty, NEW.qty_issued;
    END IF;

    UPDATE public.front_stock
    SET quantity = quantity - NEW.qty_issued,
        updated_at = now()
    WHERE brand_id = NEW.brand_id
      AND item_id = NEW.stock_item_id
      AND upper(coalesce(location_tag, '')) = 'MANUFACTURING';

    RETURN NEW;
  END IF;

  -- Existing default behavior for non-kitchen issue sources.
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

