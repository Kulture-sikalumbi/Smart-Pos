-- X/Z reporting RPCs for cashier shifts.
-- Security definer functions so supervisors/admins can read summaries and
-- cashiers/supervisors can finalize Z-report snapshots.

BEGIN;

-- Compute live shift summary (X-report) for a given shift id.
CREATE OR REPLACE FUNCTION public.cashier_shift_x_report(p_shift_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_shift public.cashier_shifts%ROWTYPE;
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

GRANT EXECUTE ON FUNCTION public.cashier_shift_x_report(uuid) TO authenticated;

-- Finalize Z-report snapshot. Updates expected totals + z_report_summary.
-- Optionally also closes the shift if it is still open.
CREATE OR REPLACE FUNCTION public.cashier_shift_finalize_z_report(
  p_shift_id uuid,
  p_actual_cash numeric,
  p_closed_by_staff_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_shift public.cashier_shifts%ROWTYPE;
  v_cash numeric := 0;
  v_card numeric := 0;
  v_cheque numeric := 0;
  v_account numeric := 0;
  v_nonbank numeric := 0;
  v_total numeric := 0;
  v_orders integer := 0;
  v_expected_cash numeric := 0;
  v_variance numeric := 0;
  v_summary jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO v_shift FROM public.cashier_shifts cs WHERE cs.id = p_shift_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'shift_not_found');
  END IF;

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

  v_expected_cash := coalesce(v_shift.opening_cash, 0) + coalesce(v_cash, 0);
  v_variance := coalesce(p_actual_cash, 0) - v_expected_cash;

  v_summary := jsonb_build_object(
    'shift_id', v_shift.id,
    'brand_id', v_shift.brand_id,
    'staff_id', v_shift.staff_id,
    'opened_at', v_shift.opened_at,
    'closed_at', coalesce(v_shift.closed_at, now()),
    'opening_cash', round(coalesce(v_shift.opening_cash, 0)::numeric, 2),
    'actual_cash', round(coalesce(p_actual_cash, 0)::numeric, 2),
    'expected_cash', round(v_expected_cash::numeric, 2),
    'variance_cash', round(v_variance::numeric, 2),
    'order_count', v_orders,
    'payment_breakdown', jsonb_build_object(
      'cash', round(v_cash::numeric, 2),
      'card', round(v_card::numeric, 2),
      'cheque', round(v_cheque::numeric, 2),
      'account', round(v_account::numeric, 2),
      'non_bank', round(v_nonbank::numeric, 2),
      'total', round(v_total::numeric, 2)
    )
  );

  UPDATE public.cashier_shifts cs
  SET
    -- If already closed, keep the original closed_at; else close now.
    closed_at = coalesce(cs.closed_at, now()),
    closing_cash = round(coalesce(p_actual_cash, 0)::numeric, 2),
    expected_cash = round(coalesce(v_expected_cash, 0)::numeric, 2),
    expected_card = round(coalesce(v_card, 0)::numeric, 2),
    expected_cheque = round(coalesce(v_cheque, 0)::numeric, 2),
    expected_account = round(coalesce(v_account, 0)::numeric, 2),
    expected_nonbank = round(coalesce(v_nonbank, 0)::numeric, 2),
    z_report_summary = v_summary,
    closed_by_staff_id = coalesce(p_closed_by_staff_id, cs.closed_by_staff_id)
  WHERE cs.id = p_shift_id;

  RETURN jsonb_build_object('ok', true, 'shift_id', p_shift_id, 'summary', v_summary);
END;
$$;

GRANT EXECUTE ON FUNCTION public.cashier_shift_finalize_z_report(uuid, numeric, uuid) TO authenticated;

-- List Z-reports (closed shifts) for a brand and date window.
CREATE OR REPLACE FUNCTION public.get_shift_z_reports(
  p_brand_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  id uuid,
  staff_id uuid,
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
    cs.opened_at,
    cs.closed_at,
    cs.opening_cash,
    cs.closing_cash as actual_cash,
    cs.expected_cash,
    round((coalesce(cs.closing_cash, 0) - coalesce(cs.expected_cash, 0))::numeric, 2) as variance_cash,
    cs.z_report_summary
  FROM public.cashier_shifts cs
  WHERE cs.brand_id = p_brand_id
    AND cs.closed_at IS NOT NULL
    AND cs.closed_at::date >= coalesce(p_from, cs.closed_at::date)
    AND cs.closed_at::date <= coalesce(p_to, cs.closed_at::date)
  ORDER BY cs.closed_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_shift_z_reports(uuid, date, date) TO authenticated;

COMMIT;

