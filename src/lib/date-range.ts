import type { DateRange, DatePreset } from "./facebook-api";

// Todos os recortes de período usam o fuso da Ticto/operação (Brasília).
// Comparamos vendas e bounds como YYYY-MM-DD nesse fuso, então uma venda
// às 23:50 de SP não vai pro dia seguinte só porque o servidor está em UTC.
const TZ = "America/Sao_Paulo";

// "YYYY-MM-DD" do instante no fuso configurado.
function ymdInTz(d: Date): string {
  // en-CA dá ISO-like YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

interface YmdRange {
  startYmd: string | null;
  endYmd: string;
}

// Resolve um período pra par {startYmd, endYmd} em YYYY-MM-DD no fuso de SP.
// O `maximum` deixa startYmd como null (sem piso).
export function resolveRangeYmd(range: DateRange): YmdRange {
  const todayYmd = ymdInTz(new Date());

  if (range.type === "custom") {
    return { startYmd: range.since, endYmd: range.until };
  }

  switch (range.preset) {
    case "today":
      return { startYmd: todayYmd, endYmd: todayYmd };
    case "yesterday": {
      const y = addDaysYmd(todayYmd, -1);
      return { startYmd: y, endYmd: y };
    }
    case "last_7d":
      return { startYmd: addDaysYmd(todayYmd, -6), endYmd: todayYmd };
    case "last_30d":
      return { startYmd: addDaysYmd(todayYmd, -29), endYmd: todayYmd };
    case "this_month":
      return { startYmd: firstOfMonthYmd(todayYmd), endYmd: todayYmd };
    case "last_month": {
      const startThis = firstOfMonthYmd(todayYmd);
      const endLast = addDaysYmd(startThis, -1);
      const startLast = firstOfMonthYmd(endLast);
      return { startYmd: startLast, endYmd: endLast };
    }
    case "maximum":
    default:
      return { startYmd: null, endYmd: todayYmd };
  }
}

// Equivalente a COALESCE(approved_at, order_date, created_at) do Postgres,
// tratando string vazia como ausente. Vendas importadas via CSV podem
// chegar com "" em vez de null nas datas.
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

// Filtra um registro de venda pelo intervalo, comparando o dia em SP da
// venda com os bounds em SP do período. Linhas sem data não passam.
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
  const saleYmd = ymdInTz(d);
  const { startYmd, endYmd } = resolveRangeYmd(range);
  if (startYmd && saleYmd < startYmd) return false;
  if (saleYmd > endYmd) return false;
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

// Hoje em SP no formato YYYY-MM-DD — útil em UI ("Vendas de hoje" etc).
export function todayYmdSp(): string {
  return ymdInTz(new Date());
}
