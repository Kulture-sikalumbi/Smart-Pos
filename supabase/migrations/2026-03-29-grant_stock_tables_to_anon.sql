-- TEMPORARY: Grant minimal privileges to anon for testing only
-- WARNING: Granting to `anon` allows unauthenticated web clients to perform these actions.
-- Use only for local/testing, or remove after switching clients to authenticated sessions.

GRANT EXECUTE ON FUNCTION public.process_stock_issue(uuid, date, text, jsonb) TO anon;
GRANT SELECT, UPDATE ON public.stock_items TO anon;
GRANT SELECT, INSERT ON public.stock_issues TO anon;
