-- 2026-04-26-delete-batch-production-front-stock.sql
-- Delete a batch and reverse its stock movements in front_stock.

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_batch_production_front_stock(
  p_brand_id uuid,
  p_batch_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actual_output numeric;
  v_finished_good_code text;
  v_finished_item_id uuid;
  v_sale_on_hand numeric;
  ing record;
BEGIN
  IF p_brand_id IS NULL OR p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Missing brand_id or batch_id';
  END IF;

  SELECT actual_output, finished_good_code
    INTO v_actual_output, v_finished_good_code
  FROM public.batch_productions
  WHERE id = p_batch_id
    AND brand_id = p_brand_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Batch not found';
  END IF;

  -- Resolve finished good stock item
  IF v_finished_good_code IS NULL OR btrim(v_finished_good_code) = '' THEN
    RAISE EXCEPTION 'Cannot delete batch: missing finished_good_code on record.';
  END IF;

  SELECT id
    INTO v_finished_item_id
  FROM public.stock_items
  WHERE brand_id = p_brand_id
    AND item_code = v_finished_good_code
  LIMIT 1;

  IF v_finished_item_id IS NULL THEN
    RAISE EXCEPTION 'Cannot delete batch: finished good stock item "%" no longer exists.', v_finished_good_code;
  END IF;

  -- Lock SALE row and ensure enough to subtract
  SELECT quantity
    INTO v_sale_on_hand
  FROM public.front_stock
  WHERE brand_id = p_brand_id
    AND item_id = v_finished_item_id
    AND location_tag = 'SALE'
  FOR UPDATE;

  IF NOT FOUND THEN
    v_sale_on_hand := 0;
  END IF;

  IF COALESCE(v_actual_output, 0) > COALESCE(v_sale_on_hand, 0) + 1e-9 THEN
    RAISE EXCEPTION 'Cannot delete batch: finished goods already used. Need %, on hand %.', v_actual_output, v_sale_on_hand;
  END IF;

  -- Add ingredients back to MANUFACTURING
  FOR ing IN
    SELECT ingredient_id, required_qty
    FROM public.batch_production_ingredients
    WHERE batch_production_id = p_batch_id
  LOOP
    INSERT INTO public.front_stock (brand_id, item_id, location_tag, quantity, unit, updated_at)
    SELECT p_brand_id, ing.ingredient_id, 'MANUFACTURING', ing.required_qty, si.unit, now()
    FROM public.stock_items si
    WHERE si.id = ing.ingredient_id AND si.brand_id = p_brand_id
    ON CONFLICT (brand_id, item_id, location_tag)
    DO UPDATE SET
      quantity = public.front_stock.quantity + EXCLUDED.quantity,
      updated_at = now();
  END LOOP;

  -- Subtract finished goods from SALE
  UPDATE public.front_stock
  SET quantity = quantity - COALESCE(v_actual_output, 0),
      updated_at = now()
  WHERE brand_id = p_brand_id
    AND item_id = v_finished_item_id
    AND location_tag = 'SALE';

  -- Finally delete the batch (ingredients cascade)
  DELETE FROM public.batch_productions
  WHERE id = p_batch_id
    AND brand_id = p_brand_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_batch_production_front_stock(uuid, uuid) TO authenticated;

COMMIT;

