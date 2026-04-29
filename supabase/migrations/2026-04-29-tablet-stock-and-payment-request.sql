BEGIN;

-- Stock-aware tablet menu (compat with both pos_menu_items and products tables).
DROP FUNCTION IF EXISTS public.get_tablet_menu(text);

CREATE OR REPLACE FUNCTION public.get_tablet_menu(
  p_device_id text
)
RETURNS TABLE (
  brand_id uuid,
  table_no integer,
  category_id uuid,
  category_name text,
  item_id uuid,
  item_code text,
  item_name text,
  price numeric,
  cost numeric,
  is_available boolean,
  image text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device text;
  v_assignment public.customer_tablet_devices%ROWTYPE;
BEGIN
  v_device := trim(coalesce(p_device_id, ''));
  IF v_device = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_assignment
  FROM public.customer_tablet_devices d
  WHERE lower(d.device_id) = lower(v_device)
    AND d.is_active = true
  ORDER BY d.updated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.customer_tablet_devices d
  SET last_seen_at = now(), updated_at = now()
  WHERE d.id = v_assignment.id;

  IF to_regclass('public.pos_menu_items') IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_assignment.brand_id,
      v_assignment.table_no,
      c.id,
      c.name,
      i.id,
      i.code,
      i.name,
      i.price,
      i.cost,
      CASE
        WHEN coalesce((to_jsonb(i) ->> 'track_inventory')::boolean, false) = false THEN i.is_available
        ELSE i.is_available AND EXISTS (
          SELECT 1
          FROM public.front_stock fs
          WHERE fs.brand_id = v_assignment.brand_id
            AND upper(coalesce(fs.location_tag, '')) = 'SALE'
            AND coalesce(fs.quantity, 0) > 0
            AND (
              (
                coalesce(to_jsonb(i) ->> 'physical_stock_item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                AND fs.item_id = (to_jsonb(i) ->> 'physical_stock_item_id')::uuid
              )
              OR lower(coalesce(fs.produced_code, '')) = lower(coalesce(i.code, ''))
              OR lower(coalesce(to_jsonb(fs) ->> 'item_code', '')) = lower(coalesce(i.code, ''))
            )
        )
      END AS is_available,
      i.image
    FROM public.pos_menu_items i
    LEFT JOIN public.pos_categories c ON c.id = i.category_id
    WHERE i.brand_id = v_assignment.brand_id
    ORDER BY coalesce(c.sort_order, 9999), lower(coalesce(c.name, '')), lower(i.name);
    RETURN;
  END IF;

  IF to_regclass('public.products') IS NOT NULL THEN
    RETURN QUERY
    SELECT
      v_assignment.brand_id,
      v_assignment.table_no,
      d.id,
      d.name,
      p.id,
      coalesce(p.code, ''),
      p.name,
      coalesce(p.base_price, 0),
      0::numeric,
      CASE
        WHEN coalesce((to_jsonb(p) ->> 'track_inventory')::boolean, false) = false THEN true
        ELSE EXISTS (
          SELECT 1
          FROM public.front_stock fs
          WHERE fs.brand_id = v_assignment.brand_id
            AND upper(coalesce(fs.location_tag, '')) = 'SALE'
            AND coalesce(fs.quantity, 0) > 0
            AND (
              (
                coalesce(to_jsonb(p) ->> 'physical_stock_item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                AND fs.item_id = (to_jsonb(p) ->> 'physical_stock_item_id')::uuid
              )
              OR lower(coalesce(fs.produced_code, '')) = lower(coalesce(p.code, ''))
              OR lower(coalesce(to_jsonb(fs) ->> 'item_code', '')) = lower(coalesce(p.code, ''))
            )
        )
      END AS is_available,
      coalesce(p.image_storage_path, to_jsonb(p) ->> 'image_url')
    FROM public.products p
    LEFT JOIN public.departments d ON d.id = coalesce(p.department_id, p.category_id)
    WHERE p.brand_id = v_assignment.brand_id
    ORDER BY lower(coalesce(d.name, '')), lower(p.name);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tablet_menu(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tablet_menu(text) TO authenticated;

-- Tablet-side "Request Bill" notification to cashier POS.
CREATE OR REPLACE FUNCTION public.tablet_request_bill(
  p_device_id text,
  p_submission_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device text;
  v_key text;
  v_assignment public.customer_tablet_devices%ROWTYPE;
  v_table_name text;
  v_table_label text;
BEGIN
  v_device := trim(coalesce(p_device_id, ''));
  v_key := trim(coalesce(p_submission_key, ''));
  IF v_device = '' OR v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  SELECT * INTO v_assignment
  FROM public.customer_tablet_devices d
  WHERE lower(d.device_id) = lower(v_device)
    AND d.is_active = true
  ORDER BY d.updated_at DESC NULLS LAST
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_not_assigned');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.pos_notifications n
    WHERE n.brand_id = v_assignment.brand_id::text
      AND n.type = 'tablet_payment_request'
      AND coalesce(n.payload ->> 'submissionKey', '') = v_key
      AND coalesce(n.payload ->> 'deviceId', '') = v_device
  ) THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true);
  END IF;

  SELECT rt.name INTO v_table_name
  FROM public.restaurant_tables rt
  WHERE rt.brand_id = v_assignment.brand_id
    AND rt.table_no = v_assignment.table_no
    AND rt.is_active = true
  LIMIT 1;

  v_table_label := coalesce(nullif(trim(coalesce(v_table_name, '')), ''), format('Table %s', v_assignment.table_no));

  INSERT INTO public.pos_notifications (brand_id, type, payload)
  VALUES (
    v_assignment.brand_id::text,
    'tablet_payment_request',
    jsonb_build_object(
      'tableNo', v_assignment.table_no,
      'tableLabel', v_table_label,
      'deviceId', v_device,
      'submissionKey', v_key
    )
  );

  UPDATE public.customer_tablet_devices d
  SET last_seen_at = now(), updated_at = now()
  WHERE d.id = v_assignment.id;

  RETURN jsonb_build_object('ok', true, 'table_no', v_assignment.table_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tablet_request_bill(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.tablet_request_bill(text, text) TO authenticated;

COMMIT;
