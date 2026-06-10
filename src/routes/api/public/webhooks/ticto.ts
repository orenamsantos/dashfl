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

// Lista os "itens adicionais" do payload (bumps, combos, items extras).
// A Ticto v2 oficialmente usa `bumps[]` mas há campos correlatos que aparecem
// em postbacks reais — aceitamos vários sinônimos pra não perder nenhum.
function extraItems(payload: any): any[] {
  const out: any[] = [];
  // APENAS arrays de bump de verdade. NUNCA "items"/"combos"/"extra_items":
  // a Ticto v2 coloca o PRODUTO PRINCIPAL dentro de `items[]`, então incluí-lo
  // aqui fazia o item principal ser contado duas vezes (inflava bruto e líquido).
  for (const key of ["bumps", "order_bumps"]) {
    const v = payload?.[key];
    if (Array.isArray(v)) out.push(...v);
  }
  // Bumps às vezes vêm aninhados em order/transaction — só os arrays de bump.
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

// Soma o BRUTO dos bumps. A Ticto v2 manda offer_price (reais decimais) mas
// alguns payloads usam `amount` em centavos ou `price` em reais. Testamos a
// ordem de preferência reais-first; se o valor for muito alto pra ser reais
// e parecer centavos, dividimos.
function sumBumps(payload: any): number {
  const items = extraItems(payload);
  let total = 0;
  for (const b of items) {
    const reaisStr = b?.offer_price ?? b?.price;
    if (reaisStr != null && String(reaisStr).trim() !== "") {
      total += parseReais(reaisStr);
      continue;
    }
    const cents = b?.amount ?? b?.amount_cents;
    if (cents != null && String(cents).trim() !== "") {
      total += centsToReais(cents);
    }
  }
  return total;
}

// Comissão líquida (producer) dos bumps. Tentamos vários caminhos porque a
// estrutura por item varia entre payloads: producer.amount em centavos,
// producer.cms em reais string, ou campos planos `cms`/`commission`/
// `producer_amount`. Bumps às vezes têm seu próprio objeto producer; outras
// vezes a comissão sai num atalho.
function sumBumpCommissions(payload: any): number {
  const items = extraItems(payload);
  let total = 0;
  for (const b of items) {
    const centsCandidates = [
      b?.producer?.amount,
      b?.producer_amount,
      b?.commission_cents,
      b?.net_amount_cents,
    ];
    let added = false;
    for (const c of centsCandidates) {
      if (c != null && String(c).trim() !== "") {
        total += centsToReais(c);
        added = true;
        break;
      }
    }
    if (added) continue;
    const reaisCandidates = [
      b?.producer?.cms,
      b?.cms,
      b?.commission,
      b?.producer_commission,
      b?.net_amount,
      b?.value,
    ];
    for (const r of reaisCandidates) {
      if (r != null && String(r).trim() !== "") {
        total += parseReais(r);
        break;
      }
    }
  }
  return total;
}

// Líquido AUTORITATIVO do produtor. A Ticto v2 manda a comissão de CADA item
// (produto principal + bumps) num array de topo `owner_commissions[]`, com
// `commission_amount` em CENTAVOS. `producer.amount`/`producer.cms` só trazem a
// comissão do produto PRINCIPAL — usá-los sozinhos perdia a comissão dos bumps
// (combo R$65 gravava líquido R$31,92 em vez de R$57,96). Quando o array existe,
// somá-lo é o líquido completo. Retorna null se o payload não traz o array.
function netFromOwnerCommissions(payload: any): number | null {
  const arr = payload?.owner_commissions;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  let total = 0;
  let found = false;
  for (const c of arr) {
    const cents = c?.commission_amount;
    if (cents != null && String(cents).trim() !== "") {
      total += centsToReais(cents);
      found = true;
    }
  }
  return found ? total : null;
}

// Resolve o status final quando um postback chega pra uma venda já gravada.
// Regras: reembolso/chargeback é terminal e SEMPRE vence (antes, um refund não
// atualizava a linha e a venda seguia contando como aprovada); pagamento
// confirmado vence pendências; e nunca rebaixa uma venda já Aprovada por causa
// de um retry de "Pendente".
function resolveSaleStatus(
  existing: string | null | undefined,
  incoming: string,
): string {
  if (incoming === "Reembolsada") return incoming;
  if (incoming === "Aprovada") return incoming;
  if (existing === "Aprovada") return existing;
  return incoming;
}

// Identificador estável do "item" (produto+oferta) deste postback. Usado pra
// detectar retry/mudança de status do MESMO item (mesma chave -> NÃO soma) vs
// postback de um item adicional/bump (chave nova -> soma).
// IMPORTANTE: NÃO inclui status. Incluir status fazia pix_created e authorized
// do mesmo item virarem chaves diferentes -> o authorized somava o valor de
// novo -> faturamento bruto inflado e sem bater com o líquido.
function itemKeyFor(payload: any): string {
  const product =
    pick<string>(payload, "item.product_id", "item.product_name", "product.id", "product.name", "product_name") ??
    "main";
  const offer =
    pick<string>(payload, "item.offer_id", "item.offer_name", "offer.id", "offer.name") ?? "";
  return `${product}|${offer}`;
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

        // --- bruto: `order.paid_amount` (centavos) é o que o cliente DE FATO
        // pagou — item principal + bumps + descontos já aplicados. É a fonte
        // autoritativa. Fallback pro cálculo item.amount (centavos) + bumps
        // (offer_price em reais) quando o payload não traz paid_amount.
        const paidAmount = centsToReais(
          pick(payload, "order.paid_amount", "transaction.paid_amount"),
        );
        const itemAmount = centsToReais(
          pick(payload, "item.amount", "item.price", "transaction.amount"),
        );
        const bumpTotal = sumBumps(payload);
        const amount = paidAmount > 0 ? paidAmount : itemAmount + bumpTotal;

        // --- líquido: `owner_commissions[]` traz a comissão do produtor por item
        // (principal + bumps, em centavos) e é a fonte autoritativa. Só quando
        // não vier, cai pro producer.amount/cms (que cobre só o principal) +
        // sumBumpCommissions. Só faz sentido quando o pagamento foi de fato
        // confirmado; em pix_created / waiting_payment NÃO há comissão — fica null.
        let net_amount: number | null = null;
        if (isApprovedStatus(status)) {
          const fromOwners = netFromOwnerCommissions(payload);
          if (fromOwners != null) {
            net_amount = fromOwners;
          } else {
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
        };

        const itemKey = itemKeyFor(payload);

        // Observability: deixa visível no CF Logs como cada payload está
        // estruturado e quanto a gente extraiu — facilita conferir a soma
        // do líquido vs "Valor em comissões" da Ticto sem precisar de SQL.
        const extras = extraItems(payload);
        if (extras.length > 0) {
          console.log("[ticto] payload com itens extras", {
            transactionId,
            status,
            mainItem: payload?.item?.product_name ?? null,
            extrasCount: extras.length,
            firstExtraKeys: Object.keys(extras[0] ?? {}),
            firstExtra: extras[0],
            amount,
            net_amount,
            sumBumps: sumBumps(payload),
            sumBumpCommissions: sumBumpCommissions(payload),
          });
        }

        try {
          const admin = getAdmin();
          // SELECT-then-merge: se já existir uma venda com o mesmo
          // transaction_hash, queremos somar (caso do bump em postback
          // separado), preservando idempotência via merged_items dentro
          // do próprio raw — sem precisar de coluna nova no schema.
          const { data: existingRows, error: selErr } = await admin
            .from("sales")
            .select("id, amount, net_amount, status, raw")
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
                raw: any;
              }
            | undefined;

          // Bookkeeping fica embutido no raw — sobrevive sem migração.
          const existingMerged: string[] = Array.isArray(
            existing?.raw?.__dashfl_merged_items,
          )
            ? existing!.raw.__dashfl_merged_items
            : [];

          if (!existing) {
            const insertRaw = {
              ...payload,
              __dashfl_merged_items: [itemKey],
            };
            const { error } = await admin
              .from("sales")
              .insert({ ...row, raw: insertRaw });
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

          // CSV é a fonte autoritativa de dinheiro. Se a linha foi gravada/
          // sobrescrita por uma importação de CSV, NÃO somamos amount/net por
          // cima (o CSV já consolidou produto + bumps). O webhook só atualiza
          // status/datas/forma de pagamento em tempo real e mantém o lock.
          const csvLocked = existing.raw?.__dashfl_source === "csv";
          if (csvLocked) {
            const nextRaw = {
              ...(existing.raw ?? {}),
              __dashfl_source: "csv",
              __dashfl_last_webhook: payload,
            };
            const { error } = await admin
              .from("sales")
              .update({
                status: resolveSaleStatus(existing.status, row.status),
                approved_at: row.approved_at ?? undefined,
                payment_method: row.payment_method ?? undefined,
                raw: nextRaw,
              })
              .eq("id", row.id);
            if (error) {
              return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...CORS },
              });
            }
            return new Response(
              JSON.stringify({ ok: true, id: row.id, action: "noop_csv_locked" }),
              { headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          const already = existingMerged.includes(itemKey);
          if (already) {
            // MESMO item já contabilizado. NÃO soma de novo (era isso que
            // inflava quando o status mudava, ex. pix_created -> authorized).
            // Atualiza status/datas; e quando o item passa a APROVADO, grava o
            // bruto e o líquido AUTORITATIVOS deste evento (overwrite, sem somar)
            // — assim o líquido (que só existe no authorized) entra e o bruto
            // reflete item + bumps consolidados.
            const nextRaw = { ...payload, __dashfl_merged_items: existingMerged };
            const update: Record<string, unknown> = {
              status: resolveSaleStatus(existing.status, row.status),
              approved_at: row.approved_at ?? undefined,
              payment_method: row.payment_method ?? undefined,
              raw: nextRaw,
            };
            if (isApprovedStatus(row.status)) {
              update.amount = row.amount;
              if (row.net_amount != null) update.net_amount = row.net_amount;
            }
            const { error } = await admin.from("sales").update(update).eq("id", row.id);
            if (error) {
              return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...CORS },
              });
            }
            return new Response(
              JSON.stringify({ ok: true, id: row.id, action: "update_same_item" }),
              { headers: { "Content-Type": "application/json", ...CORS } },
            );
          }

          // Item novo (bump em postback separado, ou novo evento de status):
          // SOMA amount/net_amount em cima do existente. Não sobrescreve.
          const nextRaw = {
            ...payload,
            __dashfl_merged_items: [...existingMerged, itemKey],
          };
          const merged = {
            amount: Number(existing.amount ?? 0) + row.amount,
            net_amount:
              row.net_amount != null
                ? Number(existing.net_amount ?? 0) + row.net_amount
                : existing.net_amount,
            status: resolveSaleStatus(existing.status, row.status),
            approved_at: row.approved_at ?? undefined,
            payment_method: row.payment_method ?? undefined,
            raw: nextRaw,
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
          console.log("[ticto] merge_sum", {
            transactionId,
            itemKey,
            addedAmount: row.amount,
            addedNet: row.net_amount,
          });
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
