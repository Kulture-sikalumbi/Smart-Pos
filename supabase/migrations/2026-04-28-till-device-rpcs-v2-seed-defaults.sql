-- Seed default Till 1-3 on first supervisor/admin till lookup.
-- Keeps setup friction low for new brands/devices.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_tills_for_staff(
  p_email text,
  p_pin text
)
RETURNS TABLE (
  id uuid,
  code text,
  name text,
  is_active boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_staff public.under_brand_staff%ROWTYPE;
  v_email text;
  v_pin text;
  v_count integer := 0;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_pin := trim(coalesce(p_pin, ''));
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

  -- Only allow supervisory roles to view/configure tills.
  IF v_staff.role NOT IN ('owner', 'admin', 'manager', 'front_supervisor') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.tills t
  WHERE t.brand_id = v_staff.brand_id;

  IF coalesce(v_count, 0) = 0 THEN
    INSERT INTO public.tills (brand_id, code, name, is_active)
    VALUES
      (v_staff.brand_id, '1', 'Till 1', true),
      (v_staff.brand_id, '2', 'Till 2', true),
      (v_staff.brand_id, '3', 'Till 3', true)
    ON CONFLICT (brand_id, lower(code)) DO NOTHING;
  END IF;

  RETURN QUERY
  SELECT t.id, t.code, t.name, t.is_active
  FROM public.tills t
  WHERE t.brand_id = v_staff.brand_id
    AND t.is_active = true
  ORDER BY lower(t.code), lower(t.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tills_for_staff(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.list_tills_for_staff(text, text) TO authenticated;

COMMIT;

