-- 2026-04-26-move-front-stock-location.sql
-- Move or merge front_stock quantity between locations.

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
BEGIN
  IF p_source_row_id IS NULL THEN
    RAISE EXCEPTION 'Missing source_row_id';
  END IF;
  IF p_target_location IS NULL OR btrim(p_target_location) = '' THEN
    RAISE EXCEPTION 'Missing target_location';
  END IF;

  -- Lock source row.
  SELECT *
    INTO v_src
  FROM public.front_stock
  WHERE id = p_source_row_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source row not found';
  END IF;

  -- No-op if same location.
  IF v_src.location_tag = p_target_location THEN
    RETURN v_src.id;
  END IF;

  -- If moving a produced-good row to MANUFACTURING, we need an item_id so it can become raw stock.
  IF p_target_location = 'MANUFACTURING'
     AND v_src.item_id IS NULL
     AND v_src.produced_code IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot move produced-only row to MANUFACTURING without item_id mapping.';
  END IF;

  -- Find target row by identity model: item_id first, then produced_code, then menu_item_id.
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

  IF FOUND THEN
    -- Merge into existing target, then delete source.
    UPDATE public.front_stock
    SET quantity = COALESCE(quantity, 0) + COALESCE(v_src.quantity, 0),
        updated_at = now()
    WHERE id = v_target.id
    RETURNING id INTO v_target_row_id;

    DELETE FROM public.front_stock WHERE id = v_src.id;
    RETURN v_target_row_id;
  END IF;

  -- Move source row directly.
  UPDATE public.front_stock
  SET location_tag = p_target_location,
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

