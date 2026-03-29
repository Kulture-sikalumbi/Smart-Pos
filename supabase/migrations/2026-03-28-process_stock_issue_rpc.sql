CREATE OR REPLACE FUNCTION public.process_stock_issue(
  p_stock_item_id uuid,
  p_brand_id uuid,
  p_issue_type text,
  p_qty_issued numeric,
  p_unit_cost numeric,
  p_total_value numeric,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Essential: allows the function to update stock even if the user lacks direct update permissions
AS $$
DECLARE
    v_current_stock numeric;
BEGIN
    -- 1. Get current stock and LOCK the row to prevent other transactions from interfering
    SELECT current_stock INTO v_current_stock
    FROM public.stock_items
    WHERE id = p_stock_item_id AND brand_id = p_brand_id
    FOR UPDATE;

    -- 2. Verify existence
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found in inventory.';
    END IF;

    -- 3. Prevent negative stock (Professional Integrity Check)
    IF v_current_stock < p_qty_issued THEN
        RAISE EXCEPTION 'Insufficient stock. Current: %, Requested: %', v_current_stock, p_qty_issued;
    END IF;

    -- 4. Insert the Audit Entry into your stock_issues table
    INSERT INTO public.stock_issues (
        brand_id,
        stock_item_id,
        issue_type,
        qty_issued,
        unit_cost_at_time,
        total_value_lost,
        notes,
        created_by
    ) VALUES (
        p_brand_id,
        p_stock_item_id,
        p_issue_type,
        p_qty_issued,
        p_unit_cost,
        p_total_value,
        p_notes,
        auth.uid()
    );

    -- 5. Atomic Update of the Inventory
    UPDATE public.stock_items
    SET current_stock = current_stock - p_qty_issued
    WHERE id = p_stock_item_id AND brand_id = p_brand_id;

END;
$$;

-- Grant access to your authenticated users
GRANT EXECUTE ON FUNCTION public.process_stock_issue TO authenticated;