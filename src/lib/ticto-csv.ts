import Papa from "papaparse";
import { normalizeStatus } from "./status";

export interface ParsedSale {
  id: string;
  source: string;
  checkout: string;
  product: string | null;
  product_name: string | null;
  offer: string | null;
  amount: number | null;
  net_amount: number | null;
  status: string;
  payment_method: string | null;
  order_date: string | null;
  approved_at: string | null;
  campaign: string | null;
  campaign_name: string | null;
  adset: string | null;
  adset_name: string | null;
  ad: string | null;
  ad_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  src: string | null;
  sck: string | null;
  affiliate: string | null;
}

export interface ParseResult {
  headers: string[];
  rows: ParsedSale[];
  errors: { line: number; message: string; raw: Record<string, string> }[];
}

// Brazilian money: "R$ 1.234,56" or "1.234,56" -> 1234.56
export function parseBrlMoney(v: string | null | undefined): number | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  const cleaned = s
    .replace(/\s/g, "")
    .replace(/^R\$/i, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// "DD/MM/AAAA" or "DD/MM/AAAA HH:MM(:SS)" -> ISO timestamp (UTC, treated as local time)
export function parseBrDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (!m) {
    const d = new Date(s);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const [, dd, mm, yyyy, h = "00", mi = "00", ss = "00"] = m;
  // Build as São Paulo local (UTC-3, no DST) — close enough; webhook payloads also lack TZ
  const iso = `${yyyy}-${mm}-${dd}T${h}:${mi}:${ss}-03:00`;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

// status normalization now lives in ./status (shared with the webhook)


// Tolerant header lookup (case/accents/spaces insensitive)
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getter(row: Record<string, string>, headersNorm: Map<string, string>) {
  return (...keys: string[]): string | null => {
    for (const k of keys) {
      const realKey = headersNorm.get(norm(k));
      if (realKey != null) {
        const v = row[realKey];
        if (v != null && String(v).trim() !== "") return String(v).trim();
      }
    }
    return null;
  };
}

function detectDelimiter(sample: string): "," | ";" | "\t" {
  const firstLine = sample.split(/\r?\n/)[0] ?? "";
  const c = (firstLine.match(/,/g) ?? []).length;
  const s = (firstLine.match(/;/g) ?? []).length;
  const t = (firstLine.match(/\t/g) ?? []).length;
  if (s > c && s > t) return ";";
  if (t > c && t > s) return "\t";
  return ",";
}

function decode(buf: ArrayBuffer): string {
  // Try utf-8 strict, fall back to latin-1
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return text;
  } catch {
    return new TextDecoder("iso-8859-1").decode(buf);
  }
}

export async function parseTictoCsv(file: File): Promise<ParseResult> {
  const buf = await file.arrayBuffer();
  const text = decode(buf);
  const delimiter = detectDelimiter(text.slice(0, 4000));

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    delimiter,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  const headersNorm = new Map<string, string>();
  for (const h of headers) headersNorm.set(norm(h), h);

  const rows: ParsedSale[] = [];
  const errors: ParseResult["errors"] = [];

  parsed.data.forEach((raw, idx) => {
    const line = idx + 2; // header is line 1
    try {
      const get = getter(raw, headersNorm);

      const id =
        get(
          "Código da Transação",
          "Codigo da Transacao",
          "Código do Pedido",
          "Codigo do Pedido",
          "Número do Pedido",
          "Numero do Pedido",
          "transaction_id",
          "id",
        ) ?? null;
      if (!id) {
        errors.push({
          line,
          message: "Linha sem ID de transação/pedido",
          raw,
        });
        return;
      }

      rows.push({
        id,
        source: "Ticto",
        checkout: "Ticto",
        product: get("Nome do Produto", "Produto"),
        product_name: get("Nome do Produto", "Produto"),
        offer: get("Nome da Oferta", "Oferta"),
        // BRUTO: "Valor do Item" é o preço do produto. "Valor Pago" às vezes
        // inclui a taxa paga pelo comprador (infla o faturamento). Se preferir
        // "o que caiu na conta", troque a ordem para ("Valor Pago", ...).
        amount: parseBrlMoney(
          get("Valor do Item", "Valor Pago", "Valor do Pedido", "Valor"),
        ),
        // LÍQUIDO: "Comissão do Produtor" é o líquido real da venda.
        // "Valor Liquidado" fica R$ 0 durante a retenção da Ticto, então só
        // serve de fallback (corrige o faturamento líquido sumindo).
        net_amount: parseBrlMoney(
          get("Comissão do Produtor", "Comissao do Produtor", "Valor Liquidado"),
        ),
        status: normalizeStatus(get("Status")),
        payment_method: get("Método de Pagamento", "Metodo de Pagamento"),
        order_date: parseBrDate(get("Data do Pedido", "Data da Transação", "Data da Transacao")),
        approved_at: parseBrDate(get("Data do Status", "Data de Aprovação", "Data de Aprovacao")),
        campaign: get("utm_campaign"),
        campaign_name: get("utm_campaign", "utm_name"),
        adset: get("utm_content"),
        adset_name: get("utm_content"),
        ad: get("utm_term"),
        ad_name: get("utm_term"),
        utm_source: get("utm_source"),
        utm_medium: get("utm_medium"),
        utm_campaign: get("utm_campaign"),
        utm_content: get("utm_content"),
        utm_term: get("utm_term"),
        src: get("src"),
        sck: get("sck"),
        affiliate: get("Afiliado", "Nome do Afiliado"),
      });
    } catch (e) {
      errors.push({ line, message: (e as Error).message, raw });
    }
  });

  return { headers, rows, errors };
}

// Consolida linhas do MESMO pedido (order bump compartilha o "Código da Transação"
// e portanto o mesmo `id`) em uma única venda, somando os valores. DEVE ser
// aplicada sobre o conjunto INTEIRO antes de fatiar em lotes, senão as duas
// linhas podem cair em batches diferentes e a soma do bump se perde.
export function consolidateByOrder(rows: ParsedSale[]): ParsedSale[] {
  const byId = new Map<string, ParsedSale>();
  for (const row of rows) {
    const existing = byId.get(row.id);
    if (!existing) {
      byId.set(row.id, { ...row });
      continue;
    }
    existing.amount = (existing.amount ?? 0) + (row.amount ?? 0);
    existing.net_amount = (existing.net_amount ?? 0) + (row.net_amount ?? 0);
    // textos: mantém o que já existe; só preenche se estiver vazio
    existing.product = existing.product || row.product;
    existing.product_name = existing.product_name || row.product_name;
    existing.offer = existing.offer || row.offer;
    existing.payment_method = existing.payment_method ?? row.payment_method;
    existing.order_date = existing.order_date ?? row.order_date;
    existing.approved_at = existing.approved_at ?? row.approved_at;
    existing.status = existing.status || row.status;
    existing.utm_source = existing.utm_source ?? row.utm_source;
    existing.utm_medium = existing.utm_medium ?? row.utm_medium;
    existing.utm_campaign = existing.utm_campaign ?? row.utm_campaign;
    existing.utm_content = existing.utm_content ?? row.utm_content;
    existing.utm_term = existing.utm_term ?? row.utm_term;
    existing.src = existing.src ?? row.src;
    existing.sck = existing.sck ?? row.sck;
    existing.affiliate = existing.affiliate ?? row.affiliate;
  }
  return [...byId.values()];
}
