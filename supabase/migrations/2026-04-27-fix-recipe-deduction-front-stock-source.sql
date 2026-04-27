-- 2026-04-27-fix-recipe-deduction-front-stock-source.sql
-- Fix false low-stock on POS recipe deductions.
-- - Use manufacturing_recipe_ingredients as source-of-truth quantities (already normalized)
-- - Remove stock_items-based conversion from deduction math
-- - Ensure recipe lookup is brand-scoped

BEGIN;

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
  SELECT p.brand_id, p.code
    INTO brand_id, prod_code
  FROM public.products p
  WHERE p.id = p_product_id
  LIMIT 1;

  IF brand_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'product_not_found', 'product_id', p_product_id::text);
  END IF;

  -- Prefer explicit product link, always within brand.
  SELECT mr.id
    INTO recipe_id
  FROM public.manufacturing_recipes mr
  WHERE mr.brand_id = brand_id
    AND mr.product_id = p_product_id
  LIMIT 1;

  -- Fallback by product_code, still brand-scoped.
  IF recipe_id IS NULL AND prod_code IS NOT NULL AND btrim(prod_code) <> '' THEN
    SELECT mr.id
      INTO recipe_id
    FROM public.manufacturing_recipes mr
    WHERE mr.brand_id = brand_id
      AND mr.product_code = prod_code
    LIMIT 1;
  END IF;

  IF recipe_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_recipe_found', 'product_id', p_product_id::text);
  END IF;

  -- Important: quantity_used is already normalized to base units by the recipe UI/store.
  -- Do not re-convert using stock_items.unit; that can over-scale and trigger false insufficiency.
  SELECT json_agg(
    json_build_object(
      'itemId', mri.stock_item_id::text,
      'qty', (mri.quantity_used::numeric * COALESCE(p_quantity, 0))
    )
  )
  INTO deductions
  FROM public.manufacturing_recipe_ingredients mri
  WHERE mri.manufacturing_recipe_id = recipe_id
    AND mri.brand_id = brand_id;

  IF deductions IS NULL OR deductions::jsonb = '[]'::jsonb THEN
    RETURN json_build_object('ok', false, 'error', 'no_ingredients', 'recipe_id', recipe_id::text);
  END IF;

  RETURN public.handle_stock_deductions_front_stock(brand_id, 'MANUFACTURING', deductions);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_stock_deduction(uuid, numeric) TO authenticated;

COMMIT;

