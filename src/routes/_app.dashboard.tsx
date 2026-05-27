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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Loader2 } from "lucide-react";
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
import { brl, num } from "@/lib/format";
import {
  fetchAccountInsights,
  fetchAccountTimeseries,
  fetchCampaigns,
  type DatePreset,
  type DateRange,
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
import { CheckoutHealthSection } from "@/components/checkout-health-section";

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

function getSaleEventDate(sale: SaleSummaryRow) {
  const rawDate = sale.approved_at ?? sale.order_date ?? sale.created_at;
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Resolve um DateRange (preset OU custom) em {start, end} no fuso local.
// Usado pra filtrar as vendas do banco. O Meta lida com o mesmo intervalo via
// `time_range` no servidor.
function resolveRange(range: DateRange): { start: Date | null; end: Date } {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfNow = new Date(now);

  if (range.type === "custom") {
    const start = new Date(`${range.since}T00:00:00`);
    const end = new Date(`${range.until}T23:59:59`);
    return { start, end };
  }

  switch (range.preset) {
    case "today":
      return { start: startOfToday, end: endOfNow };
    case "yesterday": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 1);
      const end = new Date(startOfToday);
      end.setMilliseconds(-1);
      return { start, end };
    }
    case "last_7d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 6);
      return { start, end: endOfNow };
    }
    case "last_30d": {
      const start = new Date(startOfToday);
      start.setDate(start.getDate() - 29);
      return { start, end: endOfNow };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: endOfNow };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      end.setMilliseconds(-1);
      return { start, end };
    }
    case "maximum":
    default:
      return { start: null, end: endOfNow };
  }
}

function isSaleInRange(sale: SaleSummaryRow, range: DateRange) {
  const d = getSaleEventDate(sale);
  if (!d) return false;
  const { start, end } = resolveRange(range);
  if (start && d < start) return false;
  if (d > end) return false;
  return true;
}

function fmtIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtBrDate(d: Date): string {
  return d.toLocaleDateString("pt-BR");
}

const PRESET_LABELS: Record<DatePreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7d: "Últimos 7 dias",
  last_30d: "Últimos 30 dias",
  this_month: "Este mês",
  last_month: "Mês passado",
  maximum: "Tudo",
};

// Picker de período: preset + intervalo personalizado num único controle.
function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange;
  onChange: (r: DateRange) => void;
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [draftSince, setDraftSince] = useState<Date | undefined>();
  const [draftUntil, setDraftUntil] = useState<Date | undefined>();

  function applyCustom() {
    if (!draftSince || !draftUntil) return;
    const since = draftSince <= draftUntil ? draftSince : draftUntil;
    const until = draftSince <= draftUntil ? draftUntil : draftSince;
    onChange({
      type: "custom",
      since: fmtIsoDate(since),
      until: fmtIsoDate(until),
    });
    setCalendarOpen(false);
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Select
        value={value.type === "preset" ? value.preset : "__custom"}
        onValueChange={(v) => {
          if (v === "__custom") return;
          onChange({ type: "preset", preset: v as DatePreset });
        }}
      >
        <SelectTrigger className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="today">{PRESET_LABELS.today}</SelectItem>
          <SelectItem value="yesterday">{PRESET_LABELS.yesterday}</SelectItem>
          <SelectItem value="last_7d">{PRESET_LABELS.last_7d}</SelectItem>
          <SelectItem value="last_30d">{PRESET_LABELS.last_30d}</SelectItem>
          <SelectItem value="this_month">{PRESET_LABELS.this_month}</SelectItem>
          <SelectItem value="last_month">{PRESET_LABELS.last_month}</SelectItem>
          <SelectItem value="maximum">{PRESET_LABELS.maximum}</SelectItem>
          {value.type === "custom" && (
            <SelectItem value="__custom">
              {fmtBrDate(new Date(`${value.since}T00:00:00`))} →{" "}
              {fmtBrDate(new Date(`${value.until}T00:00:00`))}
            </SelectItem>
          )}
        </SelectContent>
      </Select>
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <CalendarIcon className="h-4 w-4" />
            <span className="hidden sm:inline">Personalizado</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="end">
          <div className="space-y-3">
            <Calendar
              mode="range"
              selected={{ from: draftSince, to: draftUntil }}
              onSelect={(r) => {
                setDraftSince(r?.from);
                setDraftUntil(r?.to);
              }}
              numberOfMonths={2}
              defaultMonth={
                value.type === "custom"
                  ? new Date(`${value.since}T00:00:00`)
                  : undefined
              }
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDraftSince(undefined);
                  setDraftUntil(undefined);
                  setCalendarOpen(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                onClick={applyCustom}
                disabled={!draftSince || !draftUntil}
              >
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DashboardPage() {
  const [range, setRange] = useState<DateRange>({
    type: "preset",
    preset: "last_7d",
  });
  // base do ROAS/ROI: bruto (padrão) ou líquido
  const [revenueMode, setRevenueMode] = useState<"gross" | "net">("gross");

  const fx = useQuery({
    queryKey: ["fx-usd-brl"],
    queryFn: fetchUsdBrl,
    staleTime: 1000 * 60 * 60, // 1h
  });
  const rate = fx.data?.rate ?? 5.2;

  // chave estável da query (DateRange é objeto, então serializamos)
  const rangeKey =
    range.type === "preset" ? range.preset : `custom:${range.since}:${range.until}`;

  const summary = useQuery({
    queryKey: ["fb-summary", rangeKey],
    queryFn: () => fetchAccountInsights(range),
  });

  const ts = useQuery({
    queryKey: ["fb-timeseries", rangeKey],
    queryFn: () => fetchAccountTimeseries(range),
  });

  const top = useQuery({
    queryKey: ["fb-campaigns-top", rangeKey],
    queryFn: () => fetchCampaigns(range),
  });

  const sales = useQuery({
    queryKey: ["sales-summary", rangeKey],
    queryFn: async () => {
      if (!supabase)
        return {
          gross: 0,
          net: 0,
          refunds: 0,
          count: 0,
          refundCount: 0,
          rows: [] as SaleSummaryRow[],
        };
      const { data, error } = await supabase
        .from("sales")
        .select("amount,net_amount,status,approved_at,order_date,created_at,product,product_name,payment_method")
        .limit(10000);
      if (error)
        return {
          gross: 0,
          net: 0,
          refunds: 0,
          count: 0,
          refundCount: 0,
          rows: [] as SaleSummaryRow[],
        };
      const inPeriod = ((data ?? []) as SaleSummaryRow[]).filter((s) =>
        isSaleInRange(s, range),
      );
      const approved = inPeriod.filter((s) => isApprovedStatus(s.status));
      const refunded = inPeriod.filter((s) => isRefundStatus(s.status));
      return {
        gross: approved.reduce((sum, s) => sum + Number(s.amount ?? 0), 0),
        net: approved.reduce((sum, s) => sum + Number(s.net_amount ?? 0), 0),
        refunds: refunded.reduce((sum, s) => sum + Number(s.amount ?? 0), 0),
        count: approved.length,
        refundCount: refunded.length,
        rows: inPeriod,
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
  const revenue = revenueMode === "net" ? netRevenue - refunds : grossRevenue;
  const salesCount = sales.data?.count ?? 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;
  const cpa = salesCount > 0 ? spend / salesCount : 0;
  const refundRate = salesCount > 0 ? (refundCount / salesCount) * 100 : 0;

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
          <Tabs
            value={revenueMode}
            onValueChange={(v) => setRevenueMode(v as "gross" | "net")}
          >
            <TabsList>
              <TabsTrigger value="gross">Bruto</TabsTrigger>
              <TabsTrigger value="net">Líquido</TabsTrigger>
            </TabsList>
          </Tabs>
          <DateRangePicker value={range} onChange={setRange} />
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
            <Metric
              label="Reembolsos"
              value={`${brl(refunds)} (${refundRate.toFixed(1)}%)`}
            />
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

          <CheckoutHealthSection rows={sales.data?.rows ?? []} />
        </>
      )}
    </div>
  );
}
