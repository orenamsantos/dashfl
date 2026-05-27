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
}> {
  return fb({ resource: "status" });
}

export async function fetchAccountInsights(
  preset: DatePreset = "last_7d",
): Promise<AccountSummary> {
  return fb({ resource: "account_insights", preset });
}

export async function fetchAccountTimeseries(
  preset: DatePreset = "last_7d",
): Promise<{ date: string; spend: number; impressions: number; clicks: number }[]> {
  return fb({ resource: "timeseries", preset });
}

export async function fetchCampaigns(
  preset: DatePreset = "last_7d",
): Promise<FBCampaign[]> {
  return fb({ resource: "campaigns", preset });
}

export async function fetchAdSets(
  campaignId: string,
  preset: DatePreset = "last_7d",
): Promise<FBAdSet[]> {
  return fb({ resource: "adsets", id: campaignId, preset });
}

export async function fetchAds(
  adsetId: string,
  preset: DatePreset = "last_7d",
): Promise<FBAd[]> {
  return fb({ resource: "ads", id: adsetId, preset });
}

// Lista enxuta de todos os anúncios da conta (id, campaign_id, adset_id).
// Usada pra mapear utm_term=ad.id → campanha quando agregando vendas.
export async function fetchAllAds(): Promise<FBAdLite[]> {
  return fb({ resource: "all_ads" });
}
