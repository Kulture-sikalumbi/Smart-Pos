-- Migration: create batch_productions table for manufacturing
-- Stores recorded batch production records with yield tracking

BEGIN;

-- Ensure pgcrypto is available for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- batch_productions table
CREATE TABLE IF NOT EXISTS public.batch_productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  recipe_id text NOT NULL, -- Reference to manufacturing recipe (can be prod-{id} or meta-{id})
  recipe_name text NOT NULL,
  batch_date date NOT NULL,
  theoretical_output numeric NOT NULL DEFAULT 0,
  actual_output numeric NOT NULL DEFAULT 0,
  yield_variance numeric NOT NULL DEFAULT 0,
  yield_variance_percent numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  produced_by text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- batch_production_ingredients table to store ingredient usage per batch
CREATE TABLE IF NOT EXISTS public.batch_production_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_production_id uuid NOT NULL REFERENCES public.batch_productions(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.stock_items(id) ON DELETE RESTRICT,
  ingredient_code text,
  ingredient_name text,
  required_qty numeric NOT NULL DEFAULT 0,
  unit_type text NOT NULL DEFAULT 'EACH',
  unit_cost numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_batch_productions_brand_id ON public.batch_productions (brand_id);
CREATE INDEX IF NOT EXISTS idx_batch_productions_batch_date ON public.batch_productions (batch_date);
CREATE INDEX IF NOT EXISTS idx_batch_productions_recipe_id ON public.batch_productions (recipe_id);
CREATE INDEX IF NOT EXISTS idx_batch_production_ingredients_batch_id ON public.batch_production_ingredients (batch_production_id);
CREATE INDEX IF NOT EXISTS idx_batch_production_ingredients_ingredient_id ON public.batch_production_ingredients (ingredient_id);

-- RLS Policies
ALTER TABLE public.batch_productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_production_ingredients ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access batch productions for brands they are staff of
DROP POLICY IF EXISTS batch_productions_brand_access ON public.batch_productions;
CREATE POLICY batch_productions_brand_access ON public.batch_productions
  FOR ALL
  USING (brand_id IN (SELECT brand_id FROM public.staff WHERE user_id = auth.uid()))
  WITH CHECK (brand_id IN (SELECT brand_id FROM public.staff WHERE user_id = auth.uid()));

DROP POLICY IF EXISTS batch_production_ingredients_brand_access ON public.batch_production_ingredients;
CREATE POLICY batch_production_ingredients_brand_access ON public.batch_production_ingredients
  FOR ALL
  USING (
    batch_production_id IN (
      SELECT id FROM public.batch_productions WHERE brand_id IN (SELECT brand_id FROM public.staff WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    batch_production_id IN (
      SELECT id FROM public.batch_productions WHERE brand_id IN (SELECT brand_id FROM public.staff WHERE user_id = auth.uid())
    )
  );

-- Grant permissions
GRANT ALL ON public.batch_productions TO authenticated;
GRANT ALL ON public.batch_production_ingredients TO authenticated;

COMMIT;
