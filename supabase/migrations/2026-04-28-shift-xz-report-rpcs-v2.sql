-- Harden X/Z report math and include cashier names in outputs.

BEGIN;

CREATE OR REPLACE FUNCTION public.cashier_shift_x_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_shift public.cashier_shifts%ROWTYPE;
  v_staff_name text := null;
  v_cash numeric := 0;
  v_card numeric := 0;
  v_cheque numeric := 0;
  v_account numeric := 0;
  v_nonbank numeric := 0;
  v_total numeric := 0;
  v_orders integer := 0;
BEGIN
  SELECT * INTO v_shift FROM public.cashier_shifts cs WHERE cs.id = p_shift_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN '{}'::jsonb;
  END IF;

  SELECT s.name INTO v_staff_name
  FROM public.under_brand_staff s
  WHERE s.id = v_shift.staff_id
  LIMIT 1;

  SELECT
    coalesce(sum(case when o.payment_method = 'cash' then o.total else 0 end), 0),
    coalesce(sum(case when o.payment_method = 'card' then o.total else 0 end), 0),
    coalesce(sum(case when o.payment_method = 'cheque' then o.total else 0 end), 0),
    coalesce(sum(case when o.payment_method = 'account' then o.total else 0 end), 0),
    coalesce(sum(case when o.payment_method = 'non_bank' then o.total else 0 end), 0),
    coalesce(sum(o.total), 0),
    coalesce(count(*), 0)
  INTO v_cash, v_card, v_cheque, v_account, v_nonbank, v_total, v_orders
  FROM public.pos_orders o
  WHERE o.shift_id = p_shift_id
    AND o.status = 'paid';

  RETURN jsonb_build_object(
    'shift_id', v_shift.id,
    'brand_id', v_shift.brand_id,
    'staff_id', v_shift.staff_id,
    'staff_name', coalesce(v_staff_name, 'Unknown'),
    'opened_at', v_shift.opened_at,
    'opening_cash', v_shift.opening_cash,
    'closed_at', v_shift.closed_at,
    'closing_cash', v_shift.closing_cash,
    'order_count', v_orders,
    'totals', jsonb_build_object(
      'cash', round(v_cash::numeric, 2),
      'card', round(v_card::numeric, 2),
      'cheque', round(v_cheque::numeric, 2),
      'account', round(v_account::numeric, 2),
      'non_bank', round(v_nonbank::numeric, 2),
      'total', round(v_total::numeric, 2)
    ),
    'expected_cash', round((coalesce(v_shift.opening_cash, 0) + coalesce(v_cash, 0))::numeric, 2)
  );
END;
$$;

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
    -- Recompute expected cash from durable order data for robustness.
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

COMMIT;

