-- Grant EXECUTE on process_stock_issue to anon so web clients can call it
grant execute on function public.process_stock_issue(uuid, date, text, jsonb) to anon;
