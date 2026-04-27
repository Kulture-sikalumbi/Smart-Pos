-- 2026-04-27-finalize-front-stock-deduction-and-batch.sql
-- Finalize deduction + batch RPC behavior to be resilient with mixed legacy data.

BEGIN;

-- 1) Recipe deduction: robust recipe lookup + ingredient fetch for mixed historical rows.
CREATE OR REPLACE FUNCTION public.handle_stock_deduction(
  p_product_id uuid,
  p_quantity numeric DEFAULT 1
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  recipe_id uuid;
  v_prod_code text;
  v_brand_id uuid;
  deductions json;
BEGIN
  SELECT p.brand_id, p.code
    INTO v_brand_id, v_prod_code
  FROM public.products p
  WHERE p.id = p_product_id
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'product_not_found', 'product_id', p_product_id::text);
  END IF;

  -- Prefer strict brand-scoped lookup.
  SELECT mr.id
    INTO recipe_id
  FROM public.manufacturing_recipes mr
  WHERE mr.product_id = p_product_id
    AND mr.brand_id = v_brand_id
  LIMIT 1;

  IF recipe_id IS NULL AND v_prod_code IS NOT NULL AND btrim(v_prod_code) <> '' THEN
    SELECT mr.id
      INTO recipe_id
    FROM public.manufacturing_recipes mr
    WHERE mr.product_code = v_prod_code
      AND mr.brand_id = v_brand_id
    LIMIT 1;
  END IF;

  -- Legacy fallback for rows where manufacturing_recipes.brand_id may be NULL.
  IF recipe_id IS NULL THEN
    SELECT mr.id
      INTO recipe_id
    FROM public.manufacturing_recipes mr
    WHERE mr.product_id = p_product_id
    LIMIT 1;
  END IF;

  IF recipe_id IS NULL AND v_prod_code IS NOT NULL AND btrim(v_prod_code) <> '' THEN
    SELECT mr.id
      INTO recipe_id
    FROM public.manufacturing_recipes mr
    WHERE mr.product_code = v_prod_code
    LIMIT 1;
  END IF;

  IF recipe_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_recipe_found', 'product_id', p_product_id::text);
  END IF;

  -- quantity_used values are already normalized by the current recipe editor/store.
  -- Accept legacy ingredient rows where brand_id is NULL.
  SELECT json_agg(
    json_build_object(
      'itemId', mri.stock_item_id::text,
      'qty', (mri.quantity_used::numeric * COALESCE(p_quantity, 0))
    )
  )
  INTO deductions
  FROM public.manufacturing_recipe_ingredients mri
  WHERE mri.manufacturing_recipe_id = recipe_id
    AND (mri.brand_id = v_brand_id OR mri.brand_id IS NULL);

  IF deductions IS NULL OR deductions::jsonb = '[]'::jsonb THEN
    RETURN json_build_object('ok', false, 'error', 'no_ingredients', 'recipe_id', recipe_id::text);
  END IF;

  RETURN public.handle_stock_deductions_front_stock(v_brand_id, 'MANUFACTURING', deductions);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO authenticated;

-- 2) Batch production: force front_stock-only behavior with produced_code upsert in SALE.
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
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Missing brand id';
  END IF;

  IF p_actual_output IS NULL OR p_actual_output <= 0 THEN
    RAISE EXCEPTION 'Actual output must be greater than 0';
  END IF;

  IF p_finished_good_code IS NULL OR btrim(p_finished_good_code) = '' THEN
    RAISE EXCEPTION 'Missing finished good code. Please provide a produced code.';
  END IF;

  IF p_recipe_name IS NULL OR btrim(p_recipe_name) = '' THEN
    RAISE EXCEPTION 'Missing recipe name for finished good.';
  END IF;

  IF p_ingredients IS NULL OR jsonb_typeof(p_ingredients) <> 'array' THEN
    p_ingredients := '[]'::jsonb;
  END IF;

  -- Lock/validate MANUFACTURING ingredient availability.
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

  INSERT INTO public.front_stock (
    brand_id,
    produced_code,
    produced_name,
    location_tag,
    quantity,
    unit,
    updated_at
  )
  VALUES (
    p_brand_id,
    p_finished_good_code,
    p_recipe_name,
    'SALE',
    p_actual_output,
    'EACH',
    now()
  )
  ON CONFLICT (brand_id, produced_code, location_tag)
  DO UPDATE SET
    quantity = public.front_stock.quantity + EXCLUDED.quantity,
    produced_name = COALESCE(NULLIF(EXCLUDED.produced_name, ''), public.front_stock.produced_name),
    unit = EXCLUDED.unit,
    updated_at = now();

  RETURN v_batch_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_batch_production_front_stock(
  uuid, text, text, date, numeric, numeric, numeric, numeric, numeric, numeric, text, text, jsonb
) TO authenticated;

COMMIT;

