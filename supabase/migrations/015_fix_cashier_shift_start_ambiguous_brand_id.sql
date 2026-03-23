-- 015_fix_cashier_shift_start_ambiguous_brand_id.sql
-- Fix: cashier_shift_start "column reference brand_id is ambiguous"
-- Cause: output column variables in RETURNS TABLE can conflict with SQL column names.

BEGIN;

CREATE OR REPLACE FUNCTION public.cashier_shift_start(
  p_email text,
  p_pin text,
  p_opening_cash numeric
)
RETURNS TABLE (
  shift_id uuid,
  brand_id uuid,
  staff_id uuid,
  opened_at timestamptz,
  opening_cash numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_email text;
  v_pin text;
  v_staff public.under_brand_staff%ROWTYPE;
  v_opening numeric;
  v_existing public.cashier_shifts%ROWTYPE;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  v_pin := trim(COALESCE(p_pin, ''));
  v_opening := COALESCE(p_opening_cash, 0);

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

  IF v_staff.role <> 'cashier' THEN
    RETURN;
  END IF;

  -- If an open shift exists, return it.
  SELECT * INTO v_existing
  FROM public.cashier_shifts cs
  WHERE cs.staff_id = v_staff.id
    AND cs.closed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    shift_id := v_existing.id;
    brand_id := v_existing.brand_id;
    staff_id := v_existing.staff_id;
    opened_at := v_existing.opened_at;
    opening_cash := v_existing.opening_cash;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Insert, then copy fields from the returned record.
  INSERT INTO public.cashier_shifts (brand_id, staff_id, opened_at, opening_cash)
  VALUES (v_staff.brand_id, v_staff.id, now(), round(v_opening::numeric, 2))
  RETURNING *
  INTO v_existing;

  shift_id := v_existing.id;
  brand_id := v_existing.brand_id;
  staff_id := v_existing.staff_id;
  opened_at := v_existing.opened_at;
  opening_cash := v_existing.opening_cash;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_start(text, text, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_start(text, text, numeric) TO authenticated;

COMMIT;
