import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { normalizeStatus, isApprovedStatus } from "@/lib/status";

// Ticto webhook receiver (Ticto v2 — https://webhook.ticto.dev/docs/v2).
// Configure in Ticto: URL = https://<your-domain>/api/public/webhooks/ticto?token=<TICTO_WEBHOOK_TOKEN>
// O token pode vir no body (`token`), na query (?token=) ou em x-ticto-token.

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing on server");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Parser tolerante: aceita ISO (2024-05-31T...) ou BR ("31/05/2024 13:45:00").
// Retorna ISO 8601 ou null. A coluna `order_date`/`approved_at` é timestamptz.
function parseTictoDate(v: unknown): string | null {
  const s = clean(v);
  if (!s) return null;
  // ISO direto
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // BR: DD/MM/YYYY [HH:MM[:SS]]
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  // último recurso
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// "Não Informado" é o placeholder que a Ticto envia quando o campo está vazio.
// Tratamos como null pra não gravar uma string falsa como se fosse uma campanha.
const TICTO_NULL = new Set([
  "nao informado",
  "não informado",
  "n/a",
  "",
]);

function clean(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const norm = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (TICTO_NULL.has(norm)) return null;
  return s;
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

// Centavos (inteiro) → reais (float). Aceita "11052" ou 11052.
function centsToReais(v: unknown): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

// String em reais com ponto decimal ("110.52") → float. Aceita também vírgula.
function parseReais(v: unknown): number {
  if (v == null) return 0;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Soma os order bumps (em reais com decimais, ex. "1000.00") quando enviados.
function sumBumps(payload: any): number {
  const bumps = payload?.bumps;
  if (!Array.isArray(bumps)) return 0;
  let total = 0;
  for (const b of bumps) {
    total += parseReais(b?.offer_price ?? b?.price ?? b?.amount);
  }
  return total;
}

// Comissão líquida dos bumps. A Ticto pode mandar o producer aninhado no
// item do bump (centavos em producer.amount ou string em producer.cms) ou
// um campo plano `cms`/`commission` em reais. Tentamos vários caminhos
// porque a doc v2 não é 100% explícita sobre esse subobjeto.
function sumBumpCommissions(payload: any): number {
  const bumps = payload?.bumps;
  if (!Array.isArray(bumps)) return 0;
  let total = 0;
  for (const b of bumps) {
    const cents = b?.producer?.amount;
    if (cents != null && String(cents).trim() !== "") {
      total += Number(String(cents).replace(",", ".")) / 100;
      continue;
    }
    const cms = b?.producer?.cms ?? b?.cms ?? b?.commission;
    if (cms != null && String(cms).trim() !== "") {
      total += parseReais(cms);
    }
  }
  return total;
}

// Identificador estável do "item" que entrou neste postback. Usado pra
// detectar retry idempotente (mesma chave -> noop) vs postback adicional
// de bump (chave nova -> soma). Inclui status pra que pix_created e
// authorized do mesmo item contem como eventos distintos no merge.
function itemKeyFor(payload: any): string {
  const product =
    pick<string>(payload, "item.product_id", "item.product_name", "product.id", "product.name", "product_name") ??
    "main";
  const offer =
    pick<string>(payload, "item.offer_id", "item.offer_name", "offer.id", "offer.name") ?? "";
  const status = String(pick(payload, "status", "transaction.status") ?? "");
  return `${product}|${offer}|${status}`;
}

// payment_method da Ticto v2 → label legível
function mapPaymentMethod(raw: unknown): string | null {
  const v = clean(raw);
  if (!v) return null;
  const k = v.toLowerCase();
  if (k === "pix") return "Pix";
  if (k === "credit_card" || k === "creditcard") return "Cartão de Crédito";
  if (k === "bank_slip" || k === "bankslip" || k === "boleto") return "Boleto";
  return v;
}

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

        // --- detecção de venda de TESTE da Ticto (ANTES do gate de token).
        // O painel da Ticto envia um payload de teste com product_name fixo
        // "Paki Guthrie" e/ou token "PAKI_GUTHRIE" quando o produtor aperta
        // "Testar Webhook". Respondemos 200 OK sem gravar — é assim que a
        // Ticto valida que o endpoint está respondendo. Verificamos antes
        // do gate de token pra não devolver 401 em payloads documentados.
        const productNameForCheck = String(
          pick(payload, "item.product_name", "product.name", "product_name") ??
            "",
        )
          .trim()
          .toLowerCase();
        const tokenForCheck =
          (typeof payload?.token === "string" ? payload.token : "")
            .trim()
            .toUpperCase();
        const isTestToken = tokenForCheck === "PAKI_GUTHRIE";
        const isTestProduct = productNameForCheck === "paki guthrie";
        if (isTestProduct || isTestToken) {
          console.warn("[ticto] payload de teste ignorado", {
            productName: productNameForCheck || null,
            isTestToken,
          });
          return new Response(
            JSON.stringify({ ok: true, ignored: "test_payload" }),
            { headers: { "Content-Type": "application/json", ...CORS } },
          );
        }

        // --- gate de token (vendas reais)
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

        // --- id: mesma chave do CSV (transaction_hash) pra dedupe consistente
        const transactionId =
          pick<string>(
            payload,
            "order.transaction_hash",
            "transaction.hash",
            "transaction.id",
            "order.hash",
            "order.id",
            "id",
            "hash",
          ) ?? `ticto_${Date.now()}`;

        // --- status canônico (mapStatus) ANTES do cálculo do net_amount
        const statusRaw = pick(
          payload,
          "status",
          "transaction.status",
          "order.status",
        );
        const status = normalizeStatus(statusRaw);

        // --- bruto: item.amount está em CENTAVOS; bumps[].offer_price em REAIS
        const itemAmount = centsToReais(
          pick(payload, "item.amount", "item.price", "transaction.amount"),
        );
        const bumpTotal = sumBumps(payload);
        // Soma bumps quando vêm no mesmo pedido (config "Combo junto com a
        // oferta principal"). Sem bumps, fica só o item.
        const amount = itemAmount + bumpTotal;

        // --- líquido: producer.amount em CENTAVOS; producer.cms em REAIS (string).
        // Só faz sentido quando o pagamento foi de fato confirmado (authorized).
        // Em pix_created / waiting_payment NÃO há comissão ainda — fica null.
        let net_amount: number | null = null;
        if (isApprovedStatus(status)) {
          const producerCents = pick(payload, "producer.amount");
          let main = 0;
          if (producerCents != null && String(producerCents).trim() !== "") {
            main = centsToReais(producerCents);
          } else {
            const cms = pick(payload, "producer.cms");
            if (cms != null && String(cms).trim() !== "") {
              main = parseReais(cms);
            }
          }
          net_amount = main + sumBumpCommissions(payload);
        }

        // --- tracking (utms / src / sck) — "Não Informado" vira null
        const tracking = payload?.tracking ?? {};
        const utm_source = clean(
          tracking.utm_source ?? pick(payload, "utm.utm_source", "utm_source"),
        );
        const utm_medium = clean(
          tracking.utm_medium ?? pick(payload, "utm.utm_medium", "utm_medium"),
        );
        const utm_campaign = clean(
          tracking.utm_campaign ??
            pick(payload, "utm.utm_campaign", "utm_campaign"),
        );
        const utm_content = clean(
          tracking.utm_content ??
            pick(payload, "utm.utm_content", "utm_content"),
        );
        const utm_term = clean(
          tracking.utm_term ?? pick(payload, "utm.utm_term", "utm_term"),
        );
        const src = clean(tracking.src ?? pick(payload, "src"));
        const sck = clean(tracking.sck ?? pick(payload, "sck"));

        const product = clean(
          pick<string>(
            payload,
            "item.product_name",
            "product.name",
            "product_name",
            "item.name",
            "name",
          ),
        );
        const offer = clean(
          pick<string>(payload, "item.offer_name", "offer.name", "offer_name"),
        );
        const payment_method = mapPaymentMethod(
          pick(
            payload,
            "payment_method",
            "transaction.payment_method",
            "method",
          ),
        );
        // Ticto v2: `order.order_date` é a data do pedido; `status_date` é a
        // data da última mudança de status — só conta como "aprovado em"
        // quando o status atual é authorized. Mantemos fallbacks p/ payloads
        // antigos / outras integrações.
        const order_date = parseTictoDate(
          pick<string>(
            payload,
            "order.order_date",
            "order.created_at",
            "transaction.created_at",
            "created_at",
          ),
        );
        const statusDateRaw = pick<string>(
          payload,
          "status_date",
          "order.status_date",
          "transaction.paid_at",
          "order.paid_at",
          "paid_at",
          "approved_at",
        );
        const approved_at = isApprovedStatus(status)
          ? parseTictoDate(statusDateRaw)
          : null;
        const affiliate = clean(
          pick<string>(payload, "affiliate.name", "affiliate_name", "affiliate"),
        );

        const row = {
          id: String(transactionId),
          checkout: "Ticto",
          source: "Ticto",
          product,
          product_name: product,
          offer,
          amount,
          net_amount,
          status,
          payment_method,
          order_date,
          approved_at,
          campaign: utm_campaign,
          campaign_name: utm_campaign,
          adset: utm_content,
          adset_name: utm_content,
          ad: utm_term,
          ad_name: utm_term,
          utm_source,
          utm_medium,
          utm_campaign,
          utm_content,
          utm_term,
          src,
          sck,
          affiliate,
          raw: payload,
        };

        const itemKey = itemKeyFor(payload);

        try {
          const admin = getAdmin();
          // SELECT-then-merge: se já existir uma venda com o mesmo
          // transaction_hash, queremos somar (caso do bump em postback
          // separado), preservando idempotência via merged_items.
          const { data: existingRows, error: selErr } = await admin
            .from("sales")
            .select("id, amount, net_amount, status, merged_items")
            .eq("id", row.id)
            .limit(1);
          if (selErr) {
            return new Response(JSON.stringify({ error: selErr.message }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }
          const existing = existingRows?.[0] as
            | {
                id: string;
                amount: number | null;
                net_amount: number | null;
                status: string | null;
                merged_items: string[] | null;
              }
            | undefined;

          if (!existing) {
            const insertRow = { ...row, merged_items: [itemKey] };
            const { error } = await admin.from("sales").insert(insertRow);
            if (error) {
              return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...CORS },
              });
            }
            return new Response(
              JSON.stringify({ ok: true, id: row.id, action: "insert" }),
              { headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          const already = (existing.merged_items ?? []).includes(itemKey);
          if (already) {
            // Retry da Ticto: só atualiza campos não-monetários (status pode
            // ter mudado em retry curto, mas amount/net já estão somados).
            const { error } = await admin
              .from("sales")
              .update({
                status: row.status,
                approved_at: row.approved_at ?? undefined,
                payment_method: row.payment_method ?? undefined,
                raw: payload,
              })
              .eq("id", row.id);
            if (error) {
              return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...CORS },
              });
            }
            return new Response(
              JSON.stringify({ ok: true, id: row.id, action: "noop_duplicate" }),
              { headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          // Item novo (bump em postback separado, ou novo evento de status):
          // SOMA amount/net_amount em cima do existente. Não sobrescreve.
          const merged = {
            amount: Number(existing.amount ?? 0) + row.amount,
            net_amount:
              row.net_amount != null
                ? Number(existing.net_amount ?? 0) + row.net_amount
                : existing.net_amount,
            // status mais "avançado" ganha: Aprovada > Pendente
            status:
              row.status === "Aprovada" ? row.status : existing.status ?? row.status,
            approved_at: row.approved_at ?? undefined,
            payment_method: row.payment_method ?? undefined,
            raw: payload,
            merged_items: [...(existing.merged_items ?? []), itemKey],
          };
          const { error } = await admin
            .from("sales")
            .update(merged)
            .eq("id", row.id);
          if (error) {
            return new Response(JSON.stringify({ error: error.message }), {
              status: 500,
              headers: { "Content-Type": "application/json", ...CORS },
            });
          }
          return new Response(
            JSON.stringify({ ok: true, id: row.id, action: "merge_sum" }),
            { headers: { "Content-Type": "application/json", ...CORS } },
          );
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
