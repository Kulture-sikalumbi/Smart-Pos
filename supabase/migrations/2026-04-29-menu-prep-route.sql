-- Add menu preparation routing to support kitchen vs direct-sale behavior.
-- This keeps a single order/payment flow while allowing non-kitchen items.

begin;

-- Public schema (current primary menu source in this project)
alter table if exists public.products
  add column if not exists prep_route text not null default 'kitchen';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'products'
      and column_name = 'prep_route'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'products_prep_route_chk'
    ) then
      alter table public.products
        add constraint products_prep_route_chk
        check (prep_route in ('kitchen', 'direct_sale'));
    end if;
  end if;
end $$;

-- Legacy ERP schema compatibility
alter table if exists erp.pos_menu_items
  add column if not exists prep_route text not null default 'kitchen';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'erp'
      and table_name = 'pos_menu_items'
      and column_name = 'prep_route'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'pos_menu_items_prep_route_chk'
    ) then
      alter table erp.pos_menu_items
        add constraint pos_menu_items_prep_route_chk
        check (prep_route in ('kitchen', 'direct_sale'));
    end if;
  end if;
end $$;

commit;
