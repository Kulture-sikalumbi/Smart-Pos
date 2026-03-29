-- Diagnostics: Check grants, RLS and function execute privileges for stock tables
-- Run this in the Supabase SQL editor to inspect current permissions and RLS status.

-- 1) Table grants for stock_items and stock_issues
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN ('stock_items', 'stock_issues')
ORDER BY table_name, grantee, privilege_type;

-- 2) Row-Level Security flags
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE n.nspname = 'public'
  AND c.relname IN ('stock_items', 'stock_issues');

-- 3) Function ACLs (shows raw proacl array which lists which roles have EXECUTE)
SELECT p.proname AS function_name, p.proacl
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('process_stock_issue', 'insert_stock_issue');

-- 4) Verify the `anon` and `authenticated` roles exist
SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated');

-- 5) Quick boolean checks for expected grants
SELECT
  EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='stock_items' AND grantee='authenticated' AND privilege_type='UPDATE'
  ) AS auth_update_stock_items,
  EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='stock_items' AND grantee='anon' AND privilege_type='UPDATE'
  ) AS anon_update_stock_items,
  EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='stock_issues' AND grantee='authenticated' AND privilege_type='INSERT'
  ) AS auth_insert_stock_issues,
  EXISTS(
    SELECT 1 FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name='stock_issues' AND grantee='anon' AND privilege_type='INSERT'
  ) AS anon_insert_stock_issues;

-- 6) Check EXECUTE privilege on the RPC using has_function_privilege (returns boolean)
SELECT
  has_function_privilege('authenticated', 'public.process_stock_issue(uuid, date, text, jsonb)', 'EXECUTE') AS auth_exec_process_stock_issue,
  has_function_privilege('anon', 'public.process_stock_issue(uuid, date, text, jsonb)', 'EXECUTE') AS anon_exec_process_stock_issue;
