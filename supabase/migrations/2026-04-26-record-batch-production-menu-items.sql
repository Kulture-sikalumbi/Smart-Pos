-- 2026-04-26-record-batch-production-menu-items.sql
-- Refactor finished-goods routing in batch RPC:
-- - lookup finished good in public.menu_items (by code)
-- - upsert into front_stock using menu_item_id (SALE)

BEGIN;

-- front_stock now supports either stock item movements (item_id) or menu item stock (menu_item_id).
ALTER TABLE IF EXISTS public.front_stock
  ADD COLUMN IF NOT EXISTS menu_item_id uuid NULL;

-- If item_id was previously mandatory, relax it so SALE rows can use menu_item_id.
ALTER TABLE IF EXISTS public.front_stock
  ALTER COLUMN item_id DROP NOT NULL;

-- Best-effort FK (if table exists and id is uuid).
DO $$
BEGIN
  BEGIN
    ALTER TABLE public.front_stock
      ADD CONSTRAINT front_stock_menu_item_id_fkey
      FOREIGN KEY (menu_item_id) REFERENCES public.menu_items(id) ON DELETE CASCADE;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END
$$;

-- Keep old uniqueness for item_id rows and add uniqueness for menu_item_id SALE rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_front_stock_unique_brand_menu_location
  ON public.front_stock (brand_id, menu_item_id, location_tag)
  WHERE menu_item_id IS NOT NULL;

-- Replace the RPC with menu-item lookup and menu_item_id upsert for finished goods.
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
  v_finished_menu_item_id uuid;
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

  -- 1) Lock and validate ingredient availability in MANUFACTURING front stock (item_id path)
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

  -- 3) Deduct ingredients and persist ingredient lines
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

  -- 4) Route finished goods into SALE via menu_item_id
  IF p_finished_good_code IS NULL OR btrim(p_finished_good_code) = '' THEN
    RAISE EXCEPTION 'Menu Item not found. Please ensure this recipe is linked to a valid Menu Item first.';
  END IF;

  SELECT mi.id
    INTO v_finished_menu_item_id
  FROM public.menu_items mi
  WHERE mi.brand_id = p_brand_id
    AND mi.code = p_finished_good_code
  LIMIT 1;

  IF v_finished_menu_item_id IS NULL THEN
    RAISE EXCEPTION 'Menu Item not found. Please ensure this recipe is linked to a valid Menu Item first.';
  END IF;

  INSERT INTO public.front_stock (brand_id, menu_item_id, location_tag, quantity, unit, updated_at)
  VALUES (p_brand_id, v_finished_menu_item_id, 'SALE', p_actual_output, 'EACH', now())
  ON CONFLICT (brand_id, menu_item_id, location_tag)
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

