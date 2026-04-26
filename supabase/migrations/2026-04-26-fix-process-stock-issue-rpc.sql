-- 2026-04-26-fix-process-stock-issue-rpc.sql
-- Fix double-deduction by ensuring process_stock_issue ONLY inserts into stock_issues.
-- The AFTER INSERT trigger on stock_issues is the single source of truth for stock deduction
-- (and front_stock routing for Manufacturing/Sale).

BEGIN;

-- Drop the older single-line signature if it exists (legacy migration).
DROP FUNCTION IF EXISTS public.process_stock_issue(uuid, uuid, text, numeric, numeric, numeric, text) CASCADE;

-- Create/replace the canonical RPC used by the frontend:
--  process_stock_issue(p_brand_id uuid, p_date date, p_created_by text, p_lines jsonb)
CREATE OR REPLACE FUNCTION public.process_stock_issue(
  p_brand_id uuid,
  p_date date,
  p_created_by text,
  p_lines jsonb
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

  -- Validate and lock each stock_item row first, so we can raise cleanly and keep atomicity.
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

  -- Insert ledger rows. The stock_issues AFTER INSERT trigger will decrement stock_items
  -- and route Manufacturing/Sale to front_stock.
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
      created_at
    ) VALUES (
      COALESCE((ln ->> 'id')::uuid, gen_random_uuid()),
      p_brand_id,
      (ln ->> 'stock_item_id')::uuid,
      ln ->> 'issue_type',
      (ln ->> 'qty_issued')::numeric,
      (ln ->> 'unit_cost_at_time')::numeric,
      (ln ->> 'total_value_lost')::numeric,
      ln ->> 'notes',
      COALESCE(NULLIF(p_created_by, ''), auth.uid()::text),
      now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;

-- Match existing grants pattern used elsewhere.
GRANT EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb) TO anon;

COMMIT;

