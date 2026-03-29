-- Debug RPC wrapper for `process_stock_issue`
-- Returns JSON { ok: true } on success or { ok: false, message, code } on error
-- Use this during debugging to get structured error info instead of a PostgREST 403.

create or replace function public.process_stock_issue_debug(
  p_brand_id uuid,
  p_date date,
  p_created_by text,
  p_lines jsonb
) returns json as $$
declare
begin
  perform public.process_stock_issue(p_brand_id, p_date, p_created_by, p_lines);
  return json_build_object('ok', true);
exception when others then
  return json_build_object(
    'ok', false,
    'message', sqlerrm,
    'code', sqlstate
  );
end;
$$ language plpgsql security definer
SET search_path = public, pg_catalog;

-- Grant execute to roles used by clients when debugging. Remove anon grant in production.
GRANT EXECUTE ON FUNCTION public.process_stock_issue_debug(uuid, date, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.process_stock_issue_debug(uuid, date, text, jsonb) TO anon;
