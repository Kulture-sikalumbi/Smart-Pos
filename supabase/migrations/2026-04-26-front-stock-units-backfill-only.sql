-- 2026-04-26-front-stock-units-backfill-only.sql
-- Minimal/safe fix: normalize unit labels in front_stock only.
-- Does NOT replace shared trigger/RPC functions.

BEGIN;

-- Normalize unit labels for stock-item-backed rows only.
-- Quantities are not changed; only textual unit labels are aligned to highest/base unit.
UPDATE public.front_stock fs
SET unit = CASE
  WHEN lower(trim(coalesce(si.unit, ''))) IN ('g', 'gram', 'grams', 'kg') THEN 'kg'
  WHEN lower(trim(coalesce(si.unit, ''))) IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'l', 'ltr', 'ltrs') THEN 'l'
  WHEN lower(trim(coalesce(si.unit, ''))) = 'pack' THEN 'pack'
  ELSE 'each'
END
FROM public.stock_items si
WHERE fs.item_id = si.id
  AND fs.brand_id = si.brand_id
  AND (
    fs.unit IS NULL
    OR lower(trim(fs.unit)) <> CASE
      WHEN lower(trim(coalesce(si.unit, ''))) IN ('g', 'gram', 'grams', 'kg') THEN 'kg'
      WHEN lower(trim(coalesce(si.unit, ''))) IN ('ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres', 'l', 'ltr', 'ltrs') THEN 'l'
      WHEN lower(trim(coalesce(si.unit, ''))) = 'pack' THEN 'pack'
      ELSE 'each'
    END
  );

COMMIT;

