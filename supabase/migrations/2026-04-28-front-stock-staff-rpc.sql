BEGIN;

CREATE OR REPLACE FUNCTION public.get_front_stock_snapshot_for_staff(
  p_email text,
  p_pin text
)
RETURNS TABLE (
  id uuid,
  brand_id uuid,
  item_id uuid,
  produced_code text,
  produced_name text,
  location_tag text,
  quantity numeric,
  unit text,
  reorder_level numeric,
  updated_at timestamptz,
  item_code text,
  item_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_staff public.under_brand_staff%ROWTYPE;
BEGIN
  SELECT s.*
  INTO v_staff
  FROM public.under_brand_staff s
  WHERE lower(trim(s.email)) = lower(trim(coalesce(p_email, '')))
    AND s.pin = trim(coalesce(p_pin, ''))
    AND coalesce(s.is_active, true) = true
  LIMIT 1;

  IF NOT FOUND OR v_staff.brand_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    fs.id,
    fs.brand_id,
    fs.item_id,
    fs.produced_code,
    fs.produced_name,
    fs.location_tag,
    fs.quantity,
    fs.unit,
    fs.reorder_level,
    fs.updated_at,
    si.item_code,
    si.name
  FROM public.front_stock fs
  LEFT JOIN public.stock_items si ON si.id = fs.item_id
  WHERE fs.brand_id = v_staff.brand_id
  ORDER BY fs.updated_at DESC NULLS LAST, fs.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_front_stock_snapshot_for_staff(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_front_stock_snapshot_for_staff(text, text) TO authenticated;

COMMIT;
