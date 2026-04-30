BEGIN;

-- Align cashier "today receipts" with a rolling 24-hour retention window.
-- This avoids midnight cutoffs where recent receipts disappear even though
-- they are still within the intended one-day access period.
CREATE OR REPLACE FUNCTION public.get_staff_today_receipts(
  p_email text,
  p_pin text,
  p_limit integer DEFAULT 300
)
RETURNS TABLE (
  id uuid,
  order_id text,
  shift_id uuid,
  till_id uuid,
  till_code text,
  till_name text,
  staff_id text,
  staff_name text,
  order_no bigint,
  payment_method text,
  subtotal numeric,
  discount_amount numeric,
  tax numeric,
  total numeric,
  currency_code text,
  issued_at timestamptz,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_staff public.under_brand_staff%ROWTYPE;
  v_email text;
  v_pin text;
  v_limit integer;
  v_can_view_all boolean := false;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_pin := trim(coalesce(p_pin, ''));
  v_limit := greatest(1, least(coalesce(p_limit, 300), 800));

  IF v_email = '' OR v_pin = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_staff
  FROM public.under_brand_staff s
  WHERE lower(s.email) = v_email
    AND s.pin = v_pin
    AND s.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_can_view_all := v_staff.role IN ('owner', 'admin', 'manager', 'front_supervisor');

  RETURN QUERY
  SELECT
    r.id,
    r.order_id,
    r.shift_id,
    r.till_id,
    t.code AS till_code,
    t.name AS till_name,
    r.staff_id,
    r.staff_name,
    r.order_no,
    r.payment_method,
    r.subtotal,
    r.discount_amount,
    r.tax,
    r.total,
    r.currency_code,
    r.issued_at,
    r.payload
  FROM public.pos_receipts_today r
  LEFT JOIN public.tills t ON t.id = r.till_id
  WHERE r.brand_id = v_staff.brand_id
    AND r.issued_at >= now() - interval '24 hours'
    AND (v_can_view_all OR coalesce(r.staff_id, '') = coalesce(v_staff.id::text, ''))
  ORDER BY r.issued_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_today_receipts(text, text, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_staff_today_receipts(text, text, integer) TO authenticated;

COMMIT;

