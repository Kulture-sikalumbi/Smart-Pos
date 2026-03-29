-- Ensure web clients (authenticated role) have necessary table privileges
-- Granting these allows client-side code to read/update `stock_items` and
-- insert/select `stock_issues` when requests run as the `authenticated` role.

GRANT SELECT, UPDATE ON public.stock_items TO authenticated;
GRANT SELECT, INSERT ON public.stock_issues TO authenticated;
