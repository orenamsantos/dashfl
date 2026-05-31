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

// Equivalente a COALESCE(approved_at, order_date, created_at) do Postgres.
// `??` não cobre string vazia, então testamos truthiness explicitamente —
// vendas importadas via CSV podem chegar com "" em vez de null nas datas.
export function saleEventDate(sale: {
  approved_at?: string | null;
  order_date?: string | null;
  created_at?: string | null;
}): Date | null {
  const raw =
    (sale.approved_at && sale.approved_at.trim()) ||
    (sale.order_date && sale.order_date.trim()) ||
    (sale.created_at && sale.created_at.trim()) ||
    null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Filtra um registro de venda pelo intervalo. Mesmo COALESCE acima — quem
// não tem data nenhuma fica fora (não dá pra atribuir a um período).
export function isSaleInRange(
  sale: {
    approved_at?: string | null;
    order_date?: string | null;
    created_at?: string | null;
  },
  range: DateRange,
): boolean {
  const d = saleEventDate(sale);
  if (!d) return false;
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
