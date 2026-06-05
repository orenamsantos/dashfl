import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";

// Reprocessa o BRUTO (amount) das vendas gravadas pelo webhook, recalculando
// item + bumps a partir do `raw` salvo. Conserta linhas que ficaram infladas
// pelo bug antigo (mudança de status somava o valor de novo). NUNCA toca em
// linhas travadas por CSV (__dashfl_source === "csv": o CSV é autoritativo),
// nem zera um valor bom (só atualiza quando o recálculo dá > 0 e difere).
// Idempotente.

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin credentials missing on server");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function centsToReais(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n / 100 : 0;
}
function parseReais(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}
function pick(obj: any, ...keys: string[]): unknown {
  for (const k of keys) {
    let cur: any = obj;
    for (const p of k.split(".")) cur = cur?.[p];
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}
// Mesmos critérios do webhook: só arrays de bump de verdade (nunca items[]).
function extraItems(payload: any): any[] {
  const out: any[] = [];
  for (const key of ["bumps", "order_bumps"]) {
    const v = payload?.[key];
    if (Array.isArray(v)) out.push(...v);
  }
  for (const key of ["order", "transaction"]) {
    const nested = payload?.[key];
    if (nested) {
      for (const sub of ["bumps", "order_bumps"]) {
        const v = nested?.[sub];
        if (Array.isArray(v)) out.push(...v);
      }
    }
  }
  return out;
}
function sumBumps(payload: any): number {
  let total = 0;
  for (const b of extraItems(payload)) {
    const reaisStr = b?.offer_price ?? b?.price;
    if (reaisStr != null && String(reaisStr).trim() !== "") {
      total += parseReais(reaisStr);
      continue;
    }
    const cents = b?.amount ?? b?.amount_cents;
    if (cents != null && String(cents).trim() !== "") total += centsToReais(cents);
  }
  return total;
}
// Bruto autoritativo do payload: item (centavos) + bumps. Retorna null se o
// payload não tem valor de item (não dá pra recalcular com segurança).
function grossFromRaw(raw: any): number | null {
  if (!raw || typeof raw !== "object") return null;
  const itemRaw = pick(raw, "item.amount", "item.price", "transaction.amount");
  if (itemRaw == null) return null;
  const gross = centsToReais(itemRaw) + sumBumps(raw);
  return gross > 0 ? gross : null;
}

export const Route = createFileRoute("/api/backfill-gross")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        try {
          const admin = getAdmin();
          const { data, error } = await admin
            .from("sales")
            .select("id, amount, raw")
            .not("raw", "is", null)
            .limit(10000);
          if (error) return json({ error: error.message }, 500);

          let scanned = 0;
          let updated = 0;
          let skipped = 0;
          const failures: { id: string; reason: string }[] = [];

          for (const row of (data ?? []) as Array<{
            id: string;
            amount: number | null;
            raw: any;
          }>) {
            scanned += 1;
            // CSV é autoritativo: não recalcula.
            if (row.raw?.__dashfl_source === "csv") {
              skipped += 1;
              continue;
            }
            const gross = grossFromRaw(row.raw);
            if (gross == null) {
              skipped += 1;
              continue;
            }
            // só atualiza se mudou (tolerância de 1 centavo)
            if (Math.abs(gross - Number(row.amount ?? 0)) < 0.01) {
              skipped += 1;
              continue;
            }
            const { error: upErr } = await admin
              .from("sales")
              .update({ amount: gross })
              .eq("id", row.id);
            if (upErr) failures.push({ id: row.id, reason: upErr.message });
            else updated += 1;
          }

          return json({ ok: true, scanned, updated, skipped, failures });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
