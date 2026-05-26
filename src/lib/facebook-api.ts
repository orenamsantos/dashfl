import { getSetting } from "./supabase";

const API = "https://graph.facebook.com/v19.0";

export interface FBInsight {
  spend: number;
  impressions: number;
  clicks: number;
  reach?: number;
  cpm?: number;
  cpc?: number;
  ctr?: number;
}

export interface FBCampaign {
  id: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DELETED" | "ARCHIVED";
  insights: FBInsight;
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

interface FBCreds {
  token: string;
  accountId: string;
}

export async function getFBCreds(): Promise<FBCreds | null> {
  const token = await getSetting("facebook_token");
  const accountId = await getSetting("facebook_ad_account_id");
  if (!token || !accountId) return null;
  return { token, accountId };
}

async function fbFetch<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${API}${path}${sep}access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json as T;
}

function parseInsights(arr: any[] | undefined): FBInsight {
  const i = arr?.[0];
  if (!i) return { spend: 0, impressions: 0, clicks: 0 };
  return {
    spend: Number(i.spend ?? 0),
    impressions: Number(i.impressions ?? 0),
    clicks: Number(i.clicks ?? 0),
    reach: Number(i.reach ?? 0),
    cpm: Number(i.cpm ?? 0),
    cpc: Number(i.cpc ?? 0),
    ctr: Number(i.ctr ?? 0),
  };
}

const INSIGHTS_FIELDS = "spend,impressions,clicks,reach,cpm,cpc,ctr";

export async function fetchCampaigns(
  preset: DatePreset = "last_7d",
): Promise<FBCampaign[]> {
  const creds = await getFBCreds();
  if (!creds) return [];
  const fields = `id,name,status,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
  const json = await fbFetch<{ data: any[] }>(
    `/${creds.accountId}/campaigns?fields=${fields}&limit=200`,
    creds.token,
  );
  return (json.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    insights: parseInsights(c.insights?.data),
  }));
}

export async function fetchAdSets(
  campaignId: string,
  preset: DatePreset = "last_7d",
): Promise<FBAdSet[]> {
  const creds = await getFBCreds();
  if (!creds) return [];
  const fields = `id,name,status,campaign_id,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
  const json = await fbFetch<{ data: any[] }>(
    `/${campaignId}/adsets?fields=${fields}&limit=200`,
    creds.token,
  );
  return (json.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    campaign_id: a.campaign_id,
    insights: parseInsights(a.insights?.data),
  }));
}

export async function fetchAds(
  adsetId: string,
  preset: DatePreset = "last_7d",
): Promise<FBAd[]> {
  const creds = await getFBCreds();
  if (!creds) return [];
  const fields = `id,name,status,adset_id,campaign_id,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
  const json = await fbFetch<{ data: any[] }>(
    `/${adsetId}/ads?fields=${fields}&limit=200`,
    creds.token,
  );
  return (json.data ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    adset_id: a.adset_id,
    campaign_id: a.campaign_id,
    insights: parseInsights(a.insights?.data),
  }));
}

export interface AccountSummary {
  spend: number;
  impressions: number;
  clicks: number;
  cpc: number;
  cpm: number;
  ctr: number;
}

export async function fetchAccountInsights(
  preset: DatePreset = "last_7d",
): Promise<AccountSummary> {
  const creds = await getFBCreds();
  if (!creds)
    return { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 };
  const json = await fbFetch<{ data: any[] }>(
    `/${creds.accountId}/insights?fields=${INSIGHTS_FIELDS}&date_preset=${preset}`,
    creds.token,
  );
  const i = parseInsights(json.data);
  return {
    spend: i.spend,
    impressions: i.impressions,
    clicks: i.clicks,
    cpc: i.cpc ?? 0,
    cpm: i.cpm ?? 0,
    ctr: i.ctr ?? 0,
  };
}

export async function fetchAccountTimeseries(
  preset: DatePreset = "last_7d",
): Promise<{ date: string; spend: number; impressions: number; clicks: number }[]> {
  const creds = await getFBCreds();
  if (!creds) return [];
  const json = await fbFetch<{ data: any[] }>(
    `/${creds.accountId}/insights?fields=spend,impressions,clicks&date_preset=${preset}&time_increment=1`,
    creds.token,
  );
  return (json.data ?? []).map((d) => ({
    date: d.date_start,
    spend: Number(d.spend ?? 0),
    impressions: Number(d.impressions ?? 0),
    clicks: Number(d.clicks ?? 0),
  }));
}
