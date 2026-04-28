BEGIN;

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
      i.is_available,
      i.image
    FROM public.pos_menu_items i
    LEFT JOIN public.pos_categories c ON c.id = i.category_id
    WHERE i.brand_id = v_assignment.brand_id
      AND i.is_available = true
    ORDER BY coalesce(c.sort_order, 9999), lower(coalesce(c.name, '')), lower(i.name);
    RETURN;
  END IF;

  -- Compatibility path for projects that use public.products + public.departments.
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
      true,
      coalesce(p.image_storage_path, to_jsonb(p) ->> 'image_url')
    FROM public.products p
    LEFT JOIN public.departments d ON d.id = coalesce(p.department_id, p.category_id)
    WHERE p.brand_id = v_assignment.brand_id
    ORDER BY lower(coalesce(d.name, '')), lower(p.name);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_tablet_order(
  p_device_id text,
  p_submission_key text,
  p_items jsonb
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
  v_existing public.tablet_orders%ROWTYPE;
  v_order_id text;
  v_order_no bigint;
  v_subtotal numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
  v_total_cost numeric := 0;
  v_gross_profit numeric := 0;
  v_gp_percent numeric := 0;
BEGIN
  v_device := trim(coalesce(p_device_id, ''));
  v_key := trim(coalesce(p_submission_key, ''));
  IF v_device = '' OR v_key = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'empty_items');
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

  SELECT * INTO v_existing
  FROM public.tablet_orders t
  WHERE t.brand_id = v_assignment.brand_id
    AND lower(t.device_id) = lower(v_device)
    AND t.submission_key = v_key
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'idempotent', true,
      'tablet_order_id', v_existing.id,
      'order_id', v_existing.created_order_id,
      'table_no', v_existing.table_no
    );
  END IF;

  IF to_regclass('public.pos_menu_items') IS NOT NULL THEN
    WITH requested AS (
      SELECT
        (x.value ->> 'menu_item_id')::uuid AS menu_item_id,
        greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)) AS quantity
      FROM jsonb_array_elements(p_items) AS x(value)
    ),
    validated AS (
      SELECT
        i.id AS menu_item_id,
        i.code AS menu_item_code,
        i.name AS menu_item_name,
        i.price,
        coalesce(i.cost, 0) AS cost,
        r.quantity
      FROM requested r
      JOIN public.pos_menu_items i
        ON i.id = r.menu_item_id
       AND i.brand_id = v_assignment.brand_id
       AND i.is_available = true
    )
    SELECT
      coalesce(sum(v.price * v.quantity), 0),
      coalesce(sum(v.cost * v.quantity), 0)
    INTO v_subtotal, v_total_cost
    FROM validated v;
  ELSIF to_regclass('public.products') IS NOT NULL THEN
    WITH requested AS (
      SELECT
        (x.value ->> 'menu_item_id')::uuid AS menu_item_id,
        greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)) AS quantity
      FROM jsonb_array_elements(p_items) AS x(value)
    ),
    validated AS (
      SELECT
        p.id AS menu_item_id,
        coalesce(p.code, '') AS menu_item_code,
        p.name AS menu_item_name,
        coalesce(p.base_price, 0) AS price,
        0::numeric AS cost,
        r.quantity
      FROM requested r
      JOIN public.products p
        ON p.id = r.menu_item_id
       AND p.brand_id = v_assignment.brand_id
    )
    SELECT
      coalesce(sum(v.price * v.quantity), 0),
      coalesce(sum(v.cost * v.quantity), 0)
    INTO v_subtotal, v_total_cost
    FROM validated v;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'menu_unavailable');
  END IF;

  IF v_subtotal <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_items');
  END IF;

  v_total := round(v_subtotal::numeric, 2);
  v_tax := round((v_subtotal * 0.16 / 1.16)::numeric, 2);
  v_gross_profit := round((v_subtotal - v_total_cost)::numeric, 2);
  v_gp_percent := CASE WHEN v_subtotal > 0 THEN round(((v_gross_profit / v_subtotal) * 100)::numeric, 2) ELSE 0 END;

  v_order_id := gen_random_uuid()::text;
  SELECT coalesce(max(o.order_no), 1999) + 1
  INTO v_order_no
  FROM public.pos_orders o
  WHERE o.brand_id = v_assignment.brand_id;

  INSERT INTO public.pos_orders (
    id, brand_id, order_no, table_no, order_type, status,
    staff_id, staff_name, subtotal, discount_amount, discount_percent, tax, total,
    total_cost, gross_profit, gp_percent, created_at, sent_at, source, external_ref
  )
  VALUES (
    v_order_id, v_assignment.brand_id, v_order_no, v_assignment.table_no, 'eat_in', 'sent',
    'tablet', format('Tablet Table %s', v_assignment.table_no), v_subtotal, 0, 0, v_tax, v_total,
    v_total_cost, v_gross_profit, v_gp_percent, now(), now(), 'tablet', v_key
  );

  IF to_regclass('public.pos_menu_items') IS NOT NULL THEN
    INSERT INTO public.pos_order_items (
      order_id, brand_id, menu_item_id, menu_item_code, menu_item_name,
      quantity, unit_price, unit_cost, total, sent_to_kitchen, is_voided, created_at
    )
    SELECT
      v_order_id,
      v_assignment.brand_id,
      i.id,
      i.code,
      i.name,
      greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)) AS quantity,
      i.price,
      coalesce(i.cost, 0),
      round((i.price * greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)))::numeric, 2),
      true,
      false,
      now()
    FROM jsonb_array_elements(p_items) AS x(value)
    JOIN public.pos_menu_items i
      ON i.id = (x.value ->> 'menu_item_id')::uuid
     AND i.brand_id = v_assignment.brand_id
     AND i.is_available = true;
  ELSE
    INSERT INTO public.pos_order_items (
      order_id, brand_id, menu_item_id, menu_item_code, menu_item_name,
      quantity, unit_price, unit_cost, total, sent_to_kitchen, is_voided, created_at
    )
    SELECT
      v_order_id,
      v_assignment.brand_id,
      p.id,
      coalesce(p.code, ''),
      p.name,
      greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)) AS quantity,
      coalesce(p.base_price, 0),
      0::numeric,
      round((coalesce(p.base_price, 0) * greatest(1, coalesce((x.value ->> 'quantity')::numeric, 1)))::numeric, 2),
      true,
      false,
      now()
    FROM jsonb_array_elements(p_items) AS x(value)
    JOIN public.products p
      ON p.id = (x.value ->> 'menu_item_id')::uuid
     AND p.brand_id = v_assignment.brand_id;
  END IF;

  INSERT INTO public.tablet_orders (
    brand_id, tablet_device_id, device_id, table_no, submission_key, payload, created_order_id, status, submitted_at
  )
  VALUES (
    v_assignment.brand_id, v_assignment.id, v_device, v_assignment.table_no, v_key, p_items, v_order_id, 'submitted', now()
  );

  UPDATE public.customer_tablet_devices d
  SET last_seen_at = now(), updated_at = now()
  WHERE d.id = v_assignment.id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'table_no', v_assignment.table_no
  );
EXCEPTION
  WHEN unique_violation THEN
    SELECT * INTO v_existing
    FROM public.tablet_orders t
    WHERE t.brand_id = v_assignment.brand_id
      AND lower(t.device_id) = lower(v_device)
      AND t.submission_key = v_key
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', true,
        'idempotent', true,
        'tablet_order_id', v_existing.id,
        'order_id', v_existing.created_order_id,
        'table_no', v_existing.table_no
      );
    END IF;

    RETURN jsonb_build_object('ok', false, 'error', 'submit_conflict');
END;
$$;

COMMIT;
