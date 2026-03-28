-- Migration: 014_create_pos_notifications.sql
-- Purpose: Create a simple notifications table for brand-scoped realtime notifications

-- Ensure pgcrypto is available for gen_random_uuid()
create extension if not exists pgcrypto;

create table if not exists public.pos_notifications (
  id uuid default gen_random_uuid() primary key,
  brand_id text not null,
  type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists pos_notifications_brand_idx on public.pos_notifications (brand_id);
create index if not exists pos_notifications_type_idx on public.pos_notifications (type);
create index if not exists pos_notifications_created_at_idx on public.pos_notifications (created_at);

-- Note: If your Supabase project uses Row Level Security (RLS), add policies
-- to allow the browser client role (or an RPC) to insert/select as required.
-- Example (adjust role/conditions to your security model):
-- alter table public.pos_notifications enable row level security;
-- create policy "allow_insert_for_service_role" on public.pos_notifications for insert using (true);

-- If you prefer to only allow inserts from server-side (recommended), create an RPC
-- that inserts the notification and call it from server-side code instead of
-- allowing anonymous web clients to insert directly.
