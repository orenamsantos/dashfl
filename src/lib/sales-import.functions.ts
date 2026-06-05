import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";

function toFiniteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mergeTextValue(current: unknown, incoming: unknown) {
  const a = typeof current === "string" ? current.trim() : "";
  const b = typeof incoming === "string" ? incoming.trim() : "";
  if (!a) return b || current;
  if (!b || a === b) return current;
  return `${a} + ${b}`;
}

function pickPreferredValue(current: unknown, incoming: unknown) {
  if (current == null || current === "") return incoming;
  return current;
}

function getClient() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  // Escrita na tabela `sales` (RLS ligada, anon só tem SELECT) EXIGE service_role.
  // Sem fallback para anon: senão o upsert falha silenciosamente (importa 0).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("SUPABASE_URL não configurada no servidor");
  if (!key)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY não configurada no servidor (necessária para gravar vendas)",
    );
  return createClient(url, key, { auth: { persistSession: false } });
}

export const importSalesBatch = createServerFn({ method: "POST" })
  .inputValidator((data: { rows: Array<Record<string, unknown>> }) => {
    if (!data || !Array.isArray(data.rows)) throw new Error("rows must be an array");
    if (data.rows.length > 500) throw new Error("Batch too large (max 500)");
    return data;
  })
  .handler(async ({ data }) => {
    const client = getClient();
    if (data.rows.length === 0)
      return { inserted: 0, updated: 0, failed: 0, dedup: 0, errors: [] };

    // Garantir que external_id esteja preenchido (coluna NOT NULL na tabela sales)
    // e agrupar múltiplos itens do mesmo pedido/transação em uma única venda.
    const normalizedRows = data.rows.map((r) => {
      const row = { ...(r as Record<string, unknown>) };
      const id = row.id != null ? String(row.id).trim() : null;
      row.id = id;
      if (row.external_id == null || row.external_id === "") {
        row.external_id = id;
      }
      return row;
    });

    const rowsById = new Map<string, Record<string, unknown>>();
    for (const row of normalizedRows) {
      const id = typeof row.id === "string" ? row.id : null;
      if (!id) continue;

      // `existing` aqui é o acumulador EM MEMÓRIA das linhas deste arquivo
      // (não é o valor do banco). Somar produto + order bump do mesmo pedido
      // é o comportamento correto; o total resultante depois SUBSTITUI a
      // linha no banco via upsert (não soma com o que já está gravado).
      const existing = rowsById.get(id);
      if (!existing) {
        rowsById.set(id, row);
        continue;
      }

      existing.amount = toFiniteNumber(existing.amount) + toFiniteNumber(row.amount);
      existing.net_amount =
        toFiniteNumber(existing.net_amount) + toFiniteNumber(row.net_amount);
      existing.product = mergeTextValue(existing.product, row.product);
      existing.product_name = mergeTextValue(existing.product_name, row.product_name);
      existing.offer = mergeTextValue(existing.offer, row.offer);
      existing.status = pickPreferredValue(
        String(existing.status ?? "").trim().toLowerCase() === "pendente" && row.status
          ? row.status
          : existing.status,
        row.status,
      );
      existing.payment_method = pickPreferredValue(existing.payment_method, row.payment_method);
      existing.order_date = pickPreferredValue(existing.order_date, row.order_date);
      existing.approved_at = pickPreferredValue(existing.approved_at, row.approved_at);
      existing.campaign = pickPreferredValue(existing.campaign, row.campaign);
      existing.campaign_name = pickPreferredValue(existing.campaign_name, row.campaign_name);
      existing.adset = pickPreferredValue(existing.adset, row.adset);
      existing.adset_name = pickPreferredValue(existing.adset_name, row.adset_name);
      existing.ad = pickPreferredValue(existing.ad, row.ad);
      existing.ad_name = pickPreferredValue(existing.ad_name, row.ad_name);
      existing.utm_source = pickPreferredValue(existing.utm_source, row.utm_source);
      existing.utm_medium = pickPreferredValue(existing.utm_medium, row.utm_medium);
      existing.utm_campaign = pickPreferredValue(existing.utm_campaign, row.utm_campaign);
      existing.utm_content = pickPreferredValue(existing.utm_content, row.utm_content);
      existing.utm_term = pickPreferredValue(existing.utm_term, row.utm_term);
      existing.src = pickPreferredValue(existing.src, row.src);
      existing.sck = pickPreferredValue(existing.sck, row.sck);
      existing.affiliate = pickPreferredValue(existing.affiliate, row.affiliate);
    }
    // CSV é a fonte autoritativa: marcamos cada linha com __dashfl_source.
    // O webhook da Ticto checa esse marcador e, quando presente, NÃO soma
    // amount/net_amount por cima (só atualiza status/datas), evitando que um
    // postback de bump tardio infle o valor já consolidado pelo CSV.
    // order_code (Código do Pedido) é só pra dedup contra o webhook; NÃO é
    // coluna da tabela, então sai do payload do upsert.
    const orderCodes = [
      ...new Set(
        [...rowsById.values()]
          .map((r) => (r.order_code ? String(r.order_code).trim() : ""))
          .filter(Boolean),
      ),
    ];
    const rows = [...rowsById.values()].map((r): Record<string, unknown> => {
      const { order_code: _oc, ...rest } = r as Record<string, unknown>;
      return {
        ...rest,
        raw: {
          ...((rest.raw as Record<string, unknown>) ?? {}),
          __dashfl_source: "csv",
        },
      };
    });
    if (rows.length === 0) {
      return {
        inserted: 0,
        updated: 0,
        failed: data.rows.length,
        dedup: 0,
        errors: [{ id: null, message: "Nenhuma linha válida com ID foi enviada para importação." }],
      };
    }

    const ids = rows.map((r) => String((r as { id: unknown }).id));
    // Só lemos `id` para distinguir inserts de updates na contagem. NUNCA
    // lemos amount/net_amount do banco: o valor consolidado do ARQUIVO é a
    // fonte da verdade e SUBSTITUI o que está gravado (ver upsert abaixo).
    const { data: existing, error: selErr } = await client
      .from("sales")
      .select("id")
      .in("id", ids);
    if (selErr) {
      return {
        inserted: 0,
        updated: 0,
        failed: data.rows.length,
        dedup: 0,
        errors: [{ id: null, message: selErr.message }],
      };
    }
    const existingSet = new Set((existing ?? []).map((r: { id: string }) => r.id));

    // ON CONFLICT (id) DO UPDATE SET col = EXCLUDED.col → cada coluna recebe o
    // valor do arquivo (overwrite). amount/net_amount NÃO são somados com o
    // que já existe no banco; uma reimportação do mesmo arquivo é idempotente.
    // `ignoreDuplicates: false` é o padrão, mas explicitamos para que ninguém
    // troque para `true` (que faria DO NOTHING e perderia atualizações).
    const { error: upErr } = await client
      .from("sales")
      .upsert(rows, { onConflict: "id", ignoreDuplicates: false });

    if (upErr) {
      // retry without `raw` column if it doesn't exist in schema
      const stripped = rows.map((r) => {
        const { raw: _omit, ...rest } = r as Record<string, unknown>;
        return rest;
      });
      const retry = await client
        .from("sales")
        .upsert(stripped, { onConflict: "id", ignoreDuplicates: false });
      if (retry.error) {
        return {
          inserted: 0,
          updated: 0,
          failed: data.rows.length,
          dedup: 0,
          errors: [{ id: null, message: retry.error.message }],
        };
      }
    }

    // DEDUP webhook×CSV: remove linhas-fantasma que o webhook gravou usando o
    // id do PEDIDO (Código do Pedido, ex. TO...) em vez do id da TRANSAÇÃO
    // (ex. TP..., que o CSV usa). Uma venda real nunca tem id no formato de
    // pedido, então qualquer linha cujo id seja um order_code deste lote é a
    // mesma venda gravada em dobro pelo webhook. Só apaga os que NÃO são um
    // id de transação que acabamos de gravar.
    let dedup = 0;
    const importedIds = new Set(ids);
    const orphanIds = orderCodes.filter((c) => !importedIds.has(c));
    if (orphanIds.length > 0) {
      const { data: removed } = await client
        .from("sales")
        .delete()
        .in("id", orphanIds)
        .select("id");
      dedup = removed?.length ?? 0;
    }

    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      if (existingSet.has(String((r as { id: unknown }).id))) updated++;
      else inserted++;
    }
    return {
      inserted,
      updated,
      failed: 0,
      dedup,
      errors: [] as { id: string | null; message: string }[],
    };
  });
