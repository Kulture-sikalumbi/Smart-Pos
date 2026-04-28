-- Extend cashier shifts to support Z-report snapshots (expected vs actual).
-- Keeps compatibility with existing `cashier_shift_start` / `cashier_shift_end` RPCs.

BEGIN;

ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS expected_cash numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_card numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_cheque numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_account numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expected_nonbank numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS z_report_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS closed_by_staff_id uuid NULL REFERENCES public.under_brand_staff(id) ON DELETE SET NULL;

-- Helpful index for reporting queries by range.
CREATE INDEX IF NOT EXISTS idx_cashier_shifts_brand_closed_at
  ON public.cashier_shifts (brand_id, closed_at DESC);

COMMIT;

