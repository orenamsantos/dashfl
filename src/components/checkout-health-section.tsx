import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import { brl, num } from "@/lib/format";
import { normalizeStatus } from "@/lib/status";

// Linhas que o Dashboard nos manda — superset do que vem do supabase pra
// não acoplar este componente à query de lá.
export interface CheckoutSaleRow {
  amount: number | null;
  net_amount?: number | null;
  status: string | null;
  payment_method?: string | null;
  product?: string | null;
  product_name?: string | null;
  approved_at: string | null;
  order_date: string | null;
  created_at: string | null;
}

// Pix verde (o desejável), cartão azul, boleto âmbar, outros violeta.
const PIE_COLORS = [
  "var(--color-success)",
  "var(--color-info)",
  "var(--color-warning)",
  "var(--color-chart-5)",
];

function isPix(m: string | null | undefined): boolean {
  if (!m) return false;
  return /^pix$/i.test(m.trim());
}
function isCartao(m: string | null | undefined): boolean {
  if (!m) return false;
  const k = m.toLowerCase();
  return (
    k.includes("cart") || k === "credit_card" || k === "creditcard"
  );
}
function isBoleto(m: string | null | undefined): boolean {
  if (!m) return false;
  const k = m.toLowerCase();
  return k.includes("boleto") || k.includes("bank_slip") || k === "bankslip";
}

function getEventDate(r: CheckoutSaleRow): Date | null {
  const raw = r.approved_at ?? r.order_date ?? r.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    Aprovada: "bg-[var(--color-success)]/15 text-[var(--color-success)]",
    Pendente: "bg-amber-500/15 text-amber-500",
    Expirada: "bg-muted text-muted-foreground",
    Reembolsada: "bg-destructive/15 text-destructive",
    Recusada: "bg-destructive/15 text-destructive",
    Abandonada: "bg-muted text-muted-foreground",
  };
  const cls = map[status] ?? "bg-muted text-muted-foreground";
  return <Badge className={`${cls} border-0`}>{status}</Badge>;
}

export function CheckoutHealthSection({ rows }: { rows: CheckoutSaleRow[] }) {
  const stats = useMemo(() => {
    const total = rows.length;
    const byStatus = new Map<string, { count: number; amount: number }>();
    for (const r of rows) {
      const s = normalizeStatus(r.status);
      const entry = byStatus.get(s) ?? { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += Number(r.amount ?? 0);
      byStatus.set(s, entry);
    }

    const pixRows = rows.filter((r) => isPix(r.payment_method));
    const pixGerados = pixRows.length;
    const pixPagos = pixRows.filter(
      (r) => normalizeStatus(r.status) === "Aprovada",
    ).length;
    const pixExpirados = pixRows.filter(
      (r) => normalizeStatus(r.status) === "Expirada",
    );
    const pixExpiradosValor = pixExpirados.reduce(
      (acc, r) => acc + Number(r.amount ?? 0),
      0,
    );

    // Mix considerando APENAS vendas aprovadas (foi o que de fato converteu)
    const approvedRows = rows.filter(
      (r) => normalizeStatus(r.status) === "Aprovada",
    );
    const mix = {
      pix: approvedRows.filter((r) => isPix(r.payment_method)).length,
      cartao: approvedRows.filter((r) => isCartao(r.payment_method)).length,
      boleto: approvedRows.filter((r) => isBoleto(r.payment_method)).length,
      outros: approvedRows.filter(
        (r) =>
          !isPix(r.payment_method) &&
          !isCartao(r.payment_method) &&
          !isBoleto(r.payment_method),
      ).length,
    };

    const approved = byStatus.get("Aprovada")?.count ?? 0;
    const refunded = byStatus.get("Reembolsada")?.count ?? 0;
    // Taxa de aprovação = aprovadas / (total de tentativas que viraram desfecho)
    const decided = total; // inclui aprovadas, recusadas, reembolsadas, expiradas, etc.
    const approvalRate = decided > 0 ? (approved / decided) * 100 : 0;
    // Taxa de reembolso = reembolsadas / aprovadas (proxy do prejuízo pós-venda)
    const refundRate = approved > 0 ? (refunded / approved) * 100 : 0;

    return {
      total,
      approved,
      refunded,
      approvalRate,
      refundRate,
      pix: { gerados: pixGerados, pagos: pixPagos, expirados: pixExpirados.length, valorExpirado: pixExpiradosValor },
      mix,
    };
  }, [rows]);

  const recent = useMemo(() => {
    return [...rows]
      .map((r) => ({ row: r, date: getEventDate(r) }))
      .filter((e) => e.date)
      .sort((a, b) => (b.date as Date).getTime() - (a.date as Date).getTime())
      .slice(0, 10)
      .map((e) => e.row);
  }, [rows]);

  const mixData = [
    { name: "Pix", value: stats.mix.pix },
    { name: "Cartão", value: stats.mix.cartao },
    { name: "Boleto", value: stats.mix.boleto },
    { name: "Outros", value: stats.mix.outros },
  ].filter((d) => d.value > 0);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Saúde do Checkout</h2>
        <p className="text-sm text-muted-foreground">
          Conversão por método de pagamento e taxas que mexem com o caixa.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Pix gerados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{num(stats.pix.gerados)}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {num(stats.pix.pagos)} pagos • {num(stats.pix.expirados)} expirados
            </div>
          </CardContent>
        </Card>
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-amber-500 uppercase tracking-wide">
              Pix expirados (recuperável)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold text-amber-500">
              {brl(stats.pix.valorExpirado)}
            </div>
            <CardDescription className="mt-1">
              Dinheiro que pode ser recuperado com follow-up.
            </CardDescription>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Taxa de aprovação
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {stats.approvalRate.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {num(stats.approved)} aprovadas de {num(stats.total)} vendas
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Reembolso / Chargeback
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {stats.refundRate.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {num(stats.refunded)} sobre {num(stats.approved)} aprovadas
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Mix de pagamento</CardTitle>
            <CardDescription>Apenas vendas aprovadas.</CardDescription>
          </CardHeader>
          <CardContent className="h-64">
            {mixData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Sem vendas aprovadas no período.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={mixData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {mixData.map((_, i) => (
                      <Cell
                        key={i}
                        fill={PIE_COLORS[i % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "var(--color-popover)",
                      border: "1px solid var(--color-border)",
                      borderRadius: 10,
                      fontSize: 12,
                      boxShadow: "0 20px 40px -20px #000",
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Vendas recentes</CardTitle>
            <CardDescription>Últimas 10 do período selecionado.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-muted-foreground py-6"
                    >
                      Nenhuma venda no período.
                    </TableCell>
                  </TableRow>
                )}
                {recent.map((r, i) => {
                  const name = r.product_name ?? r.product ?? "—";
                  const status = normalizeStatus(r.status);
                  return (
                    <TableRow key={i}>
                      <TableCell className="font-medium max-w-[220px] truncate">
                        {name}
                      </TableCell>
                      <TableCell className="text-right">
                        {brl(Number(r.amount ?? 0))}
                      </TableCell>
                      <TableCell>{r.payment_method ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge status={status} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
