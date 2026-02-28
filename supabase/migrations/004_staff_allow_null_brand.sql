-- 004_staff_allow_null_brand.sql
-- Make staff.brand_id nullable so new users can be created before a brand exists

ALTER TABLE IF EXISTS public.staff
  ALTER COLUMN brand_id DROP NOT NULL;

-- Ensure index exists
CREATE INDEX IF NOT EXISTS idx_staff_brand_id ON public.staff(brand_id);
