-- 2026-04-26-front-stock-rls.sql
-- Enable RLS + brand-scoped policies for front_stock (Supabase authenticated).

BEGIN;

-- Table-level privileges (RLS still applies).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.front_stock TO authenticated;

-- Optional: allow read-only access for anon if your app uses it.
-- GRANT SELECT ON public.front_stock TO anon;

ALTER TABLE IF EXISTS public.front_stock ENABLE ROW LEVEL SECURITY;

-- Brand-owner scoped policies (match pattern used in stock_issues).
DROP POLICY IF EXISTS "front_stock_select_brand_owner" ON public.front_stock;
CREATE POLICY "front_stock_select_brand_owner" ON public.front_stock
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "front_stock_insert_brand_owner" ON public.front_stock;
CREATE POLICY "front_stock_insert_brand_owner" ON public.front_stock
  FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "front_stock_update_brand_owner" ON public.front_stock;
CREATE POLICY "front_stock_update_brand_owner" ON public.front_stock
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

DROP POLICY IF EXISTS "front_stock_delete_brand_owner" ON public.front_stock;
CREATE POLICY "front_stock_delete_brand_owner" ON public.front_stock
  FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

COMMIT;

