-- Include till details in shift start/get RPCs so UI and receipts can show till context.

BEGIN;

DROP FUNCTION IF EXISTS public.cashier_shift_start(text, text, numeric, text);

CREATE OR REPLACE FUNCTION public.cashier_shift_start(
  p_email text,
  p_pin text,
  p_opening_cash numeric,
  p_device_id text
)
RETURNS TABLE (
  shift_id uuid,
  brand_id uuid,
  staff_id uuid,
  till_id uuid,
  till_code text,
  till_name text,
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
  v_device text;
  v_staff public.under_brand_staff%ROWTYPE;
  v_opening numeric;
  v_existing public.cashier_shifts%ROWTYPE;
  v_existing_till public.cashier_shifts%ROWTYPE;
  v_till_id uuid;
BEGIN
  v_email := lower(trim(COALESCE(p_email, '')));
  v_pin := trim(COALESCE(p_pin, ''));
  v_device := trim(COALESCE(p_device_id, ''));
  v_opening := COALESCE(p_opening_cash, 0);

  IF v_email = '' OR v_pin = '' OR v_device = '' THEN
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

  SELECT d.till_id INTO v_till_id
  FROM public.pos_devices d
  WHERE d.brand_id = v_staff.brand_id
    AND lower(d.device_id) = lower(v_device)
  LIMIT 1;

  IF v_till_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_existing
  FROM public.cashier_shifts cs
  WHERE cs.staff_id = v_staff.id
    AND cs.closed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    shift_id := v_existing.id;
    brand_id := v_existing.brand_id;
    staff_id := v_existing.staff_id;
    till_id := v_existing.till_id;
    SELECT t.code, t.name INTO till_code, till_name FROM public.tills t WHERE t.id = v_existing.till_id LIMIT 1;
    opened_at := v_existing.opened_at;
    opening_cash := v_existing.opening_cash;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT * INTO v_existing_till
  FROM public.cashier_shifts cs
  WHERE cs.till_id = v_till_id
    AND cs.closed_at IS NULL
  LIMIT 1;

  IF FOUND THEN
    shift_id := v_existing_till.id;
    brand_id := v_existing_till.brand_id;
    staff_id := v_existing_till.staff_id;
    till_id := v_existing_till.till_id;
    SELECT t.code, t.name INTO till_code, till_name FROM public.tills t WHERE t.id = v_existing_till.till_id LIMIT 1;
    opened_at := v_existing_till.opened_at;
    opening_cash := v_existing_till.opening_cash;
    RETURN NEXT;
    RETURN;
  END IF;

  INSERT INTO public.cashier_shifts (brand_id, staff_id, till_id, opened_at, opening_cash)
  VALUES (v_staff.brand_id, v_staff.id, v_till_id, now(), round(v_opening::numeric, 2))
  RETURNING *
  INTO v_existing;

  shift_id := v_existing.id;
  brand_id := v_existing.brand_id;
  staff_id := v_existing.staff_id;
  till_id := v_existing.till_id;
  SELECT t.code, t.name INTO till_code, till_name FROM public.tills t WHERE t.id = v_existing.till_id LIMIT 1;
  opened_at := v_existing.opened_at;
  opening_cash := v_existing.opening_cash;

  UPDATE public.pos_devices d
  SET last_seen_at = now(),
      updated_at = now()
  WHERE d.brand_id = v_staff.brand_id
    AND lower(d.device_id) = lower(v_device);

  RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_start(text, text, numeric, text) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_start(text, text, numeric, text) TO authenticated;

DROP FUNCTION IF EXISTS public.cashier_shift_get(uuid);

CREATE OR REPLACE FUNCTION public.cashier_shift_get(p_shift_id uuid)
RETURNS TABLE (
  id uuid,
  brand_id uuid,
  staff_id uuid,
  till_id uuid,
  till_code text,
  till_name text,
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
  SELECT
    cs.id,
    cs.brand_id,
    cs.staff_id,
    cs.till_id,
    coalesce(t.code, ''),
    coalesce(t.name, ''),
    cs.opened_at,
    cs.opening_cash,
    cs.closed_at,
    cs.closing_cash
  FROM public.cashier_shifts cs
  LEFT JOIN public.tills t ON t.id = cs.till_id
  WHERE cs.id = p_shift_id
  LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_get(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.cashier_shift_get(uuid) TO authenticated;

COMMIT;

