create table public.staff (
  id uuid not null default gen_random_uuid (),
  user_id uuid null,
  brand_id uuid,
  role text not null default 'waitron'::text,
  display_name text null,
  email text null,
  is_active boolean null default true,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  constraint staff_pkey primary key (id),
  constraint staff_user_id_key unique (user_id),
  constraint staff_brand_id_fkey foreign KEY (brand_id) references brands (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_staff_brand_id on public.staff using btree (brand_id) TABLESPACE pg_default;

create trigger set_updated_at_trigger BEFORE
update on staff for EACH row
execute FUNCTION set_updated_at ();