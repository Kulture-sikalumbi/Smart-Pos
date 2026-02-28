-- 003_create_staff_table.sql
-- Create server-side staff table to link auth users to brands

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  brand_id uuid REFERENCES public.brands(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'waitron',
  display_name text,
  email text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_brand_id ON public.staff(brand_id);

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_updated_at_trigger ON public.staff;
CREATE TRIGGER set_updated_at_trigger
BEFORE UPDATE ON public.staff
FOR EACH ROW
EXECUTE PROCEDURE public.set_updated_at();
