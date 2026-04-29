-- Secure QR enrollment for customer tablets.
-- Flow:
-- 1) Manager issues short-lived one-time enrollment token.
-- 2) Tablet consumes token and receives short-lived enrollment session.
-- 3) Tablet lists table assignment status and assigns/replaces table mapping.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tablet_enrollment_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  issued_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issued_for_table_no integer NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  used_by_device_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tablet_enrollment_tokens_token_hash_nonempty CHECK (length(trim(token_hash)) > 0),
  CONSTRAINT tablet_enrollment_tokens_used_device_nonempty CHECK (
    used_by_device_id IS NULL OR length(trim(used_by_device_id)) > 0
  ),
  CONSTRAINT tablet_enrollment_tokens_table_positive CHECK (
    issued_for_table_no IS NULL OR issued_for_table_no > 0
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tablet_enrollment_tokens_token_hash
  ON public.tablet_enrollment_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_tablet_enrollment_tokens_brand_expires
  ON public.tablet_enrollment_tokens (brand_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.tablet_enrollment_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  device_id text NOT NULL,
  source_token_id uuid NOT NULL REFERENCES public.tablet_enrollment_tokens(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tablet_enrollment_sessions_hash_nonempty CHECK (length(trim(session_hash)) > 0),
  CONSTRAINT tablet_enrollment_sessions_device_nonempty CHECK (length(trim(device_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tablet_enrollment_sessions_hash
  ON public.tablet_enrollment_sessions (session_hash);

CREATE INDEX IF NOT EXISTS idx_tablet_enrollment_sessions_brand_expires
  ON public.tablet_enrollment_sessions (brand_id, expires_at DESC);

ALTER TABLE IF EXISTS public.tablet_enrollment_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.tablet_enrollment_sessions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tablet_enrollment_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tablet_enrollment_sessions TO authenticated;
GRANT SELECT ON public.tablet_enrollment_tokens TO anon;
GRANT SELECT ON public.tablet_enrollment_sessions TO anon;

DROP POLICY IF EXISTS "tablet_enrollment_tokens_select_brand_owner" ON public.tablet_enrollment_tokens;
CREATE POLICY "tablet_enrollment_tokens_select_brand_owner"
  ON public.tablet_enrollment_tokens
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tablet_enrollment_tokens_insert_brand_owner" ON public.tablet_enrollment_tokens;
CREATE POLICY "tablet_enrollment_tokens_insert_brand_owner"
  ON public.tablet_enrollment_tokens
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tablet_enrollment_tokens_update_brand_owner" ON public.tablet_enrollment_tokens;
CREATE POLICY "tablet_enrollment_tokens_update_brand_owner"
  ON public.tablet_enrollment_tokens
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "tablet_enrollment_sessions_select_brand_owner" ON public.tablet_enrollment_sessions;
CREATE POLICY "tablet_enrollment_sessions_select_brand_owner"
  ON public.tablet_enrollment_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

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

CREATE OR REPLACE FUNCTION public.list_brand_tablet_assignment_status(
  p_session_token text
)
RETURNS TABLE (
  table_id uuid,
  table_no integer,
  table_name text,
  seats integer,
  is_active boolean,
  is_assigned boolean,
  assigned_device_id text,
  assigned_name text,
  assigned_at timestamptz,
  last_seen_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session text;
  v_session_hash text;
  v_brand_id uuid;
BEGIN
  v_session := trim(coalesce(p_session_token, ''));
  IF v_session = '' THEN
    RETURN;
  END IF;

  v_session_hash := encode(digest(v_session, 'sha256'), 'hex');

  SELECT s.brand_id
  INTO v_brand_id
  FROM public.tablet_enrollment_sessions s
  WHERE s.session_hash = v_session_hash
    AND s.expires_at > now();

  IF v_brand_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    rt.id AS table_id,
    rt.table_no,
    rt.name AS table_name,
    rt.seats,
    rt.is_active,
    (ctd.id IS NOT NULL) AS is_assigned,
    ctd.device_id AS assigned_device_id,
    ctd.name AS assigned_name,
    ctd.assigned_at,
    ctd.last_seen_at
  FROM public.restaurant_tables rt
  LEFT JOIN public.customer_tablet_devices ctd
    ON ctd.brand_id = rt.brand_id
   AND ctd.table_no = rt.table_no
   AND ctd.is_active = true
  WHERE rt.brand_id = v_brand_id
    AND rt.is_active = true
  ORDER BY rt.table_no ASC;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_customer_tablet_device(
  p_brand_id uuid,
  p_table_no integer,
  p_new_device_id text,
  p_name text DEFAULT NULL,
  p_is_locked boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device text;
  v_name text;
  v_previous_device_id text;
BEGIN
  v_device := trim(coalesce(p_new_device_id, ''));
  v_name := nullif(trim(coalesce(p_name, '')), '');

  IF p_brand_id IS NULL OR p_table_no IS NULL OR p_table_no <= 0 OR v_device = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.owner_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  SELECT d.device_id
  INTO v_previous_device_id
  FROM public.customer_tablet_devices d
  WHERE d.brand_id = p_brand_id
    AND d.table_no = p_table_no
    AND d.is_active = true
  LIMIT 1;

  DELETE FROM public.customer_tablet_devices d
  WHERE d.brand_id = p_brand_id
    AND d.table_no = p_table_no
    AND lower(d.device_id) <> lower(v_device);

  INSERT INTO public.customer_tablet_devices (
    brand_id,
    device_id,
    table_no,
    name,
    is_locked,
    is_active,
    assigned_at,
    last_seen_at
  )
  VALUES (
    p_brand_id,
    v_device,
    p_table_no,
    v_name,
    coalesce(p_is_locked, true),
    true,
    now(),
    now()
  )
  ON CONFLICT (brand_id, table_no) DO UPDATE
    SET device_id = excluded.device_id,
        name = excluded.name,
        is_locked = excluded.is_locked,
        is_active = true,
        assigned_at = now(),
        updated_at = now();

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'table_no', p_table_no,
    'device_id', v_device,
    'replaced_previous_device_id', nullif(v_previous_device_id, '')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_customer_tablet_device_from_enrollment(
  p_session_token text,
  p_table_no integer,
  p_name text DEFAULT NULL,
  p_replace_existing boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_session text;
  v_session_hash text;
  v_brand_id uuid;
  v_device text;
  v_name text;
  v_existing_device text;
BEGIN
  v_session := trim(coalesce(p_session_token, ''));
  v_name := nullif(trim(coalesce(p_name, '')), '');

  IF v_session = '' OR p_table_no IS NULL OR p_table_no <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  v_session_hash := encode(digest(v_session, 'sha256'), 'hex');

  SELECT s.brand_id, trim(s.device_id)
  INTO v_brand_id, v_device
  FROM public.tablet_enrollment_sessions s
  WHERE s.session_hash = v_session_hash
    AND s.expires_at > now();

  IF v_brand_id IS NULL OR coalesce(v_device, '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'session_invalid_or_expired');
  END IF;

  SELECT d.device_id
  INTO v_existing_device
  FROM public.customer_tablet_devices d
  WHERE d.brand_id = v_brand_id
    AND d.table_no = p_table_no
    AND d.is_active = true
  LIMIT 1;

  IF v_existing_device IS NOT NULL AND lower(v_existing_device) <> lower(v_device) AND coalesce(p_replace_existing, false) = false THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_already_assigned');
  END IF;

  IF coalesce(p_replace_existing, false) THEN
    DELETE FROM public.customer_tablet_devices d
    WHERE d.brand_id = v_brand_id
      AND d.table_no = p_table_no
      AND lower(d.device_id) <> lower(v_device);
  END IF;

  UPDATE public.customer_tablet_devices d
  SET table_no = p_table_no,
      name = v_name,
      is_locked = true,
      is_active = true,
      assigned_at = now(),
      updated_at = now()
  WHERE d.brand_id = v_brand_id
    AND lower(d.device_id) = lower(v_device);

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.customer_tablet_devices (brand_id, device_id, table_no, name, is_locked, is_active, assigned_at, last_seen_at)
      VALUES (v_brand_id, v_device, p_table_no, v_name, true, true, now(), now());
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_already_assigned');
    END;
  END IF;

  UPDATE public.tablet_enrollment_sessions s
  SET consumed_at = now()
  WHERE s.session_hash = v_session_hash
    AND s.consumed_at IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', v_brand_id,
    'device_id', v_device,
    'table_no', p_table_no
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.issue_tablet_enrollment_token(uuid, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_tablet_enrollment_token(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_brand_tablet_assignment_status(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_customer_tablet_device(uuid, integer, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_customer_tablet_device_from_enrollment(text, integer, text, boolean) TO anon, authenticated;

COMMIT;
