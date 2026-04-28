-- PIN-only supervisor/admin verification for till setup.
-- This avoids session switching by not using account password login.

BEGIN;

CREATE OR REPLACE FUNCTION public.list_tills_for_brand_supervisor_pin(
  p_brand_id uuid,
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
  v_pin text;
  v_role text;
BEGIN
  v_pin := trim(coalesce(p_pin, ''));
  IF p_brand_id IS NULL OR v_pin = '' THEN
    RETURN;
  END IF;

  SELECT s.role INTO v_role
  FROM public.under_brand_staff s
  WHERE s.brand_id = p_brand_id
    AND s.pin = v_pin
    AND s.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN;
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'manager', 'front_supervisor') THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT t.id, t.code, t.name, t.is_active
  FROM public.tills t
  WHERE t.brand_id = p_brand_id
    AND t.is_active = true
  ORDER BY lower(t.code), lower(t.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tills_for_brand_supervisor_pin(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.list_tills_for_brand_supervisor_pin(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_pos_device_to_till_by_brand_supervisor_pin(
  p_brand_id uuid,
  p_pin text,
  p_device_id text,
  p_till_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_pin text;
  v_device text;
  v_role text;
  v_till public.tills%ROWTYPE;
BEGIN
  v_pin := trim(coalesce(p_pin, ''));
  v_device := trim(coalesce(p_device_id, ''));
  IF p_brand_id IS NULL OR v_pin = '' OR v_device = '' OR p_till_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  SELECT s.role INTO v_role
  FROM public.under_brand_staff s
  WHERE s.brand_id = p_brand_id
    AND s.pin = v_pin
    AND s.is_active = true
  LIMIT 1;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'manager', 'front_supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT * INTO v_till
  FROM public.tills t
  WHERE t.id = p_till_id
    AND t.brand_id = p_brand_id
    AND t.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'till_not_found');
  END IF;

  UPDATE public.pos_devices d
  SET till_id = v_till.id,
      last_seen_at = now(),
      updated_at = now()
  WHERE d.brand_id = p_brand_id
    AND lower(d.device_id) = lower(v_device);

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.pos_devices (brand_id, device_id, till_id, last_seen_at)
      VALUES (p_brand_id, v_device, v_till.id, now());
    EXCEPTION
      WHEN unique_violation THEN
        UPDATE public.pos_devices d
        SET till_id = v_till.id,
            last_seen_at = now(),
            updated_at = now()
        WHERE d.brand_id = p_brand_id
          AND lower(d.device_id) = lower(v_device);
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id, 'device_id', v_device, 'till_id', v_till.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_supervisor_pin(uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_supervisor_pin(uuid, text, text, uuid) TO authenticated;

COMMIT;
