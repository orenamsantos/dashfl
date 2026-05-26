import type { Campaign, Sale, Fee } from "@/types";

const campaignNames = [
  "Campanha - Curso de Tráfego Pago",
  "Remarketing - Mentoria Premium",
  "Topo de Funil - Ebook Gratuito",
  "Conversão - Consultoria 1:1",
  "Retargeting - Carrinho Abandonado",
  "Campanha - Workshop ao Vivo",
  "Lookalike - Curso de Copywriting",
  "Prospecção - Comunidade VIP",
  "Black Friday - Pacote Completo",
  "Lançamento - Método Express",
];

function metrics(spend: number, sales: number, ticket: number, impr: number, clicks: number) {
  return { spend, sales, revenue: sales * ticket, impressions: impr, clicks };
}

export const mockCampaigns: Campaign[] = campaignNames.map((name, i) => {
  const spend = 800 + i * 350 + (i % 3) * 240;
  const sales = 8 + i * 2 + (i % 4);
  const ticket = 297 + (i % 3) * 100;
  const impr = 12000 + i * 4500;
  const clicks = 380 + i * 90;
  const m = metrics(spend, sales, ticket, impr, clicks);
  return {
    id: `camp-${i + 1}`,
    name,
    status: i % 4 === 0 ? "PAUSED" : "ACTIVE",
    ...m,
    adsets: Array.from({ length: 2 }).map((_, j) => {
      const sm = metrics(spend / 2, Math.ceil(sales / 2), ticket, impr / 2, clicks / 2);
      return {
        id: `as-${i + 1}-${j + 1}`,
        name: `Conjunto ${j + 1} - ${name.split(" - ")[1] ?? name}`,
        status: "ACTIVE" as const,
        ...sm,
        ads: Array.from({ length: 2 }).map((_, k) => {
          const am = metrics(sm.spend / 2, Math.ceil(sm.sales / 2), ticket, sm.impressions / 2, sm.clicks / 2);
          return {
            id: `ad-${i + 1}-${j + 1}-${k + 1}`,
            name: `Anúncio ${k + 1} - Criativo ${["Vídeo", "Imagem"][k]}`,
            status: "ACTIVE" as const,
            ...am,
          };
        }),
      };
    }),
  };
});

const products = [
  "Curso de Tráfego Pago",
  "Mentoria Premium",
  "Ebook - Copywriting",
  "Consultoria 1:1",
  "Pacote Completo",
  "Workshop ao Vivo",
];
const checkouts = ["Hotmart", "Kiwify", "Kirvano"] as const;
const statuses = ["Aprovada", "Aprovada", "Aprovada", "Pendente", "Reembolsada"] as const;
const types = ["Paga", "Paga", "Paga", "Orgânica"] as const;

export const mockSales: Sale[] = Array.from({ length: 28 }).map((_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (i % 14));
  const camp = mockCampaigns[i % mockCampaigns.length];
  const adset = camp.adsets[i % camp.adsets.length];
  const ad = adset.ads[i % adset.ads.length];
  const type = types[i % types.length];
  return {
    id: `sale-${i + 1}`,
    date: d.toISOString(),
    product: products[i % products.length],
    amount: [197, 297, 497, 997, 1497][i % 5],
    checkout: checkouts[i % checkouts.length],
    campaign: type === "Paga" ? camp.name : null,
    adset: type === "Paga" ? adset.name : null,
    ad: type === "Paga" ? ad.name : null,
    status: statuses[i % statuses.length],
    type,
  };
});

export const mockFees: Fee[] = [
  { id: "fee-1", name: "Taxa Hotmart", kind: "percent", value: 9.9, appliesTo: "revenue" },
  { id: "fee-2", name: "Imposto Simples", kind: "percent", value: 6, appliesTo: "revenue" },
];

export function getDashboardSummary() {
  const totals = mockCampaigns.reduce(
    (acc, c) => ({
      spend: acc.spend + c.spend,
      revenue: acc.revenue + c.revenue,
      sales: acc.sales + c.sales,
    }),
    { spend: 0, revenue: 0, sales: 0 },
  );
  const feeRate = mockFees.reduce((a, f) => a + (f.kind === "percent" ? f.value : 0), 0) / 100;
  const net = totals.revenue * (1 - feeRate);
  return {
    grossRevenue: totals.revenue,
    netRevenue: net,
    adSpend: totals.spend,
    roi: ((totals.revenue - totals.spend) / totals.spend) * 100,
    roas: totals.revenue / totals.spend,
    cpa: totals.spend / Math.max(totals.sales, 1),
    salesCount: totals.sales,
  };
}

export function getTimeseries() {
  return Array.from({ length: 14 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return {
      date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      faturamento: Math.round(2500 + Math.sin(i / 2) * 1200 + i * 180),
      gasto: Math.round(900 + Math.cos(i / 2) * 400 + i * 60),
    };
  });
}

export function getSalesBySource() {
  return [
    { name: "Facebook", value: 62 },
    { name: "Orgânico", value: 18 },
    { name: "WhatsApp", value: 12 },
    { name: "Outros", value: 8 },
  ];
}
