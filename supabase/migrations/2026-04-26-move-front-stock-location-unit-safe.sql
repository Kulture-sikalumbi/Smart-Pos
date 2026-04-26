-- 2026-04-26-move-front-stock-location-unit-safe.sql
-- Make move/merge math unit-safe for front_stock.

BEGIN;

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

  SELECT *
    INTO v_src
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

  -- Find matching target row by identity model.
  IF v_src.item_id IS NOT NULL THEN
    SELECT *
      INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND item_id = v_src.item_id
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  ELSIF v_src.produced_code IS NOT NULL THEN
    SELECT *
      INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND produced_code = v_src.produced_code
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  ELSIF v_src.menu_item_id IS NOT NULL THEN
    SELECT *
      INTO v_target
    FROM public.front_stock
    WHERE brand_id = v_src.brand_id
      AND menu_item_id = v_src.menu_item_id
      AND location_tag = p_target_location
      AND id <> v_src.id
    LIMIT 1
    FOR UPDATE;
  END IF;

  -- Determine canonical/base unit for stock-item rows from stock_items.unit.
  IF v_src.item_id IS NOT NULL THEN
    SELECT lower(trim(si.unit))
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
    -- Unit-safe merge: convert source qty into target/canonical unit before add.
    v_src_unit := lower(trim(coalesce(v_src.unit, '')));
    v_target_unit := lower(trim(coalesce(v_target.unit, '')));
    v_qty_to_add := coalesce(v_src.quantity, 0);

    IF v_target_unit = '' THEN
      v_target_unit := v_base_unit;
    END IF;

    -- If units differ, convert source to target where we have a known mapping.
    IF v_src_unit <> '' AND v_target_unit <> '' AND v_src_unit <> v_target_unit THEN
      IF v_src_unit = 'ml' AND v_target_unit IN ('l', 'ltr', 'ltrs') THEN
        v_qty_to_add := v_qty_to_add / 1000.0;
      ELSIF v_src_unit IN ('l', 'ltr', 'ltrs') AND v_target_unit = 'ml' THEN
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

  -- Move source row directly; normalize unit for stock-item rows to base unit when known.
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

