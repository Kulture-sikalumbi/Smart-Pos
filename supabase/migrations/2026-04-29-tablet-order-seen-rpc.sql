BEGIN;

CREATE OR REPLACE FUNCTION public.tablet_mark_order_seen(
  p_order_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_order_id text;
  v_order public.pos_orders%ROWTYPE;
BEGIN
  v_order_id := trim(coalesce(p_order_id, ''));
  IF v_order_id = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_order_id');
  END IF;

  SELECT * INTO v_order
  FROM public.pos_orders o
  WHERE o.id = v_order_id
    AND coalesce(o.source, 'pos') = 'tablet'
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  -- Idempotent best-effort marker.
  IF EXISTS (
    SELECT 1 FROM public.pos_notifications n
    WHERE n.brand_id = v_order.brand_id::text
      AND n.type = 'tablet_order_seen'
      AND coalesce(n.payload ->> 'orderId', '') = v_order.id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  INSERT INTO public.pos_notifications (brand_id, type, payload)
  VALUES (
    v_order.brand_id::text,
    'tablet_order_seen',
    jsonb_build_object(
      'orderId', v_order.id,
      'orderNo', v_order.order_no,
      'tableNo', v_order.table_no
    )
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tablet_mark_order_seen(text) TO authenticated;

COMMIT;
