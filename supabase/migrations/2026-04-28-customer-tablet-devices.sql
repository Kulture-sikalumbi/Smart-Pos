-- Customer tablet device registry for locked table ordering mode.

BEGIN;

CREATE TABLE IF NOT EXISTS public.customer_tablet_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  table_no integer NOT NULL,
  name text NULL,
  is_locked boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_tablet_devices_device_nonempty CHECK (length(trim(device_id)) > 0),
  CONSTRAINT customer_tablet_devices_table_no_positive CHECK (table_no > 0)
);

-- Strict one-to-one mapping (active table can only have one tablet).
CREATE UNIQUE INDEX IF NOT EXISTS uidx_customer_tablet_devices_brand_device
  ON public.customer_tablet_devices (brand_id, lower(device_id));

CREATE UNIQUE INDEX IF NOT EXISTS uidx_customer_tablet_devices_brand_table
  ON public.customer_tablet_devices (brand_id, table_no);

CREATE INDEX IF NOT EXISTS idx_customer_tablet_devices_brand_active
  ON public.customer_tablet_devices (brand_id, is_active);

DROP TRIGGER IF EXISTS set_updated_at_customer_tablet_devices_trigger ON public.customer_tablet_devices;
CREATE TRIGGER set_updated_at_customer_tablet_devices_trigger
BEFORE UPDATE ON public.customer_tablet_devices
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE IF EXISTS public.customer_tablet_devices ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_tablet_devices TO authenticated;
GRANT SELECT ON public.customer_tablet_devices TO anon;

DROP POLICY IF EXISTS "customer_tablet_devices_select_brand_owner" ON public.customer_tablet_devices;
CREATE POLICY "customer_tablet_devices_select_brand_owner" ON public.customer_tablet_devices
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "customer_tablet_devices_insert_brand_owner" ON public.customer_tablet_devices;
CREATE POLICY "customer_tablet_devices_insert_brand_owner" ON public.customer_tablet_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "customer_tablet_devices_update_brand_owner" ON public.customer_tablet_devices;
CREATE POLICY "customer_tablet_devices_update_brand_owner" ON public.customer_tablet_devices
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "customer_tablet_devices_delete_brand_owner" ON public.customer_tablet_devices;
CREATE POLICY "customer_tablet_devices_delete_brand_owner" ON public.customer_tablet_devices
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

CREATE OR REPLACE FUNCTION public.assign_customer_tablet_device(
  p_brand_id uuid,
  p_device_id text,
  p_table_no integer,
  p_name text DEFAULT NULL,
  p_is_locked boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_device text;
  v_name text;
BEGIN
  v_device := trim(coalesce(p_device_id, ''));
  v_name := nullif(trim(coalesce(p_name, '')), '');

  IF p_brand_id IS NULL OR v_device = '' OR p_table_no IS NULL OR p_table_no <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.brands b
    WHERE b.id = p_brand_id
      AND b.owner_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_allowed');
  END IF;

  -- Block mapping a table to a different device.
  IF EXISTS (
    SELECT 1
    FROM public.customer_tablet_devices d
    WHERE d.brand_id = p_brand_id
      AND d.table_no = p_table_no
      AND lower(d.device_id) <> lower(v_device)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_already_assigned');
  END IF;

  UPDATE public.customer_tablet_devices d
  SET table_no = p_table_no,
      name = v_name,
      is_locked = coalesce(p_is_locked, true),
      is_active = true,
      assigned_at = now(),
      updated_at = now()
  WHERE d.brand_id = p_brand_id
    AND lower(d.device_id) = lower(v_device);

  IF NOT FOUND THEN
    BEGIN
      INSERT INTO public.customer_tablet_devices (brand_id, device_id, table_no, name, is_locked, is_active, assigned_at)
      VALUES (p_brand_id, v_device, p_table_no, v_name, coalesce(p_is_locked, true), true, now());
    EXCEPTION
      WHEN unique_violation THEN
        RETURN jsonb_build_object('ok', false, 'error', 'table_already_assigned');
    END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'brand_id', p_brand_id, 'device_id', v_device, 'table_no', p_table_no);
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_customer_tablet_device(uuid, text, integer, text, boolean) TO authenticated;

COMMIT;
