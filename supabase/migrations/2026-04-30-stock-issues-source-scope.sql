BEGIN;

ALTER TABLE public.stock_issues
  ADD COLUMN IF NOT EXISTS source_module text NULL,
  ADD COLUMN IF NOT EXISTS location_scope text NULL,
  ADD COLUMN IF NOT EXISTS recorded_by_name text NULL;

CREATE OR REPLACE FUNCTION public.process_stock_issue(
  p_brand_id uuid,
  p_date date,
  p_created_by text,
  p_lines jsonb,
  p_source_module text DEFAULT NULL,
  p_location_scope text DEFAULT NULL,
  p_recorded_by_name text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  ln jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_current_stock numeric;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'Missing brand id';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN;
  END IF;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_item_id := (ln ->> 'stock_item_id')::uuid;
    v_qty := COALESCE(NULLIF((ln ->> 'qty_issued')::numeric, NULL), 0);

    IF v_item_id IS NULL THEN
      RAISE EXCEPTION 'Missing stock_item_id in lines payload';
    END IF;
    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Invalid qty_issued for item %', v_item_id;
    END IF;

    SELECT current_stock
      INTO v_current_stock
    FROM public.stock_items
    WHERE id = v_item_id
      AND brand_id = p_brand_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Item % not found in inventory.', v_item_id;
    END IF;

    IF COALESCE(v_current_stock, 0) < v_qty THEN
      RAISE EXCEPTION 'Insufficient stock. Item: %, Current: %, Requested: %', v_item_id, v_current_stock, v_qty;
    END IF;
  END LOOP;

  FOR ln IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO public.stock_issues (
      id,
      brand_id,
      stock_item_id,
      issue_type,
      qty_issued,
      unit_cost_at_time,
      total_value_lost,
      notes,
      created_by,
      created_at,
      source_module,
      location_scope,
      recorded_by_name
    ) VALUES (
      CASE
        WHEN trim(coalesce(ln ->> 'id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          THEN trim(ln ->> 'id')::uuid
        ELSE gen_random_uuid()
      END,
      p_brand_id,
      (ln ->> 'stock_item_id')::uuid,
      ln ->> 'issue_type',
      (ln ->> 'qty_issued')::numeric,
      (ln ->> 'unit_cost_at_time')::numeric,
      (ln ->> 'total_value_lost')::numeric,
      ln ->> 'notes',
      CASE
        WHEN NULLIF(trim(coalesce(p_created_by, '')), '') IS NULL THEN NULL
        WHEN trim(p_created_by) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN trim(p_created_by)::uuid
        ELSE NULL
      END,
      now(),
      NULLIF(trim(coalesce(p_source_module, '')), ''),
      NULLIF(trim(coalesce(p_location_scope, '')), ''),
      NULLIF(trim(coalesce(p_recorded_by_name, '')), '')
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb, text, text, text) TO anon;

COMMIT;

