-- Persist paid POS receipts for reprint/audit and expose staff-safe session reads.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.pos_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  shift_id uuid NULL REFERENCES public.cashier_shifts(id) ON DELETE SET NULL,
  till_id uuid NULL REFERENCES public.tills(id) ON DELETE SET NULL,
  staff_id text NULL,
  staff_name text NULL,
  order_no bigint NULL,
  payment_method text NULL,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'ZMW',
  issued_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pos_receipts_brand_order
  ON public.pos_receipts (brand_id, order_id);

CREATE INDEX IF NOT EXISTS idx_pos_receipts_brand_shift_issued
  ON public.pos_receipts (brand_id, shift_id, issued_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_receipts_brand_staff_issued
  ON public.pos_receipts (brand_id, staff_id, issued_at DESC);

CREATE OR REPLACE FUNCTION public.get_staff_shift_receipts(
  p_email text,
  p_pin text,
  p_shift_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  order_id text,
  shift_id uuid,
  till_id uuid,
  till_code text,
  till_name text,
  staff_id text,
  staff_name text,
  order_no bigint,
  payment_method text,
  subtotal numeric,
  discount_amount numeric,
  tax numeric,
  total numeric,
  currency_code text,
  issued_at timestamptz,
  payload jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_staff public.under_brand_staff%ROWTYPE;
  v_email text;
  v_pin text;
  v_limit integer;
  v_can_view_all boolean := false;
BEGIN
  v_email := lower(trim(coalesce(p_email, '')));
  v_pin := trim(coalesce(p_pin, ''));
  v_limit := greatest(1, least(coalesce(p_limit, 100), 300));

  IF v_email = '' OR v_pin = '' THEN
    RETURN;
  END IF;

  SELECT * INTO v_staff
  FROM public.under_brand_staff s
  WHERE lower(s.email) = v_email
    AND s.pin = v_pin
    AND s.is_active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_can_view_all := v_staff.role IN ('owner', 'admin', 'manager', 'front_supervisor');

  RETURN QUERY
  SELECT
    r.id,
    r.order_id,
    r.shift_id,
    r.till_id,
    t.code AS till_code,
    t.name AS till_name,
    r.staff_id,
    r.staff_name,
    r.order_no,
    r.payment_method,
    r.subtotal,
    r.discount_amount,
    r.tax,
    r.total,
    r.currency_code,
    r.issued_at,
    r.payload
  FROM public.pos_receipts r
  LEFT JOIN public.tills t ON t.id = r.till_id
  WHERE r.brand_id = v_staff.brand_id
    AND (p_shift_id IS NULL OR r.shift_id = p_shift_id)
    AND (v_can_view_all OR coalesce(r.staff_id, '') = coalesce(v_staff.id::text, ''))
  ORDER BY r.issued_at DESC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_staff_shift_receipts(text, text, uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.get_staff_shift_receipts(text, text, uuid, integer) TO authenticated;

COMMIT;

