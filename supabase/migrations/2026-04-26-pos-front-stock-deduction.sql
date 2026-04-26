-- 2026-04-26-pos-front-stock-deduction.sql
-- Align POS sales deduction with front_stock only.
-- 1) Optional direct menu->stock link (SALE)
-- 2) Recipe fallback deduction from MANUFACTURING

BEGIN;

ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS physical_stock_item_id uuid REFERENCES public.stock_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_brand_physical_stock_item
  ON public.products (brand_id, physical_stock_item_id);

CREATE OR REPLACE FUNCTION public.handle_stock_deductions_front_stock(
  p_brand_id uuid,
  p_location_tag text,
  p_deductions json
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  insuff_count int;
  insuff json;
  res json;
BEGIN
  WITH ded AS (
    SELECT
      COALESCE(NULLIF(trim(both from (d->>'itemId')), ''), NULLIF(trim(both from (d->>'stock_item_id')), ''))::uuid AS item_id,
      (d->>'qty')::numeric AS qty
    FROM json_array_elements(p_deductions) AS d
  ),
  aggregated AS (
    SELECT item_id, SUM(qty) AS qty
    FROM ded
    WHERE item_id IS NOT NULL AND qty IS NOT NULL AND qty > 0
    GROUP BY item_id
  ),
  locked AS (
    SELECT
      fs.item_id,
      fs.quantity AS on_hand_qty,
      a.qty AS required_qty
    FROM aggregated a
    LEFT JOIN public.front_stock fs
      ON fs.brand_id = p_brand_id
      AND fs.item_id = a.item_id
      AND fs.location_tag = p_location_tag
    FOR UPDATE OF fs
  ),
  insufficient AS (
    SELECT
      item_id,
      required_qty,
      COALESCE(on_hand_qty, 0) AS on_hand_qty
    FROM locked
    WHERE COALESCE(on_hand_qty, 0) < required_qty
  )
  SELECT
    count(*),
    json_agg(json_build_object('itemId', item_id::text, 'requiredQty', required_qty, 'onHandQty', on_hand_qty))
  INTO insuff_count, insuff
  FROM insufficient;

  IF insuff_count > 0 THEN
    RETURN json_build_object('ok', false, 'insufficient', COALESCE(insuff, '[]'::json), 'location', p_location_tag);
  END IF;

  WITH ded2 AS (
    SELECT
      COALESCE(NULLIF(trim(both from (d->>'itemId')), ''), NULLIF(trim(both from (d->>'stock_item_id')), ''))::uuid AS item_id,
      (d->>'qty')::numeric AS qty
    FROM json_array_elements(p_deductions) AS d
  ),
  aggregated2 AS (
    SELECT item_id, SUM(qty) AS qty
    FROM ded2
    WHERE item_id IS NOT NULL AND qty IS NOT NULL AND qty > 0
    GROUP BY item_id
  ),
  updated AS (
    UPDATE public.front_stock fs
    SET quantity = fs.quantity - a.qty,
        updated_at = now()
    FROM aggregated2 a
    WHERE fs.brand_id = p_brand_id
      AND fs.item_id = a.item_id
      AND fs.location_tag = p_location_tag
    RETURNING fs.item_id, fs.quantity, a.qty
  )
  SELECT json_build_object(
    'ok', true,
    'location', p_location_tag,
    'results', COALESCE(json_agg(json_build_object('itemId', item_id::text, 'after', quantity, 'deducted', qty)), '[]'::json)
  )
  INTO res
  FROM updated;

  RETURN COALESCE(res, json_build_object('ok', true, 'location', p_location_tag, 'results', '[]'::json));
END;
$$;

-- Recipe-based deduction now targets front_stock(MANUFACTURING), never stock_items.
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
  prod_code text;
  brand_id uuid;
  deductions json;
BEGIN
  SELECT p.brand_id, p.code INTO brand_id, prod_code
  FROM public.products p
  WHERE p.id = p_product_id
  LIMIT 1;

  IF brand_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'product_not_found', 'product_id', p_product_id::text);
  END IF;

  SELECT id INTO recipe_id
  FROM public.manufacturing_recipes
  WHERE product_id = p_product_id
  LIMIT 1;

  IF recipe_id IS NULL AND prod_code IS NOT NULL THEN
    SELECT id INTO recipe_id
    FROM public.manufacturing_recipes
    WHERE product_code = prod_code
    LIMIT 1;
  END IF;

  IF recipe_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_recipe_found', 'product_id', p_product_id::text);
  END IF;

  SELECT json_agg(json_build_object(
    'itemId', mri.stock_item_id::text,
    'qty', (
      mri.quantity_used::numeric * p_quantity * (
        CASE
          WHEN lower(mri.unit) IN ('g') AND lower(si.unit) IN ('kg') THEN (1::numeric / 1000::numeric)
          WHEN lower(mri.unit) IN ('kg') AND lower(si.unit) IN ('g') THEN 1000::numeric
          WHEN lower(mri.unit) IN ('ml') AND lower(si.unit) IN ('l','ltr','ltrs') THEN (1::numeric / 1000::numeric)
          WHEN lower(mri.unit) IN ('l','ltr','ltrs') AND lower(si.unit) IN ('ml') THEN 1000::numeric
          ELSE 1::numeric
        END
      )
    )
  ))
  INTO deductions
  FROM public.manufacturing_recipe_ingredients mri
  JOIN public.stock_items si ON si.id = mri.stock_item_id
  WHERE mri.manufacturing_recipe_id = recipe_id;

  IF deductions IS NULL OR deductions::jsonb = '[]'::jsonb THEN
    RETURN json_build_object('ok', false, 'error', 'no_ingredients', 'recipe_id', recipe_id::text);
  END IF;

  RETURN public.handle_stock_deductions_front_stock(brand_id, 'MANUFACTURING', deductions);
END;
$$;

-- Sales deduction dispatcher:
-- - If menu item has physical_stock_item_id => deduct from SALE
-- - Else => recipe deduction from MANUFACTURING
CREATE OR REPLACE FUNCTION public.handle_order_stock_deduction(
  p_menu_item_id uuid,
  p_qty_sold numeric
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_brand_id uuid;
  v_physical_stock_item_id uuid;
BEGIN
  SELECT p.brand_id, p.physical_stock_item_id
    INTO v_brand_id, v_physical_stock_item_id
  FROM public.products p
  WHERE p.id = p_menu_item_id
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'menu_item_not_found', 'menu_item_id', p_menu_item_id::text);
  END IF;

  IF v_physical_stock_item_id IS NOT NULL THEN
    RETURN public.handle_stock_deductions_front_stock(
      v_brand_id,
      'SALE',
      json_build_array(
        json_build_object('itemId', v_physical_stock_item_id::text, 'qty', p_qty_sold)
      )
    );
  END IF;

  RETURN public.handle_stock_deduction(p_menu_item_id, p_qty_sold);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_stock_deductions_front_stock(uuid, text, json) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_stock_deductions_front_stock(uuid, text, json) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.handle_order_stock_deduction(uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_order_stock_deduction(uuid, numeric) TO authenticated;

COMMIT;

