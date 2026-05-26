import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Loader2 } from "lucide-react";
import { brl, num } from "@/lib/format";
import {
  fetchAccountInsights,
  fetchAccountTimeseries,
  fetchCampaigns,
  type DatePreset,
} from "@/lib/facebook-api";
import { fetchUsdBrl } from "@/lib/currency";
import { supabase } from "@/lib/supabase";
import { isApprovedStatus, isRefundStatus } from "@/lib/status";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — AdsTracker" }] }),
  component: DashboardPage,
});

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

type SaleSummaryRow = {
  amount: number | null;
  net_amount?: number | null;
  status: string | null;
  approved_at: string | null;
  order_date: string | null;
  created_at: string | null;
};

function isApprovedSaleStatus(status: string | null | undefined) {
  // usa o helper compartilhado: status vazio/desconhecido NÃO conta como aprovado
  return isApprovedStatus(status);
}

function getSaleEventDate(sale: SaleSummaryRow) {
  const rawDate = sale.approved_at ?? sale.order_date ?? sale.created_at;
  if (!rawDate) return null;

  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isSaleInPreset(sale: SaleSummaryRow, preset: DatePreset) {
  const date = getSaleEventDate(sale);
  if (!date) return false;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  switch (preset) {
    case "today":
      return date >= startOfToday;
    case "yesterday": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 1);
      return date >= start && date < startOfToday;
    }
    case "last_7d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 6);
      return date >= start;
    }
    case "last_30d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 29);
      return date >= start;
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return date >= start;
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      return date >= start && date < end;
    }
    case "maximum":
    default:
      return true;
  }
}

function DashboardPage() {
  const [preset, setPreset] = useState<DatePreset>("last_7d");
  // base do ROAS/ROI: bruto (padrão) ou líquido
  const [revenueMode, setRevenueMode] = useState<"gross" | "net">("gross");

  const fx = useQuery({
    queryKey: ["fx-usd-brl"],
    queryFn: fetchUsdBrl,
    staleTime: 1000 * 60 * 60, // 1h
  });
  const rate = fx.data?.rate ?? 5.2;

  const summary = useQuery({
    queryKey: ["fb-summary", preset],
    queryFn: () => fetchAccountInsights(preset),
  });

  const ts = useQuery({
    queryKey: ["fb-timeseries", preset],
    queryFn: () => fetchAccountTimeseries(preset),
  });

  const top = useQuery({
    queryKey: ["fb-campaigns-top", preset],
    queryFn: () => fetchCampaigns(preset),
  });

  const sales = useQuery({
    queryKey: ["sales-summary", preset],
    queryFn: async () => {
      if (!supabase)
        return { gross: 0, net: 0, refunds: 0, count: 0, refundCount: 0 };
      const { data, error } = await supabase
        .from("sales")
        .select("amount,net_amount,status,approved_at,order_date,created_at")
        .limit(5000);
      if (error)
        return { gross: 0, net: 0, refunds: 0, count: 0, refundCount: 0 };
      const inPeriod = ((data ?? []) as SaleSummaryRow[]).filter((s) =>
        isSaleInPreset(s, preset),
      );
      const approved = inPeriod.filter((s) => isApprovedSaleStatus(s.status));
      const refunded = inPeriod.filter((s) => isRefundStatus(s.status));
      return {
        // dois totais consistentes — sem misturar bruto e líquido
        gross: approved.reduce((sum, s) => sum + Number(s.amount ?? 0), 0),
        net: approved.reduce((sum, s) => sum + Number(s.net_amount ?? 0), 0),
        refunds: refunded.reduce((sum, s) => sum + Number(s.amount ?? 0), 0),
        count: approved.length,
        refundCount: refunded.length,
      };
    },
  });

  const topCampaigns = useMemo(
    () =>
      [...(top.data ?? [])]
        .sort((a, b) => b.insights.spend - a.insights.spend)
        .slice(0, 5),
    [top.data],
  );

  const spendUsd = summary.data?.spend ?? 0;
  const spend = spendUsd * rate; // BRL
  const grossRevenue = sales.data?.gross ?? 0;
  const netRevenue = sales.data?.net ?? 0;
  const refunds = sales.data?.refunds ?? 0;
  const refundCount = sales.data?.refundCount ?? 0;
  // base do ROAS/ROI conforme o toggle (líquido já desconta reembolsos)
  const revenue =
    revenueMode === "net" ? netRevenue - refunds : grossRevenue;
  const salesCount = sales.data?.count ?? 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;
  const cpa = salesCount > 0 ? spend / salesCount : 0;
  const refundRate =
    salesCount > 0 ? (refundCount / salesCount) * 100 : 0;

  const chartData = (ts.data ?? []).map((d) => ({
    date: new Date(d.date).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    }),
    gasto: d.spend * rate,
    cliques: d.clicks,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Métricas ao vivo do Facebook Ads + vendas.
            {fx.data ? (
              <span className="ml-2">
                USD→BRL: <strong>{rate.toFixed(4)}</strong>
                {fx.data.source === "fallback" && " (fallback)"}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={revenueMode} onValueChange={(v) => setRevenueMode(v as "gross" | "net")}>
            <TabsList>
              <TabsTrigger value="gross">Bruto</TabsTrigger>
              <TabsTrigger value="net">Líquido</TabsTrigger>
            </TabsList>
          </Tabs>
          <Tabs value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
            <TabsList>
              <TabsTrigger value="today">Hoje</TabsTrigger>
              <TabsTrigger value="last_7d">7 dias</TabsTrigger>
              <TabsTrigger value="last_30d">30 dias</TabsTrigger>
              <TabsTrigger value="this_month">Mês</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {summary.isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Carregando dados...
        </div>
      ) : summary.error ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            {(summary.error as Error).message}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
            <Metric label="Gasto com Ads" value={brl(spend)} />
            <Metric label="Faturamento Bruto" value={brl(grossRevenue)} />
            <Metric label="Faturamento Líquido" value={brl(netRevenue)} />
            <Metric label="Reembolsos" value={`${brl(refunds)} (${refundRate.toFixed(1)}%)`} />
            <Metric label="ROI" value={`${roi.toFixed(1)}%`} />
            <Metric label="ROAS" value={`${roas.toFixed(2)}x`} />
            <Metric label="CPA" value={brl(cpa)} />
            <Metric label="Vendas" value={num(salesCount)} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Gasto diário</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {ts.isLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Carregando...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="rgba(255,255,255,0.06)"
                    />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                    <YAxis stroke="#94a3b8" fontSize={12} />
                    <Tooltip
                      contentStyle={{
                        background: "#1A1A2E",
                        border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: 8,
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="gasto"
                      stroke="#74B9FF"
                      strokeWidth={2}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="cliques"
                      stroke="#00B894"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top 5 Campanhas (por gasto)</CardTitle>
            </CardHeader>
            <CardContent>
              {top.isLoading ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
                  Carregando...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead className="text-right">Gasto</TableHead>
                      <TableHead className="text-right">Impressões</TableHead>
                      <TableHead className="text-right">Cliques</TableHead>
                      <TableHead className="text-right">CPC</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topCampaigns.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={5}
                          className="text-center text-muted-foreground py-6"
                        >
                          Nenhuma campanha com dados no período.
                        </TableCell>
                      </TableRow>
                    )}
                    {topCampaigns.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-right">
                          {brl(c.insights.spend * rate)}
                        </TableCell>
                        <TableCell className="text-right">
                          {num(c.insights.impressions)}
                        </TableCell>
                        <TableCell className="text-right">
                          {num(c.insights.clicks)}
                        </TableCell>
                        <TableCell className="text-right">
                          {brl((c.insights.cpc ?? 0) * rate)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
