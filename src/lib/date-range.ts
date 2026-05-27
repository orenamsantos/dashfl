import type { DateRange, DatePreset } from "./facebook-api";

// Resolve um período (preset OU custom) em {start, end} no fuso local do navegador.
// Usado para filtrar vendas do banco com o mesmo intervalo que o Meta retorna.
// Em `maximum`, start é null (sem limite inferior).
export function resolveRange(range: DateRange): {
  start: Date | null;
  end: Date;
} {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfNow = new Date(now);

  if (range.type === "custom") {
    return {
      start: new Date(`${range.since}T00:00:00`),
      end: new Date(`${range.until}T23:59:59`),
    };
  }

  switch (range.preset) {
    case "today":
      return { start: startOfToday, end: endOfNow };
    case "yesterday": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 1);
      const end = new Date(startOfToday);
      end.setMilliseconds(-1);
      return { start, end };
    }
    case "last_7d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 6);
      return { start, end: endOfNow };
    }
    case "last_30d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 29);
      return { start, end: endOfNow };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: endOfNow };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setMilliseconds(-1);
      return { start, end };
    }
    case "maximum":
    default:
      return { start: null, end: endOfNow };
  }
}

// Conveniência: filtra um registro de venda pegando a data por ordem de
// preferência (approved_at → order_date → created_at). Linhas sem data
// nenhuma são descartadas — não tem como atribuí-las a um período.
export function isSaleInRange(
  sale: {
    approved_at?: string | null;
    order_date?: string | null;
    created_at?: string | null;
  },
  range: DateRange,
): boolean {
  const raw = sale.approved_at ?? sale.order_date ?? sale.created_at;
  if (!raw) return false;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return false;
  const { start, end } = resolveRange(range);
  if (start && d < start) return false;
  if (d > end) return false;
  return true;
}

// Chave estável para queryKey do react-query (DateRange é objeto).
export function rangeKey(range: DateRange): string {
  return range.type === "preset"
    ? `p:${range.preset}`
    : `c:${range.since}:${range.until}`;
}

export function presetToRange(preset: DatePreset): DateRange {
  return { type: "preset", preset };
}
