-- Allow brand owners (Supabase auth) to manage tills and POS device bindings.
-- Keeps staff-mode access via SECURITY DEFINER RPCs.

BEGIN;

-- Tills write policies (owner)
DROP POLICY IF EXISTS "tills_insert_brand_owner" ON public.tills;
CREATE POLICY "tills_insert_brand_owner" ON public.tills
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "tills_update_brand_owner" ON public.tills;
CREATE POLICY "tills_update_brand_owner" ON public.tills
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

DROP POLICY IF EXISTS "tills_delete_brand_owner" ON public.tills;
CREATE POLICY "tills_delete_brand_owner" ON public.tills
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

-- POS devices write policies (owner)
DROP POLICY IF EXISTS "pos_devices_insert_brand_owner" ON public.pos_devices;
CREATE POLICY "pos_devices_insert_brand_owner" ON public.pos_devices
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "pos_devices_update_brand_owner" ON public.pos_devices;
CREATE POLICY "pos_devices_update_brand_owner" ON public.pos_devices
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

DROP POLICY IF EXISTS "pos_devices_delete_brand_owner" ON public.pos_devices;
CREATE POLICY "pos_devices_delete_brand_owner" ON public.pos_devices
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

COMMIT;

