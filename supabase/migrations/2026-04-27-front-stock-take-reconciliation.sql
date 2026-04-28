BEGIN;

CREATE TABLE IF NOT EXISTS public.front_stock_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.brands(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.under_brand_staff(id),
  item_id uuid REFERENCES public.stock_items(id),
  front_stock_id uuid NOT NULL REFERENCES public.front_stock(id) ON DELETE CASCADE,
  location_tag text NOT NULL CHECK (location_tag IN ('MANUFACTURING', 'SALE')),
  system_qty numeric NOT NULL,
  physical_qty numeric NOT NULL CHECK (physical_qty >= 0),
  variance numeric NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_front_stock_reconciliations_brand_created
  ON public.front_stock_reconciliations (brand_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_front_stock_reconciliations_front_stock
  ON public.front_stock_reconciliations (front_stock_id);

ALTER TABLE public.front_stock_reconciliations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "front_stock_reconciliations_select_brand_owner" ON public.front_stock_reconciliations;
CREATE POLICY "front_stock_reconciliations_select_brand_owner"
  ON public.front_stock_reconciliations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "front_stock_reconciliations_insert_brand_owner" ON public.front_stock_reconciliations;
CREATE POLICY "front_stock_reconciliations_insert_brand_owner"
  ON public.front_stock_reconciliations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.brands b
      WHERE b.id = brand_id
        AND b.owner_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.record_front_stock_take_reconciliation(
  p_brand_id uuid,
  p_staff_id uuid,
  p_location_tag text,
  p_counts jsonb,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_front_stock_id uuid;
  v_physical_qty numeric;
  v_row public.front_stock%ROWTYPE;
  v_variance numeric;
  v_count int := 0;
  v_role text;
BEGIN
  IF p_brand_id IS NULL THEN
    RAISE EXCEPTION 'brand_id is required';
  END IF;

  IF p_location_tag NOT IN ('MANUFACTURING', 'SALE') THEN
    RAISE EXCEPTION 'location_tag must be MANUFACTURING or SALE';
  END IF;

  IF p_counts IS NULL OR jsonb_typeof(p_counts) <> 'array' OR jsonb_array_length(p_counts) = 0 THEN
    RAISE EXCEPTION 'counts payload must be a non-empty array';
  END IF;

  -- Strict rule: the stock users cannot perform the count.
  IF p_staff_id IS NOT NULL THEN
    SELECT s.role
      INTO v_role
    FROM public.under_brand_staff s
    WHERE s.id = p_staff_id
      AND s.brand_id = p_brand_id
      AND s.is_active = true
    LIMIT 1;

    IF v_role IS NULL THEN
      RAISE EXCEPTION 'Invalid supervisor/staff context for this brand';
    END IF;

    IF v_role NOT IN ('manager', 'owner', 'admin') THEN
      RAISE EXCEPTION 'Only a Front Office Supervisor can run stock take';
    END IF;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_counts)
  LOOP
    v_front_stock_id := NULLIF(v_item->>'front_stock_id', '')::uuid;
    v_physical_qty := NULLIF(v_item->>'physical_qty', '')::numeric;

    IF v_front_stock_id IS NULL THEN
      RAISE EXCEPTION 'front_stock_id is required in each count line';
    END IF;

    IF v_physical_qty IS NULL OR v_physical_qty < 0 THEN
      RAISE EXCEPTION 'physical_qty must be a non-negative number';
    END IF;

    SELECT *
      INTO v_row
    FROM public.front_stock fs
    WHERE fs.id = v_front_stock_id
      AND fs.brand_id = p_brand_id
      AND fs.location_tag = p_location_tag
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Front stock row % not found for location %', v_front_stock_id, p_location_tag;
    END IF;

    v_variance := v_physical_qty - COALESCE(v_row.quantity, 0);

    INSERT INTO public.front_stock_reconciliations (
      brand_id,
      staff_id,
      item_id,
      front_stock_id,
      location_tag,
      system_qty,
      physical_qty,
      variance,
      reason
    ) VALUES (
      p_brand_id,
      p_staff_id,
      v_row.item_id,
      v_row.id,
      v_row.location_tag,
      v_row.quantity,
      v_physical_qty,
      v_variance,
      NULLIF(p_reason, '')
    );

    UPDATE public.front_stock
    SET quantity = v_physical_qty,
        updated_at = now()
    WHERE id = v_row.id;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'reconciled_rows', v_count
  );
END;
$$;

GRANT SELECT, INSERT ON public.front_stock_reconciliations TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_front_stock_take_reconciliation(uuid, uuid, text, jsonb, text) TO anon;
GRANT EXECUTE ON FUNCTION public.record_front_stock_take_reconciliation(uuid, uuid, text, jsonb, text) TO authenticated;

COMMIT;

