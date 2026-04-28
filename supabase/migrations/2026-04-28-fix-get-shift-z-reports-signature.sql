-- Fix migration ordering issue:
-- `get_shift_z_reports(uuid,date,date)` changed OUT columns (added staff_name),
-- which requires dropping the old function first.

BEGIN;

DROP FUNCTION IF EXISTS public.get_shift_z_reports(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_shift_z_reports(
  p_brand_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  id uuid,
  staff_id uuid,
  staff_name text,
  opened_at timestamptz,
  closed_at timestamptz,
  opening_cash numeric,
  actual_cash numeric,
  expected_cash numeric,
  variance_cash numeric,
  z_report_summary jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    cs.id,
    cs.staff_id,
    coalesce(s.name, 'Unknown') as staff_name,
    cs.opened_at,
    cs.closed_at,
    cs.opening_cash,
    coalesce(cs.closing_cash, 0) as actual_cash,
    round((coalesce(cs.opening_cash, 0) + coalesce(agg.cash_sales, 0))::numeric, 2) as expected_cash,
    round((coalesce(cs.closing_cash, 0) - (coalesce(cs.opening_cash, 0) + coalesce(agg.cash_sales, 0)))::numeric, 2) as variance_cash,
    cs.z_report_summary
  FROM public.cashier_shifts cs
  LEFT JOIN public.under_brand_staff s ON s.id = cs.staff_id
  LEFT JOIN LATERAL (
    SELECT
      coalesce(sum(case when o.payment_method = 'cash' then o.total else 0 end), 0) as cash_sales
    FROM public.pos_orders o
    WHERE o.shift_id = cs.id
      AND o.status = 'paid'
  ) agg ON true
  WHERE cs.brand_id = p_brand_id
    AND cs.closed_at IS NOT NULL
    AND cs.closed_at::date >= coalesce(p_from, cs.closed_at::date)
    AND cs.closed_at::date <= coalesce(p_to, cs.closed_at::date)
  ORDER BY cs.closed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_z_reports(uuid, date, date) TO authenticated;

COMMIT;

