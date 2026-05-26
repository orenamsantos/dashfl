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
  // pendente
  pending: "Pendente",
  pendente: "Pendente",
  waiting_payment: "Pendente",
  "aguardando pagamento": "Pendente",
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
};

export function normalizeStatus(s: unknown): string {
  const v = String(s ?? "").trim().toLowerCase();
  return STATUS_MAP[v] ?? (s ? String(s) : "Pendente");
}

const APPROVED = new Set(["aprovada"]);
const REFUND = new Set(["reembolsada"]);

// Apenas status explicitamente aprovado conta como faturamento.
// Status vazio/desconhecido NÃO conta (corrige bug do dashboard).
export function isApprovedStatus(s: string | null | undefined): boolean {
  return APPROVED.has(normalizeStatus(s).toLowerCase());
}

export function isRefundStatus(s: string | null | undefined): boolean {
  return REFUND.has(normalizeStatus(s).toLowerCase());
}
