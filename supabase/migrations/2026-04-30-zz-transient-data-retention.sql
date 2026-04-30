BEGIN;

-- Keep storage lean by purging only transient data.
-- Important: Do NOT delete financial/operational source-of-truth tables here.
CREATE OR REPLACE FUNCTION public.cleanup_transient_data(
  p_brand_id uuid,
  p_notifications_keep_days integer DEFAULT 14,
  p_tablet_keep_days integer DEFAULT 30,
  p_receipts_keep_days integer DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_notifications_days integer := GREATEST(COALESCE(p_notifications_keep_days, 14), 1);
  v_tablet_days integer := GREATEST(COALESCE(p_tablet_keep_days, 30), 1);
  v_deleted_notifications integer := 0;
  v_deleted_tokens integer := 0;
  v_deleted_sessions integer := 0;
  v_receipts_days integer := GREATEST(COALESCE(p_receipts_keep_days, 1), 1);
  v_deleted_receipts integer := 0;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Missing brand id';
  END IF;

  -- Restrict cleanup to brand owner context.
  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.owner_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'not_authorized'
    );
  END IF;

  DELETE FROM public.pos_notifications
  WHERE brand_id = p_brand_id::text
    AND created_at < now() - make_interval(days => v_notifications_days);
  GET DIAGNOSTICS v_deleted_notifications = ROW_COUNT;

  -- Delete expired/old enrollment sessions first.
  DELETE FROM public.tablet_enrollment_sessions
  WHERE brand_id = p_brand_id
    AND coalesce(expires_at, created_at) < now() - make_interval(days => v_tablet_days);
  GET DIAGNOSTICS v_deleted_sessions = ROW_COUNT;

  DELETE FROM public.tablet_enrollment_tokens
  WHERE brand_id = p_brand_id
    AND coalesce(expires_at, created_at) < now() - make_interval(days => v_tablet_days);
  GET DIAGNOSTICS v_deleted_tokens = ROW_COUNT;

  -- Receipts are reprint convenience copies (orders remain source-of-truth).
  -- Keep only the recent daily window to cap storage growth.
  DELETE FROM public.pos_receipts
  WHERE brand_id = p_brand_id
    AND issued_at < now() - make_interval(days => v_receipts_days);
  GET DIAGNOSTICS v_deleted_receipts = ROW_COUNT;

  DELETE FROM public.pos_receipts_today
  WHERE brand_id = p_brand_id
    AND issued_at < now() - make_interval(days => v_receipts_days);

  RETURN jsonb_build_object(
    'ok', true,
    'brand_id', p_brand_id,
    'notifications_deleted', v_deleted_notifications,
    'tablet_sessions_deleted', v_deleted_sessions,
    'tablet_tokens_deleted', v_deleted_tokens,
    'receipts_deleted', v_deleted_receipts,
    'notifications_keep_days', v_notifications_days,
    'tablet_keep_days', v_tablet_days,
    'receipts_keep_days', v_receipts_days
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_transient_data(uuid, integer, integer, integer) TO authenticated;

COMMIT;

