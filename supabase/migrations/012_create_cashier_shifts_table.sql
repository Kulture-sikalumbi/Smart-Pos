-- 012_create_cashier_shifts_table.sql
-- Cashier shift audit log: opening/closing cash balances + timestamps

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.cashier_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES public.under_brand_staff(id) ON DELETE CASCADE,

  opened_at timestamptz NOT NULL DEFAULT now(),
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,

  closed_at timestamptz NULL,
  closing_cash numeric(12,2) NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cashier_shifts_opening_cash_nonneg CHECK (opening_cash >= 0),
  CONSTRAINT cashier_shifts_closing_cash_nonneg CHECK (closing_cash IS NULL OR closing_cash >= 0),
  CONSTRAINT cashier_shifts_closed_requires_cash CHECK ((closed_at IS NULL AND closing_cash IS NULL) OR (closed_at IS NOT NULL AND closing_cash IS NOT NULL))
);

-- One open shift per cashier at a time
CREATE UNIQUE INDEX IF NOT EXISTS uidx_cashier_shifts_open_per_staff
  ON public.cashier_shifts (staff_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_brand_opened_at ON public.cashier_shifts (brand_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_staff_opened_at ON public.cashier_shifts (staff_id, opened_at DESC);

-- Keep updated_at current
DROP TRIGGER IF EXISTS set_updated_at_cashier_shifts_trigger ON public.cashier_shifts;
CREATE TRIGGER set_updated_at_cashier_shifts_trigger
BEFORE UPDATE ON public.cashier_shifts
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE IF EXISTS public.cashier_shifts ENABLE ROW LEVEL SECURITY;

-- Admin/brand owners can read shifts for their brand (auditing)
DROP POLICY IF EXISTS "cashier_shifts_select_brand_owner" ON public.cashier_shifts;
CREATE POLICY "cashier_shifts_select_brand_owner" ON public.cashier_shifts
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

COMMIT;
