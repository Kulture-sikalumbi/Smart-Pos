-- 005_add_staff_full_name.sql
-- Ensure staff table has a `full_name` column to satisfy existing triggers

ALTER TABLE IF EXISTS public.staff
  ADD COLUMN IF NOT EXISTS full_name text;

-- Backfill full_name from display_name or email prefix where available
UPDATE public.staff
SET full_name = COALESCE(display_name, split_part(email, '@', 1), '')
WHERE full_name IS NULL;

-- If there are triggers expecting NOT NULL, you can make it NOT NULL with a default
ALTER TABLE IF EXISTS public.staff
  ALTER COLUMN full_name SET DEFAULT '';

-- If you prefer NOT NULL constraint uncomment the following line after verifying data
-- ALTER TABLE IF EXISTS public.staff ALTER COLUMN full_name SET NOT NULL;
