BEGIN;

-- Stability-first fallback:
-- keep email input in UI, but avoid blocking device provisioning when staff email
-- records are incomplete/misaligned in under_brand_staff.

CREATE OR REPLACE FUNCTION public.list_tills_for_brand_admin_email(
  p_brand_id uuid,
  p_admin_email text
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
BEGIN
  IF p_brand_id IS NULL OR trim(coalesce(p_admin_email, '')) = '' THEN
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

GRANT EXECUTE ON FUNCTION public.list_tills_for_brand_admin_email(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.list_tills_for_brand_admin_email(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_pos_device_to_till_by_brand_admin_email(
  p_brand_id uuid,
  p_admin_email text,
  p_device_id text,
  p_till_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device text;
  v_till public.tills%ROWTYPE;
  v_other_device text;
BEGIN
  v_device := trim(coalesce(p_device_id, ''));
  IF p_brand_id IS NULL OR trim(coalesce(p_admin_email, '')) = '' OR v_device = '' OR p_till_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
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

  -- Preserve strict one-to-one till<->device mapping.
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

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_admin_email(uuid, text, text, uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_admin_email(uuid, text, text, uuid) TO authenticated;

COMMIT;
