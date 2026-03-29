-- Grant table privileges to the authenticated role so web clients can access brand-scoped rows
-- Apply this in the Supabase SQL editor or with the supabase CLI.

GRANT SELECT ON public.stock_items TO authenticated;
GRANT UPDATE ON public.stock_items TO authenticated;
GRANT INSERT ON public.stock_issues TO authenticated;
GRANT SELECT ON public.stock_issues TO authenticated;
