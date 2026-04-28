-- Fix assign_pos_device_to_till upsert to avoid ON CONFLICT inference failures
-- on databases missing the functional unique index on (brand_id, lower(device_id)).

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_pos_device_to_till(
  p_email text,
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
  v_staff public.under_brand_staff%ROWTYPE;
  v_email text;
  v_pin text;
  v_device text;
  v_till public.tills%ROWTYPE;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_pin := trim(coalesce(p_pin, ''));
  v_device := trim(coalesce(p_device_id, ''));
  IF v_email = '' OR v_pin = '' OR v_device = '' OR p_till_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  SELECT * INTO v_staff
  FROM public.under_brand_staff s
  WHERE lower(s.email) = v_email
    AND s.pin = v_pin
    AND s.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_staff.role NOT IN ('owner', 'admin', 'manager', 'front_supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT * INTO v_till
  FROM public.tills t
  WHERE t.id = p_till_id
    AND t.brand_id = v_staff.brand_id
    AND t.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'till_not_found');
  END IF;

  UPDATE public.pos_devices d
  SET till_id = v_till.id,
      last_seen_at = now(),
      updated_at = now()
  WHERE d.brand_id = v_staff.brand_id
    AND lower(d.device_id) = lower(v_device);

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.pos_devices (brand_id, device_id, till_id, last_seen_at)
      VALUES (v_staff.brand_id, v_device, v_till.id, now());
    EXCEPTION
      WHEN unique_violation THEN
        UPDATE public.pos_devices d
        SET till_id = v_till.id,
            last_seen_at = now(),
            updated_at = now()
        WHERE d.brand_id = v_staff.brand_id
          AND lower(d.device_id) = lower(v_device);
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'brand_id', v_staff.brand_id, 'device_id', v_device, 'till_id', v_till.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till(text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till(text, text, text, uuid) TO authenticated;

COMMIT;
