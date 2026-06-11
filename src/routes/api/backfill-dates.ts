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

          for (const row of rows) {
            scanned += 1;

            // Datas do CSV já estão corretas — não mexe.
            if (isCsvSourced(row.raw)) {
              skippedCsv += 1;
              continue;
            }

            const patch: { order_date?: string; approved_at?: string } = {};

            const od =
              parseTictoDate(pickRaw(row.raw, ORDER_DATE_PATHS)) ??
              row.order_date ??
              row.created_at ??
              null;
            if (od && od !== row.order_date) patch.order_date = od;

            if (isApprovedStatus(row.status)) {
              const ad =
                parseTictoDate(pickRaw(row.raw, APPROVED_DATE_PATHS)) ??
                row.approved_at ??
                row.created_at ??
                null;
              if (ad && ad !== row.approved_at) patch.approved_at = ad;
            }

            if (Object.keys(patch).length === 0) {
              unchanged += 1;
              continue;
            }
            // Conta como correção de fuso quando a data já existia e mudou.
            if (
              (patch.order_date && row.order_date) ||
              (patch.approved_at && row.approved_at)
            ) {
              tzFixed += 1;
            }
            const { error: upErr } = await admin
              .from("sales")
              .update(patch)
              .eq("id", row.id);
            if (upErr) failures.push({ id: row.id, reason: upErr.message });
            else updated += 1;
          }

          return json({
            ok: true,
            scanned,
            updated,
            tzFixed,
            unchanged,
            skippedCsv,
            failures,
          });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
