import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";
import { isApprovedStatus } from "@/lib/status";

// Preenche order_date / approved_at das vendas que ficaram NULL por causa do
// bug do mapeamento antigo do webhook. Tenta nesta ordem:
//   1. campos do `raw` salvo (order.order_date / status_date — Ticto v2)
//   2. created_at (timestamp em que o webhook chegou — aproximação)
// O fallback para created_at faz filtros por data funcionarem, mesmo que
// não seja a data real do pedido.

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

function parseTictoDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pick(raw: any, ...paths: string[]): unknown {
  for (const p of paths) {
    const parts = p.split(".");
    let cur: any = raw;
    for (const k of parts) cur = cur?.[k];
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}

export const Route = createFileRoute("/api/backfill-dates")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        try {
          const admin = getAdmin();
          const { data, error } = await admin
            .from("sales")
            .select("id, status, order_date, approved_at, created_at, raw")
            .or("order_date.is.null,approved_at.is.null")
            .limit(20000);
          if (error) return json({ error: error.message }, 500);

          let scanned = 0;
          let updated = 0;
          let unchanged = 0;
          const failures: { id: string; reason: string }[] = [];

          for (const row of (data ?? []) as Array<{
            id: string;
            status: string | null;
            order_date: string | null;
            approved_at: string | null;
            created_at: string | null;
            raw: any;
          }>) {
            scanned += 1;
            const patch: { order_date?: string; approved_at?: string } = {};

            if (!row.order_date) {
              const fromRaw = parseTictoDate(
                pick(
                  row.raw,
                  "order.order_date",
                  "order.created_at",
                  "transaction.created_at",
                  "created_at",
                ),
              );
              const od = fromRaw ?? row.created_at;
              if (od) patch.order_date = od;
            }

            if (!row.approved_at && isApprovedStatus(row.status)) {
              const fromRaw = parseTictoDate(
                pick(
                  row.raw,
                  "status_date",
                  "order.status_date",
                  "transaction.paid_at",
                  "order.paid_at",
                  "paid_at",
                  "approved_at",
                ),
              );
              const ad = fromRaw ?? row.created_at;
              if (ad) patch.approved_at = ad;
            }

            if (Object.keys(patch).length === 0) {
              unchanged += 1;
              continue;
            }
            const { error: upErr } = await admin
              .from("sales")
              .update(patch)
              .eq("id", row.id);
            if (upErr) failures.push({ id: row.id, reason: upErr.message });
            else updated += 1;
          }

          return json({ ok: true, scanned, updated, unchanged, failures });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
