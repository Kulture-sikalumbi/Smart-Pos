-- 004_rls_policies.sql
-- Row Level Security (RLS) policies for brands, staff and storage

-- 1) BRANDS: allow authenticated users to insert brands but ensure owner_id equals caller;
-- owners may update their brand; public SELECT is allowed (read-only) so app can fetch branding.
ALTER TABLE IF EXISTS public.brands ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read branding rows (you can restrict this later if needed)
DROP POLICY IF EXISTS "brands_select_public" ON public.brands;
CREATE POLICY "brands_select_public" ON public.brands
  FOR SELECT
  USING (true);

-- Allow authenticated user to INSERT but only if owner_id equals auth.uid()
DROP POLICY IF EXISTS "brands_insert_owner_must_match" ON public.brands;
CREATE POLICY "brands_insert_owner_must_match" ON public.brands
  FOR INSERT
  TO authenticated
  USING (true)
  WITH CHECK (owner_id = auth.uid());

-- Allow owners to UPDATE their brand rows
DROP POLICY IF EXISTS "brands_owner_update" ON public.brands;
CREATE POLICY "brands_owner_update" ON public.brands
  FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- 2) STAFF: enable RLS so users can create their own staff record, and brand owners can manage staff for their brand
ALTER TABLE IF EXISTS public.staff ENABLE ROW LEVEL SECURITY;

-- SELECT: allow authenticated users to see staff rows that belong to the same brand as them,
-- or allow brand owners to view staff for their brand
DROP POLICY IF EXISTS "staff_select_same_brand_or_owner" ON public.staff;
CREATE POLICY "staff_select_same_brand_or_owner" ON public.staff
  FOR SELECT
  TO authenticated
  USING (
    brand_id IN (SELECT brand_id FROM public.staff WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- INSERT: allow user to create their own staff row, or allow brand owner to create staff rows for their brand
DROP POLICY IF EXISTS "staff_insert_self_or_brand_owner" ON public.staff;
CREATE POLICY "staff_insert_self_or_brand_owner" ON public.staff
  FOR INSERT
  TO authenticated
  USING (true)
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- UPDATE: allow user to update their own staff row, or brand owner to update staff rows for their brand
DROP POLICY IF EXISTS "staff_update_self_or_brand_owner" ON public.staff;
CREATE POLICY "staff_update_self_or_brand_owner" ON public.staff
  FOR UPDATE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_id = auth.uid())
  );

-- DELETE: only brand owners may remove staff rows for their brand
DROP POLICY IF EXISTS "staff_delete_brand_owner_only" ON public.staff;
CREATE POLICY "staff_delete_brand_owner_only" ON public.staff
  FOR DELETE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.brands b WHERE b.id = brand_id AND b.owner_id = auth.uid()));

-- 3) STORAGE: allow authenticated users to upload into the `branding-logos` bucket and allow reads
-- Note: this policy permits any authenticated user to upload files to the bucket. If you want stricter
-- control (only owners may upload to their brand folder), structure object names like
-- "{auth.uid()}/..." and change the CHECK expression accordingly.
ALTER TABLE IF EXISTS storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "storage_insert_branding_bucket_authenticated" ON storage.objects;
CREATE POLICY "storage_insert_branding_bucket_authenticated" ON storage.objects
  FOR INSERT
  TO authenticated
  USING (bucket_id = 'branding-logos')
  WITH CHECK (bucket_id = 'branding-logos');

DROP POLICY IF EXISTS "storage_select_branding_bucket" ON storage.objects;
CREATE POLICY "storage_select_branding_bucket" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'branding-logos');

-- Optionally allow updates/deletes only to object owners or authenticated users
DROP POLICY IF EXISTS "storage_update_authenticated" ON storage.objects;
CREATE POLICY "storage_update_authenticated" ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (bucket_id = 'branding-logos')
  WITH CHECK (bucket_id = 'branding-logos');

DROP POLICY IF EXISTS "storage_delete_authenticated" ON storage.objects;
CREATE POLICY "storage_delete_authenticated" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (bucket_id = 'branding-logos');

-- IMPORTANT: After applying these policies consider making the bucket public or using
-- signed URLs for public access. If you make it private, fetching publicUrl may fail unless
-- you generate signed URLs from the server with service_role key.
