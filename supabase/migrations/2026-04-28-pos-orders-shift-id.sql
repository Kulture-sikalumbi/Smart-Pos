-- Link every paid sale to a cashier shift (for X/Z reporting).

BEGIN;

ALTER TABLE public.pos_orders
  ADD COLUMN IF NOT EXISTS shift_id uuid NULL REFERENCES public.cashier_shifts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_orders_brand_shift_paid
  ON public.pos_orders (brand_id, shift_id, paid_at DESC);

COMMIT;

