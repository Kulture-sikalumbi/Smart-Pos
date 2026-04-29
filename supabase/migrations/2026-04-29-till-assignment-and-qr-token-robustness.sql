BEGIN;

-- 1) New till listing RPC with assignment visibility.
CREATE OR REPLACE FUNCTION public.list_tills_with_assignment_for_brand_admin_email(
  p_brand_id uuid,
  p_admin_email text
)
RETURNS TABLE (
  id uuid,
  code text,
  name text,
  is_active boolean,
  assigned_device_id text,
  assigned_at timestamptz
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
  SELECT
    t.id,
    t.code,
    t.name,
    t.is_active,
    d.device_id AS assigned_device_id,
    d.updated_at AS assigned_at
  FROM public.tills t
  LEFT JOIN public.pos_devices d
    ON d.brand_id = t.brand_id
   AND d.till_id = t.id
  WHERE t.brand_id = p_brand_id
    AND t.is_active = true
  ORDER BY lower(t.code), lower(t.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tills_with_assignment_for_brand_admin_email(uuid, text) TO anon;
GRANT EXECUTE ON FUNCTION public.list_tills_with_assignment_for_brand_admin_email(uuid, text) TO authenticated;

-- 2) New assignment RPC with explicit replace support.
CREATE OR REPLACE FUNCTION public.assign_pos_device_to_till_by_brand_admin_email_v2(
  p_brand_id uuid,
  p_admin_email text,
  p_device_id text,
  p_till_id uuid,
  p_replace_existing boolean DEFAULT false
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

  SELECT d.device_id INTO v_other_device
  FROM public.pos_devices d
  WHERE d.brand_id = p_brand_id
    AND d.till_id = v_till.id
    AND lower(d.device_id) <> lower(v_device)
  LIMIT 1;

  IF v_other_device IS NOT NULL AND coalesce(p_replace_existing, false) = false THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'till_already_assigned',
      'assigned_device_id', v_other_device
    );
  END IF;

  IF v_other_device IS NOT NULL AND coalesce(p_replace_existing, false) = true THEN
    DELETE FROM public.pos_devices d
    WHERE d.brand_id = p_brand_id
      AND d.till_id = v_till.id
      AND lower(d.device_id) <> lower(v_device);
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

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'device_id', v_device,
    'till_id', v_till.id,
    'replaced_device_id', nullif(v_other_device, '')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_admin_email_v2(uuid, text, text, uuid, boolean) TO anon;
GRANT EXECUTE ON FUNCTION public.assign_pos_device_to_till_by_brand_admin_email_v2(uuid, text, text, uuid, boolean) TO authenticated;

-- 3) QR token fix: remove dependency on gen_random_bytes() and digest().
CREATE OR REPLACE FUNCTION public.issue_tablet_enrollment_token(
  p_brand_id uuid,
  p_ttl_seconds integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_ttl_seconds integer;
  v_token text;
  v_token_hash text;
  v_expires_at timestamptz;
BEGIN
  IF p_brand_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_brand');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.owner_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  v_ttl_seconds := greatest(30, least(coalesce(p_ttl_seconds, 180), 900));
  v_token := md5(random()::text || clock_timestamp()::text || coalesce(auth.uid()::text, 'anon'))
             || md5(clock_timestamp()::text || random()::text);
  v_token_hash := md5(v_token || ':tablet_enroll');
  v_expires_at := now() + make_interval(secs => v_ttl_seconds);

  INSERT INTO public.tablet_enrollment_tokens (
    brand_id,
    token_hash,
    issued_by,
    expires_at
  ) VALUES (
    p_brand_id,
    v_token_hash,
    auth.uid(),
    v_expires_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires_at,
    'setup_url', '/tablet-enroll?token=' || v_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_tablet_enrollment_token(
  p_token text,
  p_device_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_token text;
  v_device text;
  v_token_hash text;
  v_session_token text;
  v_session_hash text;
  v_brand_id uuid;
  v_brand_name text;
  v_token_id uuid;
  v_expires_at timestamptz;
BEGIN
  v_token := trim(coalesce(p_token, ''));
  v_device := trim(coalesce(p_device_id, ''));

  IF v_token = '' OR v_device = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  v_token_hash := md5(v_token || ':tablet_enroll');

  UPDATE public.tablet_enrollment_tokens t
  SET used_at = now(),
      used_by_device_id = v_device
  WHERE t.token_hash = v_token_hash
    AND t.used_at IS NULL
    AND t.expires_at > now()
  RETURNING t.id, t.brand_id, t.expires_at
  INTO v_token_id, v_brand_id, v_expires_at;

  IF v_token_id IS NULL OR v_brand_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_invalid_or_expired');
  END IF;

  SELECT coalesce(nullif(trim(b.name), ''), 'Brand')
  INTO v_brand_name
  FROM public.brands b
  WHERE b.id = v_brand_id;

  v_session_token := md5(random()::text || clock_timestamp()::text || v_device)
                     || md5(clock_timestamp()::text || random()::text);
  v_session_hash := md5(v_session_token || ':tablet_session');

  INSERT INTO public.tablet_enrollment_sessions (
    brand_id,
    session_hash,
    device_id,
    source_token_id,
    expires_at
  ) VALUES (
    v_brand_id,
    v_session_hash,
    v_device,
    v_token_id,
    least(v_expires_at, now() + make_interval(secs => 900))
  );

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', v_brand_id,
    'brand_name', v_brand_name,
    'session_token', v_session_token,
    'expires_at', least(v_expires_at, now() + make_interval(secs => 900))
  );
END;
$$;

COMMIT;
