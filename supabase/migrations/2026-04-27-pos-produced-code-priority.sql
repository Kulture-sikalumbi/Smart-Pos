-- 2026-04-27-pos-produced-code-priority.sql
-- Prevent double-deduction for batch-produced ready-to-sell items.
-- Deduction priority:
-- 1) physical_stock_item_id -> SALE by item_id
-- 2) products.code matches front_stock.produced_code in SALE -> deduct SALE produced stock
-- 3) fallback to recipe deduction (MANUFACTURING ingredients)

BEGIN;

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
  v_menu_code text;
  v_sale_qty numeric;
BEGIN
  SELECT p.brand_id, p.physical_stock_item_id, p.code
    INTO v_brand_id, v_physical_stock_item_id, v_menu_code
  FROM public.products p
  WHERE p.id = p_menu_item_id
  LIMIT 1;

  IF v_brand_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'menu_item_not_found', 'menu_item_id', p_menu_item_id::text);
  END IF;

  -- 1) Explicit direct stock link
  IF v_physical_stock_item_id IS NOT NULL THEN
    RETURN public.handle_stock_deductions_front_stock(
      v_brand_id,
      'SALE',
      json_build_array(
        json_build_object('itemId', v_physical_stock_item_id::text, 'qty', p_qty_sold)
      )
    );
  END IF;

  -- 2) Produced-code SALE stock (batch outputs) has priority over recipe path.
  IF v_menu_code IS NOT NULL AND btrim(v_menu_code) <> '' THEN
    SELECT fs.quantity
      INTO v_sale_qty
    FROM public.front_stock fs
    WHERE fs.brand_id = v_brand_id
      AND fs.location_tag = 'SALE'
      AND fs.produced_code = v_menu_code
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      IF COALESCE(v_sale_qty, 0) < COALESCE(p_qty_sold, 0) THEN
        RETURN json_build_object(
          'ok', false,
          'insufficient', json_build_array(
            json_build_object('itemId', v_menu_code, 'requiredQty', p_qty_sold, 'onHandQty', COALESCE(v_sale_qty, 0))
          ),
          'location', 'SALE',
          'path', 'produced_code'
        );
      END IF;

      UPDATE public.front_stock
      SET quantity = quantity - COALESCE(p_qty_sold, 0),
          updated_at = now()
      WHERE brand_id = v_brand_id
        AND location_tag = 'SALE'
        AND produced_code = v_menu_code;

      RETURN json_build_object('ok', true, 'path', 'produced_code', 'location', 'SALE');
    END IF;
  END IF;

  -- 3) fallback recipe path
  RETURN public.handle_stock_deduction(p_menu_item_id, p_qty_sold);
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_order_stock_deduction(uuid, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_order_stock_deduction(uuid, numeric) TO authenticated;

COMMIT;

