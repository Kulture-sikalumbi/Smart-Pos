-- 020_grv_create_rpc.sql
-- Transactional GRV creation RPC: inserts grv and grv_items together.

BEGIN;

CREATE OR REPLACE FUNCTION public.grv_create(
  p_brand_id uuid,
  p_date date,
  p_supplier_id uuid,
  p_supplier_name text,
  p_payment_type text,
  p_received_by text,
  p_items jsonb
)
RETURNS TABLE (grv_id uuid, grv_no text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_grv_id uuid;
  v_grv_no text;
  v_items jsonb;
BEGIN
  v_items := COALESCE(p_items, '[]'::jsonb);

  INSERT INTO public.grvs (brand_id, date, supplier_id, supplier_name, payment_type, received_by, subtotal, tax, total, status, created_at, updated_at)
  VALUES (p_brand_id, p_date, NULLIF(p_supplier_id::text, '')::uuid, p_supplier_name, p_payment_type, p_received_by, 0, 0, 0, 'pending', now(), now())
  RETURNING id, public.grvs.grv_no INTO v_grv_id, v_grv_no;

  -- Insert items if provided
  IF jsonb_array_length(v_items) > 0 THEN
    INSERT INTO public.grv_items (grv_id, stock_item_id, item_code, item_name, quantity, unit_cost, total_cost)
    SELECT
      v_grv_id,
      (elem->>'itemId')::uuid,
      elem->>'itemCode',
      elem->>'itemName',
      (elem->>'quantity')::numeric,
      (elem->>'unitCost')::numeric,
      COALESCE((elem->>'totalCost')::numeric, ((elem->>'quantity')::numeric * (elem->>'unitCost')::numeric))
    FROM jsonb_array_elements(v_items) AS arr(elem);
  END IF;

  -- Compute totals from inserted items for better accuracy
  UPDATE public.grvs g
  SET subtotal = COALESCE( (
      SELECT round(SUM(COALESCE(gi.total_cost, gi.quantity * gi.unit_cost))::numeric, 2) FROM public.grv_items gi WHERE gi.grv_id = v_grv_id
    ), 0),
    tax = 0,
    total = COALESCE( (
      SELECT round(SUM(COALESCE(gi.total_cost, gi.quantity * gi.unit_cost))::numeric, 2) FROM public.grv_items gi WHERE gi.grv_id = v_grv_id
    ), 0),
    updated_at = now()
  WHERE id = v_grv_id;

  grv_id := v_grv_id;
  grv_no := v_grv_no;
  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grv_create(uuid, date, uuid, text, text, text, jsonb) TO authenticated;

COMMIT;
