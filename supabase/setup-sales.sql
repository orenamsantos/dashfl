-- Run this once in the Supabase SQL Editor for project udzfliimemflstuaauph.
-- Safe to re-run: creates the sales table OR adds any missing columns.

create table if not exists public.sales (
  id text primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales add column if not exists source text;
alter table public.sales add column if not exists checkout text;
alter table public.sales add column if not exists product text;
alter table public.sales add column if not exists product_name text;
alter table public.sales add column if not exists offer text;
alter table public.sales add column if not exists amount numeric;
alter table public.sales add column if not exists net_amount numeric;
alter table public.sales add column if not exists status text;
alter table public.sales add column if not exists payment_method text;
alter table public.sales add column if not exists order_date timestamptz;
alter table public.sales add column if not exists approved_at timestamptz;
alter table public.sales add column if not exists campaign text;
alter table public.sales add column if not exists campaign_name text;
alter table public.sales add column if not exists adset text;
alter table public.sales add column if not exists adset_name text;
alter table public.sales add column if not exists ad text;
alter table public.sales add column if not exists ad_name text;
alter table public.sales add column if not exists utm_source text;
alter table public.sales add column if not exists utm_medium text;
alter table public.sales add column if not exists utm_campaign text;
alter table public.sales add column if not exists utm_content text;
alter table public.sales add column if not exists utm_term text;
alter table public.sales add column if not exists src text;
alter table public.sales add column if not exists sck text;
alter table public.sales add column if not exists affiliate text;
-- raw guarda o payload completo + estado de merge (`__dashfl_merged_items`)
-- pra que bumps em postbacks separados possam ser somados sem schema novo.
alter table public.sales add column if not exists raw jsonb;
alter table public.sales add column if not exists created_at timestamptz not null default now();
alter table public.sales add column if not exists updated_at timestamptz not null default now();

create index if not exists sales_order_date_idx on public.sales (order_date desc);
create index if not exists sales_status_idx on public.sales (status);
create index if not exists sales_campaign_idx on public.sales (utm_campaign);

grant select on public.sales to anon, authenticated;
grant all on public.sales to service_role;

alter table public.sales enable row level security;

drop policy if exists "sales read all" on public.sales;
create policy "sales read all" on public.sales for select using (true);
