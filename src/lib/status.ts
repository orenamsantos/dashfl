// Vocabulário canônico de status, compartilhado entre o webhook (vendas novas)
// e a importação de CSV (histórico). Mantém os dois 100% consistentes para que
// os filtros do dashboard peguem ambas as origens.

export const STATUS_MAP: Record<string, string> = {
  // aprovada
  authorized: "Aprovada",
  autorizado: "Aprovada",
  autorizada: "Aprovada",
  approved: "Aprovada",
  aprovada: "Aprovada",
  aprovado: "Aprovada",
  pago: "Aprovada",
  paga: "Aprovada",
  paid: "Aprovada",
  // pendente (inclui Pix gerado / boleto impresso aguardando pagamento)
  pending: "Pendente",
  pendente: "Pendente",
  waiting_payment: "Pendente",
  "aguardando pagamento": "Pendente",
  pix_created: "Pendente",
  "pix gerado": "Pendente",
  bank_slip_created: "Pendente",
  "boleto impresso": "Pendente",
  // reembolsada / estorno / chargeback / cancelamento
  refunded: "Reembolsada",
  reembolsada: "Reembolsada",
  reembolsado: "Reembolsada",
  chargeback: "Reembolsada",
  estornada: "Reembolsada",
  estornado: "Reembolsada",
  canceled: "Reembolsada",
  cancelled: "Reembolsada",
  cancelada: "Reembolsada",
  cancelado: "Reembolsada",
  // recusada (NÃO é reembolso!)
  refused: "Recusada",
  recusada: "Recusada",
  recusado: "Recusada",
  // expirada
  expirado: "Expirada",
  expirada: "Expirada",
  pix_expired: "Expirada",
  // abandonada
  abandoned_cart: "Abandonada",
  abandonada: "Abandonada",
};

export function normalizeStatus(s: unknown): string {
  const v = String(s ?? "").trim().toLowerCase();
  return STATUS_MAP[v] ?? (s ? String(s) : "Pendente");
}

const APPROVED = new Set(["aprovada"]);
const REFUND = new Set(["reembolsada"]);

// Os ÚNICOS status que entram nos KPIs de faturamento/lucro (valor canônico
// gravado na coluna `status`). As leituras de KPI (dashboard/campanhas) filtram
// por estes no SERVIDOR — assim não baixam o lixo de webhook (Abandonada/
// Expirada/Recusada/Pendente) que só incha a tabela rumo ao teto de 1000 linhas
// do PostgREST e fazia o faturamento "bugar" (subconjunto instável) ao cruzá-lo.
export const REVENUE_STATUSES = ["Aprovada", "Reembolsada"] as const;

// Apenas status explicitamente aprovado conta como faturamento.
// Status vazio/desconhecido NÃO conta (corrige bug do dashboard).
export function isApprovedStatus(s: string | null | undefined): boolean {
  return APPROVED.has(normalizeStatus(s).toLowerCase());
}

export function isRefundStatus(s: string | null | undefined): boolean {
  return REFUND.has(normalizeStatus(s).toLowerCase());
}
