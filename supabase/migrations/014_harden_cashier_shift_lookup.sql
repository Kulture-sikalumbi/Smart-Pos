-- 014_harden_cashier_shift_lookup.sql
-- Remove shift lookup-by-id for anon (leaks cash amounts if UUID is copied).
-- Replace with a cashier-credentialed lookup of the currently open shift.

BEGIN;

-- Remove insecure function if present
DROP FUNCTION IF EXISTS public.cashier_shift_get(uuid);

-- Return the currently open shift for the provided cashier credentials.
CREATE OR REPLACE FUNCTION public.cashier_shift_get_open(
  p_email text,
  p_pin text
)
RETURNS TABLE (
  id uuid,
  brand_id uuid,
  staff_id uuid,
  opened_at timestamptz,
  opening_cash numeric,
  closed_at timestamptz,
  closing_cash numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_email text;
  v_pin text;
  v_staff public.under_brand_staff%ROWTYPE;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  v_pin := trim(COALESCE(p_pin, ''));

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

  RETURN QUERY
  SELECT cs.id, cs.brand_id, cs.staff_id, cs.opened_at, cs.opening_cash, cs.closed_at, cs.closing_cash
  FROM public.cashier_shifts cs
  WHERE cs.staff_id = v_staff.id
  ORDER BY cs.opened_at DESC
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_get_open(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_get_open(text, text) TO authenticated;

COMMIT;
