-- Enforce strict one-to-one mapping between tills and devices per brand.
-- One device -> one till (already enforced by brand_id+device_id unique index)
-- One till   -> one device (enforced below by brand_id+till_id unique index)

BEGIN;

-- Keep only the newest mapping if a till is linked to multiple devices.
WITH ranked AS (
  SELECT
    d.id,
    row_number() OVER (
      PARTITION BY d.brand_id, d.till_id
      ORDER BY d.updated_at DESC NULLS LAST, d.created_at DESC NULLS LAST, d.id DESC
    ) AS rn
  FROM public.pos_devices d
  WHERE d.till_id IS NOT NULL
)
DELETE FROM public.pos_devices d
USING ranked r
WHERE d.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pos_devices_brand_till
  ON public.pos_devices (brand_id, till_id);

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
  v_email text;
  v_secret text;
  v_device text;
  v_brand_id uuid;
  v_role text;
  v_auth_uid uuid;
  v_jwt_email text;
  v_till public.tills%ROWTYPE;
  v_other_device text;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_secret := trim(coalesce(p_pin, ''));
  v_device := trim(coalesce(p_device_id, ''));
  IF v_email = '' OR v_secret = '' OR v_device = '' OR p_till_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  -- Path A: under_brand_staff PIN.
  SELECT s.brand_id, s.role
  INTO v_brand_id, v_role
  FROM public.under_brand_staff s
  WHERE lower(s.email) = v_email
    AND s.pin = v_secret
    AND s.is_active = true
  LIMIT 1;

  -- Path B: signed-in owner/admin via Supabase Auth (email + password).
  IF v_brand_id IS NULL THEN
    v_auth_uid := auth.uid();
    v_jwt_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    IF v_auth_uid IS NOT NULL AND v_jwt_email = v_email THEN
      SELECT b.id, 'owner'::text
      INTO v_brand_id, v_role
      FROM public.brands b
      WHERE b.owner_id = v_auth_uid
      LIMIT 1;
    END IF;
  END IF;

  IF v_brand_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credentials');
  END IF;

  IF v_role NOT IN ('owner', 'admin', 'manager', 'front_supervisor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT * INTO v_till
  FROM public.tills t
  WHERE t.id = p_till_id
    AND t.brand_id = v_brand_id
    AND t.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'till_not_found');
  END IF;

  -- Strict one-to-one: block if this till is already linked to another device.
  SELECT d.device_id INTO v_other_device
  FROM public.pos_devices d
  WHERE d.brand_id = v_brand_id
    AND d.till_id = v_till.id
    AND lower(d.device_id) <> lower(v_device)
  LIMIT 1;

  IF v_other_device IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'till_number/name_already_assigned_to_another_device',
      'assigned_device_id', v_other_device
    );
  END IF;

  UPDATE public.pos_devices d
  SET till_id = v_till.id,
      last_seen_at = now(),
      updated_at = now()
  WHERE d.brand_id = v_brand_id
    AND lower(d.device_id) = lower(v_device);

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.pos_devices (brand_id, device_id, till_id, last_seen_at)
      VALUES (v_brand_id, v_device, v_till.id, now());
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'error', 'till_already_assigned');
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'brand_id', v_brand_id, 'device_id', v_device, 'till_id', v_till.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till(text, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till(text, text, text, uuid) TO authenticated;

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
  v_other_device text;
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

  -- Strict one-to-one: block if this till is already linked to another device.
  SELECT d.device_id INTO v_other_device
  FROM public.pos_devices d
  WHERE d.brand_id = p_brand_id
    AND d.till_id = v_till.id
    AND lower(d.device_id) <> lower(v_device)
  LIMIT 1;

  IF v_other_device IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'till_already_assigned',
      'assigned_device_id', v_other_device
    );
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
        RETURN jsonb_build_object('ok', false, 'error', 'till_already_assigned');
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id, 'device_id', v_device, 'till_id', v_till.id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_supervisor_pin(uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_supervisor_pin(uuid, text, text, uuid) TO authenticated;

COMMIT;
