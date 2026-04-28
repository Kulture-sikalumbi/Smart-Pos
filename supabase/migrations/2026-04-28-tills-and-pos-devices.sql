-- Create tills + POS device registry (device -> till), and link shifts to tills.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tills_code_nonempty CHECK (length(trim(code)) > 0),
  CONSTRAINT tills_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_tills_brand_code
  ON public.tills (brand_id, lower(code));

CREATE INDEX IF NOT EXISTS idx_tills_brand_active
  ON public.tills (brand_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at_tills_trigger ON public.tills;
CREATE TRIGGER set_updated_at_tills_trigger
BEFORE UPDATE ON public.tills
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.pos_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  till_id uuid NOT NULL REFERENCES public.tills(id) ON DELETE RESTRICT,
  name text NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pos_devices_device_id_nonempty CHECK (length(trim(device_id)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pos_devices_brand_device
  ON public.pos_devices (brand_id, lower(device_id));

CREATE INDEX IF NOT EXISTS idx_pos_devices_brand_till
  ON public.pos_devices (brand_id, till_id);

DROP TRIGGER IF EXISTS set_updated_at_pos_devices_trigger ON public.pos_devices;
CREATE TRIGGER set_updated_at_pos_devices_trigger
BEFORE UPDATE ON public.pos_devices
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Link shifts to tills
ALTER TABLE public.cashier_shifts
  ADD COLUMN IF NOT EXISTS till_id uuid NULL REFERENCES public.tills(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_cashier_shifts_brand_till_opened_at
  ON public.cashier_shifts (brand_id, till_id, opened_at DESC);

-- One open shift per till at a time (prevents two terminals sharing one drawer)
CREATE UNIQUE INDEX IF NOT EXISTS uidx_cashier_shifts_open_per_till
  ON public.cashier_shifts (till_id)
  WHERE closed_at IS NULL AND till_id IS NOT NULL;

-- RLS: keep consistent with existing pattern (owner reads; all access via SECURITY DEFINER RPCs)
ALTER TABLE IF EXISTS public.tills ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pos_devices ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tills TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_devices TO authenticated;

DROP POLICY IF EXISTS "tills_select_brand_owner" ON public.tills;
CREATE POLICY "tills_select_brand_owner" ON public.tills
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "pos_devices_select_brand_owner" ON public.pos_devices;
CREATE POLICY "pos_devices_select_brand_owner" ON public.pos_devices
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

COMMIT;

