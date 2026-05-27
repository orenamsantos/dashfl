-- Tabela de taxas configuradas pelo usuário em Configurações > Taxas.
-- Persistida no Supabase para sobreviver a F5 / outro dispositivo.
-- Atenção: o líquido do dashboard NÃO usa estas taxas — vem direto do
-- net_amount (Comissão do Produtor da Ticto). As taxas aqui são só
-- informativas / para cálculos manuais futuros.

create table if not exists public.fees (
  id text primary key,
  name text not null,
  kind text not null check (kind in ('percent', 'fixed')),
  value numeric not null,
  applies_to text not null check (applies_to in ('revenue', 'commission')),
  created_at timestamptz not null default now()
);

-- A escrita acontece SEMPRE via /api/fees (service role), que checa o cookie
-- de autenticação. O cliente só lê com anon. Mantemos uma policy de leitura
-- aberta para o anon poder listar (consistente com o resto do app).
alter table public.fees enable row level security;

drop policy if exists "fees read all" on public.fees;
create policy "fees read all" on public.fees for select using (true);

grant select on public.fees to anon, authenticated;
grant all on public.fees to service_role;
