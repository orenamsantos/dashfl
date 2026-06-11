import { supabase } from "./supabase";

// O PostgREST do Supabase tem um teto de ~1000 linhas POR REQUISIÇÃO que
// ignora silenciosamente .limit() maiores. Quando a tabela `sales` cruzou
// 1000 linhas (abandonos/pendentes do webhook acumulando), os fetches com
// .limit(10000) passaram a receber um SUBCONJUNTO arbitrário — e o
// faturamento do dashboard "bugava" conforme o recorte que vinha.
// Este helper busca TODAS as linhas paginando de 1000 em 1000, com ordem
// estável por `id` (único) pra nenhuma página repetir ou pular linha.
const PAGE = 1000;
// Teto de segurança (50k linhas) contra loop infinito se algo mudar no backend.
const MAX_PAGES = 50;

export interface FetchSalesOpts {
  // Filtra por status NO SERVIDOR (ex.: só "Aprovada"/"Reembolsada"). Crucial
  // pros KPIs: corta o lixo de webhook (abandono/expirado/recusado) antes de
  // descer pro cliente, mantendo o conjunto pequeno e estável — longe do teto
  // de 1000 linhas que causava o faturamento instável.
  statusIn?: readonly string[];
}

export async function fetchAllSales<T>(
  columns: string,
  opts: FetchSalesOpts = {},
): Promise<T[]> {
  if (!supabase) return [];
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    let query = supabase
      .from("sales")
      .select(columns)
      .order("id", { ascending: true });
    if (opts.statusIn && opts.statusIn.length > 0) {
      query = query.in("status", opts.statusIn as string[]);
    }
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
