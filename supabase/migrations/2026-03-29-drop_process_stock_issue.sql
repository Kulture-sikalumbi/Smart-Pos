-- Drop the process_stock_issue RPC and remove execute grants
-- Run this in your Supabase SQL editor to remove the function from the DB.

-- Revoke execute grants (safe to run even if grants are missing)
REVOKE EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb) FROM authenticated;

-- Drop the function if it exists
DROP FUNCTION IF EXISTS public.process_stock_issue(uuid, date, text, jsonb) CASCADE;
