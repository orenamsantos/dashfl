// USD→BRL exchange rate from AwesomeAPI (free, no key).
// Cached 1h client-side via React Query.
export interface FxRate {
  rate: number;
  fetchedAt: string;
  source: "awesomeapi" | "manual" | "fallback";
}

const FALLBACK_RATE = 5.2;

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
