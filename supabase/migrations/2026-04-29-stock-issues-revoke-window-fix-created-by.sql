-- Fix revoke_stock_issue_batch type mismatch: stock_issues.created_by is uuid.
-- Compare UUID column to passed value safely using text casts.

begin;

create or replace function public.revoke_stock_issue_batch(
  p_brand_id uuid,
  p_created_at timestamptz,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_count int := 0;
  v_now timestamptz := now();
  v_created timestamptz;
  v_window interval := interval '5 minutes';
begin
  if p_brand_id is null then
    raise exception 'Missing brand id';
  end if;
  if p_created_at is null then
    raise exception 'Missing created_at';
  end if;
  if p_created_by is null or length(trim(p_created_by)) = 0 then
    raise exception 'Missing created_by';
  end if;

  v_created := p_created_at;

  if v_now - v_created > v_window then
    return jsonb_build_object('ok', false, 'error', 'revoke_window_expired');
  end if;

  -- Allow stock mutations inside this SECURITY DEFINER RPC (guard trigger expects this).
  perform set_config('pmx.allow_stock_mutation', '1', true);

  for r in
    select id, stock_item_id, issue_type, qty_issued
    from public.stock_issues
    where brand_id = p_brand_id
      and created_at = p_created_at
      and coalesce(created_by::text, '') = trim(p_created_by)
    for update
  loop
    update public.stock_items
    set current_stock = current_stock + r.qty_issued,
        updated_at = now()
    where id = r.stock_item_id
      and brand_id = p_brand_id;

    if r.issue_type = 'Sale' then
      update public.front_stock
      set quantity = greatest(0, quantity - r.qty_issued),
          updated_at = now()
      where brand_id = p_brand_id
        and item_id = r.stock_item_id
        and location_tag = 'SALE';
    elsif r.issue_type = 'Manufacturing' then
      update public.front_stock
      set quantity = greatest(0, quantity - r.qty_issued),
          updated_at = now()
      where brand_id = p_brand_id
        and item_id = r.stock_item_id
        and location_tag = 'MANUFACTURING';
    end if;

    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'no_rows');
  end if;

  delete from public.stock_issues
  where brand_id = p_brand_id
    and created_at = p_created_at
    and coalesce(created_by::text, '') = trim(p_created_by);

  return jsonb_build_object('ok', true, 'revoked_lines', v_count);
end;
$$;

grant execute on function public.revoke_stock_issue_batch(uuid, timestamptz, text) to authenticated;

commit;

