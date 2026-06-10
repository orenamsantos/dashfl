import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";
import { isApprovedStatus } from "@/lib/status";

// Reprocessa o líquido (net_amount) das vendas aprovadas que ficaram com 0
// por causa do bug 2 (Ticto v2 trocou o campo). Usa o `raw` salvo no banco
// pra extrair producer.amount (centavos) ou producer.cms (reais string).
// Idempotente: pode rodar várias vezes. Pula linhas sem `raw` ou onde o
// novo cálculo não bateu (mantém o valor existente).

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

function centsToReais(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return n / 100;
}

function parseReais(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function pickProducer(raw: any): number | null {
  if (!raw || typeof raw !== "object") return null;
  // `owner_commissions[]` (centavos por item: principal + bumps) é o líquido
  // autoritativo do produtor. producer.amount/cms cobre só o principal e perdia
  // a comissão dos bumps em combos — usar o array conserta o líquido baixo.
  const arr = raw?.owner_commissions;
  if (Array.isArray(arr) && arr.length > 0) {
    let total = 0;
    let found = false;
    for (const c of arr) {
      const cents = c?.commission_amount;
      if (cents != null && String(cents).trim() !== "") {
        const v = centsToReais(cents);
        if (v != null) {
          total += v;
          found = true;
        }
      }
    }
    if (found) return total;
  }
  const cents = raw?.producer?.amount;
  const reaisStr = raw?.producer?.cms;
  const fromCents = centsToReais(cents);
  if (fromCents != null) return fromCents;
  return parseReais(reaisStr);
}

export const Route = createFileRoute("/api/backfill-net")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        try {
          const admin = getAdmin();
          // Varre TODAS as aprovadas com raw (não só net nulo/zero): o bug dos
          // combos gravava um líquido baixo, mas != 0, então o filtro antigo não
          // pegava. Recalcula do owner_commissions e corrige quando diverge.
          const { data, error } = await admin
            .from("sales")
            .select("id, status, net_amount, raw")
            .not("raw", "is", null)
            .limit(10000);
          if (error) return json({ error: error.message }, 500);

          let scanned = 0;
          let updated = 0;
          let skipped = 0;
          const failures: { id: string; reason: string }[] = [];

          for (const row of (data ?? []) as Array<{
            id: string;
            status: string | null;
            net_amount: number | null;
            raw: any;
          }>) {
            scanned += 1;
            // CSV é autoritativo (líquido = "Comissão do Produtor" do export):
            // não recalcula linha travada pra não sobrescrever o valor real.
            if (row.raw?.__dashfl_source === "csv") {
              skipped += 1;
              continue;
            }
            if (!isApprovedStatus(row.status)) {
              skipped += 1;
              continue;
            }
            const net = pickProducer(row.raw);
            if (net == null || net <= 0) {
              skipped += 1;
              continue;
            }
            // Só grava se mudou (tolerância de 1 centavo) — idempotente.
            if (Math.abs(net - Number(row.net_amount ?? 0)) < 0.01) {
              skipped += 1;
              continue;
            }
            const { error: upErr } = await admin
              .from("sales")
              .update({ net_amount: net })
              .eq("id", row.id);
            if (upErr) {
              failures.push({ id: row.id, reason: upErr.message });
            } else {
              updated += 1;
            }
          }

          return json({ ok: true, scanned, updated, skipped, failures });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
