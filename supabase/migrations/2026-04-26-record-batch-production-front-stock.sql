-- 2026-04-26-record-batch-production-front-stock.sql
-- Manufacturing must consume from front_stock(MANUFACTURING) and produce into front_stock(SALE).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Store finished good code to support reversals/audit
ALTER TABLE IF EXISTS public.batch_productions
  ADD COLUMN IF NOT EXISTS finished_good_code text;

CREATE OR REPLACE FUNCTION public.record_batch_production_front_stock(
  p_brand_id uuid,
  p_recipe_id text,
  p_recipe_name text,
  p_batch_date date,
  p_theoretical_output numeric,
  p_actual_output numeric,
  p_yield_variance numeric,
  p_yield_variance_percent numeric,
  p_total_cost numeric,
  p_unit_cost numeric,
  p_produced_by text,
  p_finished_good_code text,
  p_ingredients jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_batch_id uuid;
  ln jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_on_hand numeric;
  v_finished_item_id uuid;
  v_finished_unit text;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Missing brand id';
  END IF;

  IF p_actual_output IS NULL OR p_actual_output <= 0 THEN
    RAISE EXCEPTION 'Actual output must be greater than 0';
  END IF;

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' THEN
    p_ingredients := '[]'::jsonb;
  END IF;

  -- 1) Lock and validate ingredient availability in MANUFACTURING front stock
  FOR ln IN SELECT * FROM jsonb_array_elements(p_ingredients) LOOP
    v_item_id := (ln ->> 'ingredient_id')::uuid;
    v_qty := (ln ->> 'required_qty')::numeric;

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Missing ingredient_id in ingredients payload';
    END IF;
    IF v_qty IS NULL OR v_qty < 0 THEN
      RAISE EXCEPTION 'Invalid required_qty for ingredient %', v_item_id;
    END IF;
    IF v_qty = 0 THEN
      CONTINUE;
    END IF;

    SELECT quantity
      INTO v_on_hand
    FROM public.front_stock
    WHERE brand_id = p_brand_id
      AND item_id = v_item_id
      AND location_tag = 'MANUFACTURING'
    FOR UPDATE;

    IF NOT FOUND THEN
      v_on_hand := 0;
    END IF;

    IF COALESCE(v_on_hand, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient MANUFACTURING stock for ingredient %. On hand: %, Required: %. Issue stock from Main Store to Manufacturing first.', v_item_id, v_on_hand, v_qty;
    END IF;
  END LOOP;

  -- 2) Insert batch record
  INSERT INTO public.batch_productions (
    brand_id,
    recipe_id,
    recipe_name,
    batch_date,
    finished_good_code,
    theoretical_output,
    actual_output,
    yield_variance,
    yield_variance_percent,
    total_cost,
    unit_cost,
    produced_by
  ) VALUES (
    p_brand_id,
    p_recipe_id,
    p_recipe_name,
    p_batch_date,
    p_finished_good_code,
    COALESCE(p_theoretical_output, 0),
    COALESCE(p_actual_output, 0),
    COALESCE(p_yield_variance, 0),
    COALESCE(p_yield_variance_percent, 0),
    COALESCE(p_total_cost, 0),
    COALESCE(p_unit_cost, 0),
    COALESCE(NULLIF(p_produced_by, ''), auth.uid()::text)
  )
  RETURNING id INTO v_batch_id;

  -- 3) Deduct ingredients and insert ingredient rows
  FOR ln IN SELECT * FROM jsonb_array_elements(p_ingredients) LOOP
    v_item_id := (ln ->> 'ingredient_id')::uuid;
    v_qty := (ln ->> 'required_qty')::numeric;
    IF v_item_id IS NULL OR v_qty IS NULL OR v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE public.front_stock
    SET quantity = quantity - v_qty,
        updated_at = now()
    WHERE brand_id = p_brand_id
      AND item_id = v_item_id
      AND location_tag = 'MANUFACTURING';

    INSERT INTO public.batch_production_ingredients (
      batch_production_id,
      ingredient_id,
      ingredient_code,
      ingredient_name,
      required_qty,
      unit_type,
      unit_cost
    ) VALUES (
      v_batch_id,
      v_item_id,
      ln ->> 'ingredient_code',
      ln ->> 'ingredient_name',
      v_qty,
      COALESCE(NULLIF(ln ->> 'unit_type', ''), 'EACH'),
      COALESCE((ln ->> 'unit_cost')::numeric, 0)
    );
  END LOOP;

  -- 4) Route finished goods into SALE front stock
  IF p_finished_good_code IS NULL OR btrim(p_finished_good_code) = '' THEN
    RAISE EXCEPTION 'Missing finished good code. Ensure the recipe is linked to a menu item code.';
  END IF;

  SELECT id, unit
    INTO v_finished_item_id, v_finished_unit
  FROM public.stock_items
  WHERE brand_id = p_brand_id
    AND (item_code = p_finished_good_code OR name = p_finished_good_code)
  LIMIT 1;

  IF v_finished_item_id IS NULL THEN
    RAISE EXCEPTION 'Finished good not found in Stock Items for code "%". Create it in Stock Items first so it can be stocked in SALE.', p_finished_good_code;
  END IF;

  INSERT INTO public.front_stock (brand_id, item_id, location_tag, quantity, unit, updated_at)
  VALUES (p_brand_id, v_finished_item_id, 'SALE', p_actual_output, v_finished_unit, now())
  ON CONFLICT (brand_id, item_id, location_tag)
  DO UPDATE SET
    quantity = public.front_stock.quantity + EXCLUDED.quantity,
    unit = EXCLUDED.unit,
    updated_at = now();

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_batch_production_front_stock(
  uuid, text, text, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb
) TO authenticated;

COMMIT;

