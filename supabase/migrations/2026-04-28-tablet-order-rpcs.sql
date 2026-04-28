-- Tablet menu + order submit RPCs for locked table tablets.

BEGIN;

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pos';

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS external_ref text NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pos_orders_source_allowed'
      AND conrelid = 'public.pos_orders'::regclass
  ) THEN
    ALTER TABLE public.pos_orders
      ADD CONSTRAINT pos_orders_source_allowed
      CHECK (source IN ('pos', 'tablet', 'self_order', 'qr'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_pos_orders_brand_source_created
  ON public.pos_orders (brand_id, source, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tablet_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  tablet_device_id uuid NOT NULL REFERENCES public.customer_tablet_devices(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  table_no integer NOT NULL,
  submission_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_order_id text NULL,
  status text NOT NULL DEFAULT 'submitted',
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tablet_orders_device_nonempty CHECK (length(trim(device_id)) > 0),
  CONSTRAINT tablet_orders_submission_key_nonempty CHECK (length(trim(submission_key)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tablet_orders_idempotency
  ON public.tablet_orders (brand_id, lower(device_id), submission_key);

CREATE INDEX IF NOT EXISTS idx_tablet_orders_brand_submitted
  ON public.tablet_orders (brand_id, submitted_at DESC);

ALTER TABLE IF EXISTS public.tablet_orders ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.tablet_orders TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_customer_tablet_device(uuid, text, integer, text, boolean) TO authenticated;

DROP POLICY IF EXISTS "tablet_orders_select_brand_owner" ON public.tablet_orders;
CREATE POLICY "tablet_orders_select_brand_owner" ON public.tablet_orders
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "tablet_orders_insert_brand_owner" ON public.tablet_orders;
CREATE POLICY "tablet_orders_insert_brand_owner" ON public.tablet_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

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
  is_available boolean
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
    i.is_available
  FROM public.pos_menu_items i
  LEFT JOIN public.pos_menu_categories c ON c.id = i.category_id
  WHERE i.brand_id = v_assignment.brand_id
    AND i.is_available = true
  ORDER BY coalesce(c.sort_order, 9999), lower(coalesce(c.name, '')), lower(i.name);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_tablet_menu(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_tablet_menu(text) TO authenticated;

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

  -- Validate payload and compute totals.
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

GRANT EXECUTE ON FUNCTION public.submit_tablet_order(text, text, jsonb) TO anon;
GRANT EXECUTE ON FUNCTION public.submit_tablet_order(text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.tablet_call_waiter(
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
  v_table_label text;
  v_table_name text;
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

  -- Best-effort idempotency: don't spam within the same submission key.
  IF EXISTS (
    SELECT 1 FROM public.pos_notifications n
    WHERE n.brand_id = v_assignment.brand_id::text
      AND n.type = 'waiter_call'
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
    'waiter_call',
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

GRANT EXECUTE ON FUNCTION public.tablet_call_waiter(text, text) TO anon;
GRANT EXECUTE ON FUNCTION public.tablet_call_waiter(text, text) TO authenticated;

COMMIT;
