-- 2026-04-26-normalize-front-stock-units.sql
-- Keep front_stock units aligned with "highest unit" convention.

BEGIN;

-- 1) Backfill existing front_stock units for stock-item rows to normalized highest/base unit.
UPDATE public.front_stock fs
SET unit = CASE
  WHEN lower(trim(coalesce(si.unit, ''))) IN ('g', 'gram', 'grams') THEN 'kg'
  WHEN lower(trim(coalesce(si.unit, ''))) IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') THEN 'l'
  WHEN lower(trim(coalesce(si.unit, ''))) IN ('ltr', 'ltrs') THEN 'l'
  ELSE lower(trim(coalesce(si.unit, fs.unit)))
END
FROM public.stock_items si
WHERE fs.item_id = si.id
  AND fs.brand_id = si.brand_id;

-- 2) Ensure stock issue transfer trigger writes normalized unit labels to front_stock.
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

-- 3) Keep move RPC canonical unit in highest/base form for stock-item rows.
CREATE OR REPLACE FUNCTION public.move_front_stock_location(
  p_source_row_id uuid,
  p_target_location text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_src public.front_stock%ROWTYPE;
  v_target public.front_stock%ROWTYPE;
  v_target_row_id uuid;
  v_qty_to_add numeric;
  v_src_unit text;
  v_target_unit text;
  v_base_unit text;
BEGIN
  IF p_source_row_id IS NULL THEN
    RAISE EXCEPTION 'Missing source_row_id';
  END IF;
  IF p_target_location IS NULL OR btrim(p_target_location) = '' THEN
    RAISE EXCEPTION 'Missing target_location';
  END IF;

  SELECT * INTO v_src
  FROM public.front_stock
  WHERE id = p_source_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source row not found';
  END IF;

  IF v_src.location_tag = p_target_location THEN
    RETURN v_src.id;
  END IF;

  IF p_target_location = 'MANUFACTURING'
     AND v_src.item_id IS NULL
     AND v_src.produced_code IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot move produced-only row to MANUFACTURING without item_id mapping.';
  END IF;

  IF v_src.item_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND item_id = v_src.item_id
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  ELSIF v_src.produced_code IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND produced_code = v_src.produced_code
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  ELSIF v_src.menu_item_id IS NOT NULL THEN
    SELECT * INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND menu_item_id = v_src.menu_item_id
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_src.item_id IS NOT NULL THEN
    SELECT CASE
             WHEN lower(trim(coalesce(si.unit, ''))) IN ('g', 'gram', 'grams') THEN 'kg'
             WHEN lower(trim(coalesce(si.unit, ''))) IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres') THEN 'l'
             WHEN lower(trim(coalesce(si.unit, ''))) IN ('ltr', 'ltrs') THEN 'l'
             ELSE lower(trim(coalesce(si.unit, '')))
           END
      INTO v_base_unit
    FROM public.stock_items si
    WHERE si.id = v_src.item_id
      AND si.brand_id = v_src.brand_id
    LIMIT 1;
  END IF;
  IF v_base_unit IS NULL OR v_base_unit = '' THEN
    v_base_unit := lower(trim(coalesce(v_src.unit, '')));
  END IF;

  IF FOUND THEN
    v_src_unit := lower(trim(coalesce(v_src.unit, '')));
    v_target_unit := lower(trim(coalesce(v_target.unit, '')));
    v_qty_to_add := coalesce(v_src.quantity, 0);

    IF v_target_unit = '' THEN v_target_unit := v_base_unit; END IF;

    IF v_src_unit <> '' AND v_target_unit <> '' AND v_src_unit <> v_target_unit THEN
      IF v_src_unit = 'ml' AND v_target_unit = 'l' THEN
        v_qty_to_add := v_qty_to_add / 1000.0;
      ELSIF v_src_unit = 'l' AND v_target_unit = 'ml' THEN
        v_qty_to_add := v_qty_to_add * 1000.0;
      ELSIF v_src_unit = 'g' AND v_target_unit = 'kg' THEN
        v_qty_to_add := v_qty_to_add / 1000.0;
      ELSIF v_src_unit = 'kg' AND v_target_unit = 'g' THEN
        v_qty_to_add := v_qty_to_add * 1000.0;
      END IF;
    END IF;

    UPDATE public.front_stock
    SET quantity = COALESCE(quantity, 0) + COALESCE(v_qty_to_add, 0),
        unit = COALESCE(NULLIF(v_target_unit, ''), unit),
        updated_at = now()
    WHERE id = v_target.id
    RETURNING id INTO v_target_row_id;

    DELETE FROM public.front_stock WHERE id = v_src.id;
    RETURN v_target_row_id;
  END IF;

  UPDATE public.front_stock
  SET location_tag = p_target_location,
      unit = CASE
        WHEN v_src.item_id IS NOT NULL AND v_base_unit IS NOT NULL AND v_base_unit <> '' THEN v_base_unit
        ELSE unit
      END,
      produced_code = CASE WHEN p_target_location = 'MANUFACTURING' THEN NULL ELSE produced_code END,
      produced_name = CASE WHEN p_target_location = 'MANUFACTURING' THEN NULL ELSE produced_name END,
      updated_at = now()
  WHERE id = v_src.id
  RETURNING id INTO v_target_row_id;

  RETURN v_target_row_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_front_stock_location(uuid, text) TO authenticated;

COMMIT;

