BEGIN;

CREATE OR REPLACE FUNCTION public.issue_tablet_enrollment_token(
  p_brand_id uuid,
  p_ttl_seconds integer DEFAULT 180,
  p_table_no integer DEFAULT NULL
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
    issued_for_table_no,
    expires_at
  ) VALUES (
    p_brand_id,
    v_token_hash,
    auth.uid(),
    CASE WHEN p_table_no IS NOT NULL AND p_table_no > 0 THEN p_table_no ELSE NULL END,
    v_expires_at
  );

  RETURN jsonb_build_object(
    'ok', true,
    'token', v_token,
    'expires_at', v_expires_at,
    'setup_url', '/?tabletEnrollToken=' || v_token
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
  v_issued_table_no integer;
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
  RETURNING t.id, t.brand_id, t.expires_at, t.issued_for_table_no
  INTO v_token_id, v_brand_id, v_expires_at, v_issued_table_no;

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
    'issued_table_no', v_issued_table_no,
    'expires_at', least(v_expires_at, now() + make_interval(secs => 900))
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_tablet_enrollment_token(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tablet_enrollment_token(text, text) TO anon, authenticated;

COMMIT;
