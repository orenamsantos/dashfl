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

export async function fetchAllSales<T>(columns: string): Promise<T[]> {
  if (!supabase) return [];
  const all: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await supabase
      .from("sales")
      .select(columns)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}
