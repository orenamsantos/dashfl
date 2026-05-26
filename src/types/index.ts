export type CampaignStatus = "ACTIVE" | "PAUSED";

export interface AdMetrics {
  spend: number;
  sales: number;
  revenue: number;
  impressions: number;
  clicks: number;
}

export interface Ad extends AdMetrics {
  id: string;
  name: string;
  status: CampaignStatus;
}

export interface AdSet extends AdMetrics {
  id: string;
  name: string;
  status: CampaignStatus;
  ads: Ad[];
}

export interface Campaign extends AdMetrics {
  id: string;
  name: string;
  status: CampaignStatus;
  adsets: AdSet[];
}

export type Checkout = "Hotmart" | "Kiwify" | "Kirvano";
export type SaleStatus = "Aprovada" | "Pendente" | "Reembolsada";
export type SaleType = "Paga" | "Orgânica";

export interface Sale {
  id: string;
  date: string;
  product: string;
  amount: number;
  checkout: Checkout;
  campaign: string | null;
  adset: string | null;
  ad: string | null;
  status: SaleStatus;
  type: SaleType;
}

export interface Fee {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number;
  appliesTo: "revenue" | "commission";
}
