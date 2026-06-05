// USD→BRL exchange rate from AwesomeAPI (free, no key).
// Cached 1h client-side via React Query.
export interface FxRate {
  rate: number;
  fetchedAt: string;
  source: "awesomeapi" | "manual" | "fallback";
}

export const FALLBACK_RATE = 5.2;

export type FxMode = "auto" | "manual";

// Cotação efetiva usada nos cálculos: se o modo for "manual" e o valor for
// válido, usa o dólar que o Flavio definiu; senão cai pra cotação ao vivo;
// e por último o fallback. É isto que conserta o "tudo errado" quando a
// conta é em USD e a venda em BRL.
export function effectiveRate(opts: {
  mode: FxMode | null | undefined;
  manualRate: number | null | undefined;
  liveRate: number | null | undefined;
  liveSource?: FxRate["source"];
}): { rate: number; source: FxRate["source"] } {
  if (opts.mode === "manual" && opts.manualRate && opts.manualRate > 0) {
    return { rate: opts.manualRate, source: "manual" };
  }
  if (opts.liveRate && opts.liveRate > 0) {
    return { rate: opts.liveRate, source: opts.liveSource ?? "awesomeapi" };
  }
  return { rate: FALLBACK_RATE, source: "fallback" };
}

export async function fetchUsdBrl(): Promise<FxRate> {
  try {
    const res = await fetch(
      "https://economia.awesomeapi.com.br/json/last/USD-BRL",
      { cache: "no-store" },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const bid = Number(json?.USDBRL?.bid);
    if (!bid || Number.isNaN(bid)) throw new Error("invalid bid");
    return {
      rate: bid,
      fetchedAt: new Date().toISOString(),
      source: "awesomeapi",
    };
  } catch {
    return {
      rate: FALLBACK_RATE,
      fetchedAt: new Date().toISOString(),
      source: "fallback",
    };
  }
}
