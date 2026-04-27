-- 2026-04-27-fix-front-stock-deduction-locking.sql
-- Fix: "FOR UPDATE cannot be applied to the nullable side of an outer join"
-- in handle_stock_deductions_front_stock.

BEGIN;

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
  existing_locked AS (
    SELECT
      fs.item_id,
      fs.quantity AS on_hand_qty
    FROM public.front_stock fs
    JOIN aggregated a
      ON a.item_id = fs.item_id
    WHERE fs.brand_id = p_brand_id
      AND fs.location_tag = p_location_tag
    FOR UPDATE
  ),
  insufficient AS (
    SELECT
      a.item_id,
      a.qty AS required_qty,
      COALESCE(el.on_hand_qty, 0) AS on_hand_qty
    FROM aggregated a
    LEFT JOIN existing_locked el
      ON el.item_id = a.item_id
    WHERE COALESCE(el.on_hand_qty, 0) < a.qty
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

GRANT EXECUTE ON FUNCTION public.handle_stock_deductions_front_stock(uuid, text, json) TO anon;
GRANT EXECUTE ON FUNCTION public.handle_stock_deductions_front_stock(uuid, text, json) TO authenticated;

COMMIT;

