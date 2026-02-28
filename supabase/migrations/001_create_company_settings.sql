-- Migration: create company_settings table
-- Creates a single-row (or multi-tenant) company settings table for branding.
-- Adjust `tenant_id` usage for multi-tenant deployments.

-- Enable gen_random_uuid() if not available
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS company_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL, -- optional: scope to tenant when multi-tenant
  name text NOT NULL,
  tagline text,
  primary_color_hex varchar(7) NOT NULL DEFAULT '#2563eb',
  logo_url text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- If multi-tenant, enforce one row per tenant by adding a unique index:
-- CREATE UNIQUE INDEX ON company_settings (tenant_id) WHERE tenant_id IS NOT NULL;

-- Trigger to refresh updated_at on UPDATE
CREATE OR REPLACE FUNCTION company_settings_refresh_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_company_settings_updated_at ON company_settings;
CREATE TRIGGER trg_company_settings_updated_at
BEFORE UPDATE ON company_settings
FOR EACH ROW
EXECUTE PROCEDURE company_settings_refresh_updated_at();

-- Optional: seed a default row for single-tenant deployments (commented out)
-- INSERT INTO company_settings (name, tagline, primary_color_hex)
-- VALUES ('Mthunzi-Smart', 'Back Office + POS', '#2563eb')
-- ON CONFLICT DO NOTHING;

-- Notes:
-- 1) For Supabase, consider using RLS policies that allow an anonymous INSERT
--    only when no rows exist (initial setup), then require authenticated
--    access for subsequent UPDATEs.
-- 2) Store logos in Supabase Storage and save the public `logo_url` here.
