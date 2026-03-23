-- 013_cashier_shift_rpcs.sql
-- Staff POS shift operations via SECURITY DEFINER RPCs

BEGIN;

-- Start shift: validates cashier credentials (email+PIN) and creates an open shift.
-- If an open shift already exists for this cashier, returns that shift.
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

-- End shift: validates cashier credentials and closes the open shift.
CREATE OR REPLACE FUNCTION public.cashier_shift_end(
  p_email text,
  p_pin text,
  p_closing_cash numeric
)
RETURNS TABLE (
  shift_id uuid,
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
  v_closing numeric;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  v_pin := trim(COALESCE(p_pin, ''));
  v_closing := COALESCE(p_closing_cash, 0);

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

  UPDATE public.cashier_shifts cs
  SET closed_at = now(),
      closing_cash = round(v_closing::numeric, 2)
  WHERE cs.staff_id = v_staff.id
    AND cs.closed_at IS NULL
  RETURNING cs.id, cs.closed_at, cs.closing_cash
  INTO shift_id, closed_at, closing_cash;

  IF shift_id IS NULL THEN
    RETURN;
  END IF;

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_end(text, text, numeric) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_end(text, text, numeric) TO authenticated;

-- Read-only lookup by shift id (used for restoring UI state). The shift id is a UUID and hard to guess.
CREATE OR REPLACE FUNCTION public.cashier_shift_get(p_shift_id uuid)
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
BEGIN
  RETURN QUERY
  SELECT cs.id, cs.brand_id, cs.staff_id, cs.opened_at, cs.opening_cash, cs.closed_at, cs.closing_cash
  FROM public.cashier_shifts cs
  WHERE cs.id = p_shift_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_get(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_get(uuid) TO authenticated;

COMMIT;
