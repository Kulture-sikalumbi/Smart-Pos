-- Leakage report: compare ingredient cost (batch production) vs shift revenue.
-- NOTE: This is a v1 approximation:
-- - Ingredient cost is derived from `batch_productions.total_cost` recorded in range.
-- - Revenue is derived from `pos_orders.total` linked by shift_id in range.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_shift_leakage_report(
  p_brand_id uuid,
  p_from date,
  p_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_revenue numeric := 0;
  v_cogs numeric := 0;
  v_gp numeric := 0;
  v_gp_pct numeric := 0;
BEGIN
  -- Revenue from shift-linked paid orders
  SELECT coalesce(sum(o.total), 0)
  INTO v_revenue
  FROM public.pos_orders o
  WHERE o.brand_id = p_brand_id
    AND o.status = 'paid'
    AND o.shift_id IS NOT NULL
    AND o.paid_at >= (p_from::text || 'T00:00:00')::timestamptz
    AND o.paid_at <= (p_to::text || 'T23:59:59')::timestamptz;

  -- Ingredient cost approximation: total cost of batches recorded in date range
  SELECT coalesce(sum(b.total_cost), 0)
  INTO v_cogs
  FROM public.batch_productions b
  WHERE b.brand_id = p_brand_id
    AND b.batch_date >= p_from
    AND b.batch_date <= p_to;

  v_gp := v_revenue - v_cogs;
  v_gp_pct := CASE WHEN v_revenue > 0 THEN round((v_gp / v_revenue) * 100, 2) ELSE 0 END;

  RETURN jsonb_build_object(
    'from', to_char(p_from, 'YYYY-MM-DD'),
    'to', to_char(p_to, 'YYYY-MM-DD'),
    'revenue', round(v_revenue::numeric, 2),
    'ingredient_cost_estimate', round(v_cogs::numeric, 2),
    'gross_profit_estimate', round(v_gp::numeric, 2),
    'gross_profit_percent_estimate', v_gp_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_leakage_report(uuid, date, date) TO authenticated;

COMMIT;

