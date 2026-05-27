// Atribui uma venda a um anúncio ou campanha do Meta, na ordem:
//   1. utm_term = ad.id do Meta (numérico) → match por ANÚNCIO
//   2. utm_campaign = nome da campanha do Meta → match por CAMPANHA
//   3. src = código tipo "cp03-vtx-br" → fallback por CAMPANHA (substring)
//   4. Nada disso → "unassigned" (orgânico / direto)

import { isApprovedStatus, isRefundStatus } from "./status";

export type AttributionLevel =
  | "ad"
  | "campaign"
  | "campaign_src"
  | "unassigned";

export interface SaleAttribution {
  level: AttributionLevel;
  adId?: string;
  campaignId?: string;
}

export interface AttributableSale {
  utm_term?: string | null;
  utm_campaign?: string | null;
  src?: string | null;
}

export interface FBAdLite {
  id: string;
  campaign_id: string;
}

export interface FBCampaignLite {
  id: string;
  name: string;
}

function normalize(s: string | null | undefined): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export interface AttributionIndex {
  adsById: Map<string, FBAdLite>;
  campaignsByName: Map<string, FBCampaignLite>;
  // lista ordenada por nome decrescente, pra match por substring (src)
  campaignsList: { norm: string; campaign: FBCampaignLite }[];
}

export function buildIndex(
  campaigns: FBCampaignLite[],
  ads: FBAdLite[],
): AttributionIndex {
  const adsById = new Map<string, FBAdLite>();
  for (const ad of ads) adsById.set(ad.id, ad);
  const campaignsByName = new Map<string, FBCampaignLite>();
  const campaignsList: { norm: string; campaign: FBCampaignLite }[] = [];
  for (const c of campaigns) {
    const n = normalize(c.name);
    campaignsByName.set(n, c);
    campaignsList.push({ norm: n, campaign: c });
  }
  return { adsById, campaignsByName, campaignsList };
}

function matchSrc(
  src: string,
  index: AttributionIndex,
): FBCampaignLite | undefined {
  const s = normalize(src);
  if (!s) return undefined;
  // 1) match exato pelo nome inteiro (raro mas barato)
  const exact = index.campaignsByName.get(s);
  if (exact) return exact;
  // 2) substring: o "src" geralmente é um código contido no nome da campanha
  //    (ex.: nome "FB-CONV CP03-VTX-BR 01" contém src "cp03-vtx-br")
  for (const entry of index.campaignsList) {
    if (entry.norm.includes(s)) return entry.campaign;
  }
  return undefined;
}

export function classify(sale: AttributableSale): {
  kind: "ad_id" | "campaign_name" | "src" | "none";
  value: string;
} {
  const term = String(sale.utm_term ?? "").trim();
  if (term && /^\d{6,}$/.test(term)) return { kind: "ad_id", value: term };
  const campaign = String(sale.utm_campaign ?? "").trim();
  if (campaign) return { kind: "campaign_name", value: campaign };
  const src = String(sale.src ?? "").trim();
  if (src) return { kind: "src", value: src };
  return { kind: "none", value: "" };
}

export function attributeSale(
  sale: AttributableSale,
  index: AttributionIndex,
): SaleAttribution {
  const c = classify(sale);
  if (c.kind === "ad_id") {
    const ad = index.adsById.get(c.value);
    if (ad) return { level: "ad", adId: ad.id, campaignId: ad.campaign_id };
    // ID parece de anúncio mas não foi encontrado; tenta os fallbacks
    if (sale.utm_campaign) {
      const camp = index.campaignsByName.get(normalize(sale.utm_campaign));
      if (camp) return { level: "campaign", campaignId: camp.id };
    }
    if (sale.src) {
      const camp = matchSrc(sale.src, index);
      if (camp) return { level: "campaign_src", campaignId: camp.id };
    }
    return { level: "unassigned" };
  }
  if (c.kind === "campaign_name") {
    const camp = index.campaignsByName.get(normalize(c.value));
    if (camp) return { level: "campaign", campaignId: camp.id };
    if (sale.src) {
      const fb = matchSrc(sale.src, index);
      if (fb) return { level: "campaign_src", campaignId: fb.id };
    }
    return { level: "unassigned" };
  }
  if (c.kind === "src") {
    const camp = matchSrc(c.value, index);
    if (camp) return { level: "campaign_src", campaignId: camp.id };
    return { level: "unassigned" };
  }
  return { level: "unassigned" };
}

export interface SaleMetricsRow {
  amount: number | null;
  net_amount: number | null;
  status: string | null;
}

export interface AggregatedSales {
  sales: number;
  revenue: number; // bruto, só aprovados (consistente com o dashboard)
}

export function aggregateApproved(rows: SaleMetricsRow[]): AggregatedSales {
  let sales = 0;
  let revenue = 0;
  for (const r of rows) {
    if (!isApprovedStatus(r.status)) continue;
    sales += 1;
    revenue += Number(r.amount ?? 0);
  }
  return { sales, revenue };
}

export function isRefund(status: string | null | undefined): boolean {
  return isRefundStatus(status);
}
