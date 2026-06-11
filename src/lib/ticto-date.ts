// Parsing canônico das datas da Ticto, compartilhado pelo webhook (vendas novas)
// e pelo backfill. Existia uma cópia duplicada nos dois lugares e ela tinha um
// BUG de fuso: a Ticto v2 manda os timestamps em horário de BRASÍLIA mas em
// formato ISO SEM fuso (ex.: "2026-06-11T00:35:19"). `new Date(s)` rodando no
// Cloudflare Worker (UTC) interpretava isso como UTC e gravava 3h adiantado —
// então uma venda de 00:35 BRT virava 00:35 UTC, e o dashboard (que converte
// UTC→SP) jogava a venda da madrugada pro DIA ANTERIOR. As vendas em formato BR
// (DD/MM/YYYY, do CSV) já vinham certas porque anexavam -03:00.

const TZ_OFFSET = "-03:00"; // America/Sao_Paulo (horário em que a Ticto manda)

// Retorna ISO 8601 (UTC) ou null. Trata como horário de Brasília tudo que vier
// SEM fuso explícito; respeita o fuso quando ele já está na string (Z/±HH:MM).
export function parseTictoDate(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;

  // ISO (YYYY-MM-DD[...]). Se NÃO tiver fuso, é horário de Brasília.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(s);
    let iso = s;
    if (!hasTz) {
      const norm = s.includes("T") ? s : s.replace(" ", "T");
      iso = /T\d{2}:\d{2}/.test(norm)
        ? `${norm}${TZ_OFFSET}`
        : `${norm}T00:00:00${TZ_OFFSET}`;
    }
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // BR: DD/MM/YYYY [HH:MM[:SS]] — já em horário de Brasília.
  const m = s.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (m) {
    const [, dd, mm, yyyy, hh = "00", mi = "00", ss = "00"] = m;
    const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${TZ_OFFSET}`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  // Último recurso: deixa o Date tentar (pode trazer fuso embutido).
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Caminhos canônicos das datas dentro do payload `raw` salvo da Ticto v2.
export const ORDER_DATE_PATHS = [
  "order.order_date",
  "order.created_at",
  "transaction.created_at",
  "created_at",
];
export const APPROVED_DATE_PATHS = [
  "status_date",
  "order.status_date",
  "transaction.paid_at",
  "order.paid_at",
  "paid_at",
  "approved_at",
];

// Lê o primeiro caminho não-vazio de um objeto aninhado (ex.: "order.order_date").
export function pickRaw(raw: unknown, paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = raw;
    for (const k of p.split(".")) {
      cur = (cur as Record<string, unknown> | null | undefined)?.[k];
    }
    if (cur != null && cur !== "") return cur;
  }
  return undefined;
}

// Linhas importadas do CSV gravam isto no `raw`; suas datas JÁ estão corretas
// (o parser do CSV anexa -03:00), então o backfill de fuso NÃO deve tocá-las.
export function isCsvSourced(raw: unknown): boolean {
  return (raw as { __dashfl_source?: unknown })?.__dashfl_source === "csv";
}
