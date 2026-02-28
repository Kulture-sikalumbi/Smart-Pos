-- Migration: create brands table
-- Stores created brands linked to users (owner/creator)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NULL, -- user who created/owns the brand (references your users table)
  name text NOT NULL,
  tagline text,
  primary_color_hex varchar(7) NOT NULL DEFAULT '#2563eb',
  logo_path text, -- storage path or public URL for uploaded logo
  metadata jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trigger to refresh updated_at on UPDATE
CREATE OR REPLACE FUNCTION brands_refresh_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_brands_updated_at ON brands;
CREATE TRIGGER trg_brands_updated_at
BEFORE UPDATE ON brands
FOR EACH ROW
EXECUTE PROCEDURE brands_refresh_updated_at();

-- Notes:
-- * `owner_id` can be linked to your staff/users table; add a FOREIGN KEY if desired.
-- * `logo_path` should store the Supabase Storage path (e.g. "branding-logos/company_<id>.png")
-- * Consider RLS policies that allow anonymous INSERT only when no brands exist,
--   or require authenticated creation and link the `owner_id` to `auth.uid`.
