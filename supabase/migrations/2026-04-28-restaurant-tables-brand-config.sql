-- Brand-scoped restaurant table configuration (replaces hardcoded tables in frontend).

BEGIN;

CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  table_no integer NOT NULL,
  name text NULL,
  section text NULL,
  seats integer NOT NULL DEFAULT 4,
  status text NOT NULL DEFAULT 'available',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_tables_table_no_positive CHECK (table_no > 0),
  CONSTRAINT restaurant_tables_seats_positive CHECK (seats > 0),
  CONSTRAINT restaurant_tables_status_allowed CHECK (status IN ('available', 'occupied', 'reserved', 'dirty'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uidx_restaurant_tables_brand_table_no
  ON public.restaurant_tables (brand_id, table_no);

CREATE INDEX IF NOT EXISTS idx_restaurant_tables_brand_active
  ON public.restaurant_tables (brand_id, is_active, table_no);

DROP TRIGGER IF EXISTS set_updated_at_restaurant_tables_trigger ON public.restaurant_tables;
CREATE TRIGGER set_updated_at_restaurant_tables_trigger
BEFORE UPDATE ON public.restaurant_tables
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE IF EXISTS public.restaurant_tables ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_tables TO authenticated;
GRANT SELECT ON public.restaurant_tables TO anon;

DROP POLICY IF EXISTS "restaurant_tables_select_brand_owner" ON public.restaurant_tables;
CREATE POLICY "restaurant_tables_select_brand_owner" ON public.restaurant_tables
  FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

DROP POLICY IF EXISTS "restaurant_tables_write_brand_owner" ON public.restaurant_tables;
CREATE POLICY "restaurant_tables_write_brand_owner" ON public.restaurant_tables
  FOR ALL
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.brands b
    WHERE b.id = brand_id AND b.owner_id = auth.uid()
  ));

COMMIT;

