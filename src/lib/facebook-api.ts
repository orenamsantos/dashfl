// Client-side helpers that talk to our OWN server proxy at /api/fb.
// The Facebook token lives ONLY on the server (FACEBOOK_TOKEN env) and is
// never sent to, exposed in, or stored by the browser.

export interface FBInsight {
  spend: number;
  impressions: number;
  clicks: number;
  reach?: number;
  frequency?: number;
  cpm?: number;
  cpc?: number;
  ctr?: number;
}

export interface FBCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  // orçamentos do Meta vêm em UNIDADE MÍNIMA da moeda da conta (centavos)
  daily_budget?: number | null;
  lifetime_budget?: number | null;
  insights: FBInsight;
}

export interface FBAdLite {
  id: string;
  campaign_id: string;
  adset_id: string;
}

export interface FBAdSet {
  id: string;
  name: string;
  status: FBCampaign["status"];
  campaign_id: string;
  insights: FBInsight;
}

export interface FBAd {
  id: string;
  name: string;
  status: FBCampaign["status"];
  adset_id: string;
  campaign_id: string;
  insights: FBInsight;
}

export type DatePreset =
  | "today"
  | "yesterday"
  | "last_7d"
  | "last_30d"
  | "this_month"
  | "last_month"
  | "maximum";

// Período: preset OU intervalo personalizado (YYYY-MM-DD, fuso da conta).
// O backend converte pra `date_preset` ou `time_range` da Graph API.
export type DateRange =
  | { type: "preset"; preset: DatePreset }
  | { type: "custom"; since: string; until: string };

function rangeParams(r: DateRange): Record<string, string> {
  if (r.type === "custom") return { since: r.since, until: r.until };
  return { preset: r.preset };
}

export interface AccountSummary {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
}

async function fb<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/fb?${qs}`);
  const json = await res.json();
  if (json && typeof json === "object" && !Array.isArray(json) && (json as any).error) {
    throw new Error((json as any).error);
  }
  return json as T;
}

export async function fetchFBStatus(): Promise<{
  configured: boolean;
  accountId: string | null;
  timezone?: string | null;
}> {
  return fb({ resource: "status" });
}

const DEFAULT_RANGE: DateRange = { type: "preset", preset: "last_7d" };

export async function fetchAccountInsights(
  range: DateRange = DEFAULT_RANGE,
): Promise<AccountSummary> {
  return fb({ resource: "account_insights", ...rangeParams(range) });
}

export async function fetchAccountTimeseries(
  range: DateRange = DEFAULT_RANGE,
): Promise<{ date: string; spend: number; impressions: number; clicks: number }[]> {
  return fb({ resource: "timeseries", ...rangeParams(range) });
}

export async function fetchCampaigns(
  range: DateRange = DEFAULT_RANGE,
): Promise<FBCampaign[]> {
  return fb({ resource: "campaigns", ...rangeParams(range) });
}

export async function fetchAdSets(
  campaignId: string,
  range: DateRange = DEFAULT_RANGE,
): Promise<FBAdSet[]> {
  return fb({ resource: "adsets", id: campaignId, ...rangeParams(range) });
}

export async function fetchAds(
  adsetId: string,
  range: DateRange = DEFAULT_RANGE,
): Promise<FBAd[]> {
  return fb({ resource: "ads", id: adsetId, ...rangeParams(range) });
}

// Lista enxuta de todos os anúncios da conta (id, campaign_id, adset_id).
// Usada pra mapear utm_term=ad.id → campanha quando agregando vendas.
export async function fetchAllAds(): Promise<FBAdLite[]> {
  return fb({ resource: "all_ads" });
}

// Atualiza o orçamento de uma campanha CBO. O valor é em centavos da moeda
// da conta (USD para contas em USD). A chamada PRECISA passar pelo nosso
// /api/budget (autenticado por cookie + token do servidor) — nunca direto
// do navegador.
export interface UpdateBudgetRequest {
  campaign_id: string;
  daily_budget?: number; // centavos
  lifetime_budget?: number; // centavos
}

export async function updateCampaignBudget(req: UpdateBudgetRequest): Promise<{
  ok: true;
}> {
  const res = await fetch("/api/budget", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  const json = await res.json();
  if (!res.ok || json?.error) {
    const err = new Error(json?.error ?? `HTTP ${res.status}`);
    (err as Error & { permission?: boolean }).permission = Boolean(json?.permission);
    throw err;
  }
  return { ok: true };
}
