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
      .select("id, status, order_date, approved_at, created_at, raw")
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

          // Acumula as correções e grava em LOTE no fim. O Cloudflare Worker tem
          // um teto de ~50 subrequisições por invocação; fazer um UPDATE por
          // linha (127 vendas) estourava o teto e só ~49 gravações passavam — o
          // resto falhava silencioso e o banco não mudava. Um upsert por coluna
          // resolve tudo em 2 subrequisições.
          const orderPatches: { id: string; order_date: string }[] = [];
          const approvedPatches: { id: string; approved_at: string }[] = [];

          for (const row of rows) {
            scanned += 1;

            // Datas do CSV já estão corretas — não mexe.
            if (isCsvSourced(row.raw)) {
              skippedCsv += 1;
              continue;
            }

            let changed = false;
            let fixedExisting = false;

            const od =
              parseTictoDate(pickRaw(row.raw, ORDER_DATE_PATHS)) ??
              row.order_date ??
              row.created_at ??
              null;
            if (od && od !== row.order_date) {
              orderPatches.push({ id: row.id, order_date: od });
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
                approvedPatches.push({ id: row.id, approved_at: ad });
                changed = true;
                if (row.approved_at) fixedExisting = true;
              }
            }

            if (changed) updated += 1;
            else unchanged += 1;
            if (fixedExisting) tzFixed += 1;
          }

          // Grava em blocos (upsert por id só sobrescreve a coluna enviada).
          const CHUNK = 500;
          async function flush(
            records: Record<string, string>[],
          ): Promise<void> {
            for (let i = 0; i < records.length; i += CHUNK) {
              const slice = records.slice(i, i + CHUNK);
              const { error } = await admin
                .from("sales")
                .upsert(slice, { onConflict: "id" });
              if (error) {
                failures.push({
                  id: `chunk@${i}(${slice.length})`,
                  reason: error.message,
                });
              }
            }
          }
          await flush(orderPatches);
          await flush(approvedPatches);

          return json({
            ok: true,
            scanned,
            updated,
            tzFixed,
            unchanged,
            skippedCsv,
            wrote: orderPatches.length + approvedPatches.length,
            failures,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
