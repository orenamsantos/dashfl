import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";
import { isApprovedStatus } from "@/lib/status";
import {
  parseTictoDate,
  pickRaw,
  isCsvSourced,
  ORDER_DATE_PATHS,
  APPROVED_DATE_PATHS,
} from "@/lib/ticto-date";

// Reprocessa order_date / approved_at RE-DERIVANDO do payload `raw` salvo, com
// o parser de data CORRIGIDO (fuso de Brasília). Conserta dois problemas:
//   1. FUSO: linhas gravadas pelo webhook antigo ficaram 3h adiantadas (a Ticto
//      manda horário de Brasília sem fuso e o parser tratava como UTC) — então
//      vendas da madrugada caíam no dia anterior do dashboard.
//   2. NULL: linhas que ficaram sem data por mapeamento antigo.
// Linhas vindas do CSV (`raw.__dashfl_source === "csv"`) NÃO são tocadas: as
// datas delas já vêm certas do import. Só sobrescreve quando o valor re-derivado
// existe (nunca apaga uma data boa com null). Idempotente.

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing on server");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface SaleRow {
  id: string;
  status: string | null;
  order_date: string | null;
  approved_at: string | null;
  created_at: string | null;
  raw: unknown;
  // Selecionamos a linha INTEIRA (select *) pra re-upsert: o upsert dispara o
  // caminho de INSERT do "ON CONFLICT" e a tabela tem colunas NOT NULL (ex.
  // `checkout`) — mandar a linha completa preenche todas e a gravação passa.
  [key: string]: unknown;
}

// O PostgREST corta em ~1000 linhas/request; paginamos por `id` pra varrer tudo.
const PAGE = 1000;
const MAX_PAGES = 50;

async function fetchAll(
  admin: ReturnType<typeof getAdmin>,
): Promise<SaleRow[]> {
  const all: SaleRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    const { data, error } = await admin
      .from("sales")
      .select("*")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as SaleRow[];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  return all;
}

export const Route = createFileRoute("/api/backfill-dates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        try {
          const admin = getAdmin();
          const rows = await fetchAll(admin);

          let scanned = 0;
          let updated = 0;
          let unchanged = 0;
          let skippedCsv = 0;
          let tzFixed = 0;
          const failures: { id: string; reason: string }[] = [];

          // Re-upsert da linha INTEIRA com as datas corrigidas, gravado em LOTE.
          // Dois motivos pra linha inteira + lote:
          //  - O Cloudflare Worker corta em ~50 subrequisições/invocação; um
          //    UPDATE por linha (127 vendas) estourava e só ~49 passavam.
          //  - O upsert dispara o INSERT do "ON CONFLICT"; a tabela tem colunas
          //    NOT NULL (ex. `checkout`), então mandar só {id, data} era rejeitado.
          //    A linha completa (lida do banco) já traz todas preenchidas.
          const toUpsert: Record<string, unknown>[] = [];

          for (const row of rows) {
            scanned += 1;

            // Datas do CSV já estão corretas — não mexe.
            if (isCsvSourced(row.raw)) {
              skippedCsv += 1;
              continue;
            }

            const next: Record<string, unknown> = { ...row };
            let changed = false;
            let fixedExisting = false;

            const od =
              parseTictoDate(pickRaw(row.raw, ORDER_DATE_PATHS)) ??
              row.order_date ??
              row.created_at ??
              null;
            if (od && od !== row.order_date) {
              next.order_date = od;
              changed = true;
              if (row.order_date) fixedExisting = true;
            }

            if (isApprovedStatus(row.status)) {
              const ad =
                parseTictoDate(pickRaw(row.raw, APPROVED_DATE_PATHS)) ??
                row.approved_at ??
                row.created_at ??
                null;
              if (ad && ad !== row.approved_at) {
                next.approved_at = ad;
                changed = true;
                if (row.approved_at) fixedExisting = true;
              }
            }

            if (changed) {
              updated += 1;
              toUpsert.push(next);
            } else {
              unchanged += 1;
            }
            if (fixedExisting) tzFixed += 1;
          }

          // Grava em blocos (poucas subrequisições). Se algum bloco falhar por
          // uma coluna que não pode ir no upsert, tenta de novo sem `raw`.
          const CHUNK = 500;
          for (let i = 0; i < toUpsert.length; i += CHUNK) {
            const slice = toUpsert.slice(i, i + CHUNK);
            let { error } = await admin
              .from("sales")
              .upsert(slice, { onConflict: "id" });
            if (error) {
              const stripped = slice.map(({ raw: _omit, ...rest }) => rest);
              ({ error } = await admin
                .from("sales")
                .upsert(stripped, { onConflict: "id" }));
            }
            if (error) {
              failures.push({
                id: `chunk@${i}(${slice.length})`,
                reason: error.message,
              });
            }
          }

          return json({
            ok: true,
            scanned,
            updated,
            tzFixed,
            unchanged,
            skippedCsv,
            wrote: toUpsert.length,
            failures,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
