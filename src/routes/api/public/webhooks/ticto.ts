import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { normalizeStatus } from "@/lib/status";

// Ticto webhook receiver.
// Configure in Ticto: URL = https://<your-domain>/api/public/webhooks/ticto?token=<TICTO_WEBHOOK_TOKEN>
// The token query param must match the TICTO_WEBHOOK_TOKEN secret.

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing on server");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// status normalization shared with the CSV import (see @/lib/status)
const mapStatus = normalizeStatus;

function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function pick<T = unknown>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    const parts = k.split(".");
    let cur: any = obj;
    for (const p of parts) cur = cur?.[p];
    if (cur != null && cur !== "") return cur as T;
  }
  return undefined;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/webhooks/ticto")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            message: "Ticto webhook endpoint. Use POST.",
          }),
          { headers: { "Content-Type": "application/json", ...CORS } },
        ),
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const expected = process.env.TICTO_WEBHOOK_TOKEN;

        if (!expected) {
          return new Response(
            JSON.stringify({
              error:
                "TICTO_WEBHOOK_TOKEN not configured on server. Add it in Lovable Cloud secrets.",
            }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }

        let payload: any;
        try {
          const raw = await request.text();
          payload = raw ? JSON.parse(raw) : {};
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        // Ticto sends the token inside the JSON body as `token`.
        // Also accept ?token=... query or x-ticto-token header for flexibility.
        const provided =
          (typeof payload?.token === "string" ? payload.token : undefined) ??
          url.searchParams.get("token") ??
          request.headers.get("x-ticto-token") ??
          undefined;

        if (!provided || provided !== expected) {
          return new Response(JSON.stringify({ error: "Invalid token" }), {
            status: 401,
            headers: { "Content-Type": "application/json", ...CORS },
          });
        }

        // Ticto payloads vary by event. Map across common shapes.
        const transactionId =
          pick<string>(
            payload,
            "transaction.hash",
            "transaction.id",
            "order.hash",
            "order.id",
            "id",
            "hash",
          ) ?? `ticto_${Date.now()}`;

        const product =
          pick<string>(
            payload,
            "item.product_name",
            "product.name",
            "product_name",
            "item.name",
            "name",
          ) ?? "—";

        const amount = num(
          pick(
            payload,
            "transaction.paid_amount",
            "transaction.amount",
            "order.paid_amount",
            "order.amount",
            "amount",
            "value",
          ),
        );
        // Ticto sends values in cents in some events; heuristic: if integer >= 1000 and no decimal char, assume cents
        const normalizedAmount =
          amount > 1000 && Number.isInteger(amount) ? amount / 100 : amount;

        const statusRaw = pick(
          payload,
          "status",
          "transaction.status",
          "order.status",
        );

        const utm_source = pick<string>(payload, "utm.utm_source", "utm_source", "tracking.utm_source");
        const utm_medium = pick<string>(payload, "utm.utm_medium", "utm_medium", "tracking.utm_medium");
        const utm_campaign = pick<string>(payload, "utm.utm_campaign", "utm_campaign", "tracking.utm_campaign");
        const utm_content = pick<string>(payload, "utm.utm_content", "utm_content", "tracking.utm_content");
        const utm_term = pick<string>(payload, "utm.utm_term", "utm_term", "tracking.utm_term");
        const src = pick<string>(payload, "src", "tracking.src");
        const sck = pick<string>(payload, "sck", "tracking.sck");
        const offer = pick<string>(payload, "item.offer_name", "offer.name", "offer_name");
        const payment_method = pick<string>(payload, "transaction.payment_method", "payment_method", "method");
        const order_date = pick<string>(payload, "transaction.created_at", "order.created_at", "created_at");
        const approved_at = pick<string>(payload, "transaction.paid_at", "order.paid_at", "paid_at", "approved_at");
        const affiliate = pick<string>(payload, "affiliate.name", "affiliate_name", "affiliate");
        const net_amount = num(pick(payload, "transaction.producer_amount", "producer_amount", "net_amount"));

        const row = {
          id: String(transactionId),
          checkout: "Ticto",
          source: "Ticto",
          product,
          product_name: product,
          offer: offer ?? null,
          amount: normalizedAmount,
          net_amount: net_amount || null,
          status: mapStatus(statusRaw),
          payment_method: payment_method ?? null,
          order_date: order_date ?? null,
          approved_at: approved_at ?? null,
          campaign: utm_campaign ?? null,
          campaign_name: utm_campaign ?? null,
          adset: utm_content ?? null,
          adset_name: utm_content ?? null,
          ad: utm_term ?? null,
          ad_name: utm_term ?? null,
          utm_source: utm_source ?? null,
          utm_medium: utm_medium ?? null,
          utm_campaign: utm_campaign ?? null,
          utm_content: utm_content ?? null,
          utm_term: utm_term ?? null,
          src: src ?? null,
          sck: sck ?? null,
          affiliate: affiliate ?? null,
          raw: payload,
        };

        try {
          const admin = getAdmin();
          const { error } = await admin
            .from("sales")
            .upsert(row, { onConflict: "id" });
          if (error) {
            // retry without `raw` column (if column doesn't exist)
            const { raw: _omit, ...rest } = row;
            const retry = await admin
              .from("sales")
              .upsert(rest, { onConflict: "id" });
            if (retry.error) {
              return new Response(
                JSON.stringify({ error: retry.error.message }),
                {
                  status: 500,
                  headers: { "Content-Type": "application/json", ...CORS },
                },
              );
            }
          }
          return new Response(JSON.stringify({ ok: true, id: row.id }), {
            headers: { "Content-Type": "application/json", ...CORS },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: (e as Error).message }),
            {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            },
          );
        }
      },
    },
  },
});
