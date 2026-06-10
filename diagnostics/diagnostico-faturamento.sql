-- DIAGNÓSTICO do faturamento (somente leitura, não altera nada).
-- Rodar inteiro no SQL Editor do Supabase (projeto udzfliimemflstuaauph)
-- e copiar a tabela de resultado completa.

with aprovadas as (
  select * from public.sales
  where lower(coalesce(status, '')) = 'aprovada'
),
sem_lock as (
  select * from aprovadas
  where coalesce(raw->>'__dashfl_source', '') <> 'csv'
)

-- ===== visão geral =====
select 10 as ord, 'total_linhas_tabela' as metrica,
       count(*)::text as valor
from public.sales

union all
select 11, 'status_distribuicao',
       string_agg(s || '=' || c, ' | ' order by c desc)
from (select coalesce(status,'(null)') s, count(*)::text c
      from public.sales group by 1) t

union all
select 12, 'prefixos_de_id',
       string_agg(p || '=' || c, ' | ' order by c desc)
from (select left(id, 3) p, count(*)::text c
      from public.sales group by 1 order by count(*) desc limit 8) t

-- ===== totais (devem bater com a planilha) =====
union all
select 20, 'aprovadas_qtd', count(*)::text from aprovadas
union all
select 21, 'bruto_total', round(sum(amount)::numeric, 2)::text from aprovadas
union all
select 22, 'liquido_total', round(sum(net_amount)::numeric, 2)::text from aprovadas

-- ===== quem NÃO veio do CSV (= escrito pelo webhook depois do import) =====
union all
select 30, 'aprovadas_sem_lock_csv_qtd', count(*)::text from sem_lock
union all
select 31, 'bruto_sem_lock_csv', round(coalesce(sum(amount),0)::numeric, 2)::text from sem_lock
union all
select 32, 'liquido_sem_lock_csv', round(coalesce(sum(net_amount),0)::numeric, 2)::text from sem_lock

-- ===== fantasmas: id com formato de PEDIDO (TO...) em vez de transação (TP...) =====
union all
select 40, 'fantasmas_TO_qtd', count(*)::text from public.sales where id like 'TO%'
union all
select 41, 'fantasmas_TO_aprovados_qtd', count(*)::text
from public.sales where id like 'TO%' and lower(coalesce(status,'')) = 'aprovada'
union all
select 42, 'fantasmas_TO_aprovados_bruto', round(coalesce(sum(amount),0)::numeric,2)::text
from public.sales where id like 'TO%' and lower(coalesce(status,'')) = 'aprovada'

-- ===== merge_sum: linhas onde o webhook somou mais de um "item" =====
union all
select 50, 'merge_sum_qtd (merged_items>1)', count(*)::text
from public.sales
where jsonb_array_length(coalesce(raw->'__dashfl_merged_items', '[]'::jsonb)) > 1
union all
select 51, 'merge_sum_aprovadas_bruto', round(coalesce(sum(amount),0)::numeric,2)::text
from public.sales
where jsonb_array_length(coalesce(raw->'__dashfl_merged_items', '[]'::jsonb)) > 1
  and lower(coalesce(status,'')) = 'aprovada'

-- ===== faturamento por dia (fuso SP) — comparar com a planilha =====
union all
select 60 + row_number() over (order by d), 'dia ' || d,
       'bruto ' || b || ' | liq ' || l || ' | vendas ' || n
from (
  select to_char((coalesce(approved_at, order_date, created_at)) at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') d,
         round(sum(amount)::numeric, 2)::text b,
         round(sum(net_amount)::numeric, 2)::text l,
         count(*)::text n
  from aprovadas
  where coalesce(approved_at, order_date, created_at) >= now() - interval '9 days'
  group by 1
) t

-- ===== suspeitas: aprovadas sem lock CSV dos últimos 4 dias (até 12) =====
union all
select 80 + row_number() over (order by created_at desc), 'suspeita',
       id || ' | R$ ' || coalesce(round(amount::numeric,2)::text, '-')
          || ' | liq ' || coalesce(round(net_amount::numeric,2)::text, '-')
          || ' | itens_merged=' || coalesce(jsonb_array_length(raw->'__dashfl_merged_items')::text, '?')
          || ' | item_raw=' || coalesce((raw->'item'->>'amount'), '?')
          || ' | bumps_raw=' || coalesce(jsonb_array_length(raw->'bumps')::text, '0')
          || ' | ' || to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
from (
  select * from sem_lock
  where created_at >= now() - interval '4 days'
  order by created_at desc
  limit 12
) s

order by ord;
