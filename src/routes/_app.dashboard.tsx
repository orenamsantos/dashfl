import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Calendar as CalendarIcon,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  AreaChart,
  Area,
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
  fetchAllAds,
  type DatePreset,
  type DateRange,
} from "@/lib/facebook-api";
import {
  isSaleInRange,
  rangeKey,
  resolveRangeYmd,
  previousRange,
  ymdSp,
  saleEventDate,
} from "@/lib/date-range";
import { fetchUsdBrl, effectiveRate, type FxMode } from "@/lib/currency";
import { supabase, getSetting } from "@/lib/supabase";
import { isApprovedStatus, isRefundStatus } from "@/lib/status";
import { buildIndex, attributeSale } from "@/lib/attribution";
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

type SaleRow = {
  amount: number | null;
  net_amount?: number | null;
  status: string | null;
  approved_at: string | null;
  order_date: string | null;
  created_at: string | null;
  utm_term?: string | null;
  utm_campaign?: string | null;
  src?: string | null;
  product?: string | null;
  product_name?: string | null;
  payment_method?: string | null;
};

type CampRow = {
  id: string;
  name: string;
  spend: number;
  revenue: number;
  count: number;
  roas: number;
};

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
    onChange({ type: "custom", since: fmtIsoDate(since), until: fmtIsoDate(until) });
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
              <Button size="sm" onClick={applyCustom} disabled={!draftSince || !draftUntil}>
                Aplicar
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ---------- helpers de apresentação ---------- */

function pctDelta(cur: number, prev: number): number | null {
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function DeltaPill({ delta, suffix = "%" }: { delta: number | null; suffix?: string }) {
  if (delta == null) return <span className="text-xs text-muted-foreground">sem base anterior</span>;
  const up = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{
        background: up ? "oklch(0.74 0.16 165 / .15)" : "oklch(0.66 0.22 18 / .15)",
        color: up ? "var(--color-success)" : "var(--color-destructive)",
      }}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(delta).toFixed(1)}
      {suffix}
    </span>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="h-9" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 280;
  const h = 34;
  const pts = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / span) * (h - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="mt-3 block h-9 w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2" points={pts} />
    </svg>
  );
}

function HeroCard({
  label,
  value,
  tone,
  children,
}: {
  label: string;
  value: string;
  tone: "good" | "bad" | "neutral";
  children?: React.ReactNode;
}) {
  const color =
    tone === "good"
      ? "var(--color-success)"
      : tone === "bad"
        ? "var(--color-destructive)"
        : "var(--color-foreground)";
  return (
    <div className="relative overflow-hidden rounded-2xl border bg-card p-5 shadow-[0_18px_40px_-28px_#000]">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className="mt-2.5 text-[2.5rem] font-bold leading-none tracking-tight tabular-nums"
        style={{ color }}
      >
        {value}
      </div>
      {children}
    </div>
  );
}

function SecCard({ label, value, mini }: { label: string; value: string; mini?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{value}</div>
      {mini && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{mini}</div>}
    </div>
  );
}

function roasTone(roas: number, breakeven: number): "good" | "bad" | "neutral" {
  if (!Number.isFinite(roas) || roas === 0) return "neutral";
  if (roas >= breakeven) return "good";
  if (roas >= breakeven * 0.9) return "neutral";
  return "bad";
}

/* ---------- agregação de vendas ---------- */
function aggregate(rows: SaleRow[], range: DateRange) {
  const inPeriod = rows.filter((s) => isSaleInRange(s, range));
  const approved = inPeriod.filter((s) => isApprovedStatus(s.status));
  const refunded = inPeriod.filter((s) => isRefundStatus(s.status));
  return {
    gross: approved.reduce((a, s) => a + Number(s.amount ?? 0), 0),
    net: approved.reduce((a, s) => a + Number(s.net_amount ?? 0), 0),
    refunds: refunded.reduce((a, s) => a + Number(s.amount ?? 0), 0),
    count: approved.length,
    refundCount: refunded.length,
    approved,
    inPeriod,
  };
}

function DashboardPage() {
  const [range, setRange] = useState<DateRange>({ type: "preset", preset: "last_7d" });
  const [revenueMode, setRevenueMode] = useState<"gross" | "net">("gross");

  // --- câmbio: manual (dólar do dia) tem prioridade sobre o ao vivo ---
  const fx = useQuery({ queryKey: ["fx-usd-brl"], queryFn: fetchUsdBrl, staleTime: 36e5 });
  const fxSettings = useQuery({
    queryKey: ["fx-settings"],
    queryFn: async () => ({
      mode: ((await getSetting("fx_mode")) as FxMode | null) ?? "auto",
      manual: Number((await getSetting("fx_manual_rate")) ?? "") || null,
    }),
    staleTime: 3e5,
  });
  const eff = effectiveRate({
    mode: fxSettings.data?.mode,
    manualRate: fxSettings.data?.manual,
    liveRate: fx.data?.rate,
    liveSource: fx.data?.source,
  });
  const rate = eff.rate;

  // --- períodos: gasto da Meta usa as mesmas datas (SP) das vendas ---
  const toFb = (r: DateRange): DateRange => {
    if (r.type === "custom") return r;
    const { startYmd, endYmd } = resolveRangeYmd(r);
    if (!startYmd) return r;
    return { type: "custom", since: startYmd, until: endYmd };
  };
  const fbRange = useMemo(() => toFb(range), [range]);
  const prevRange = useMemo(() => previousRange(range), [range]);
  const prevFbRange = useMemo(() => (prevRange ? toFb(prevRange) : null), [prevRange]);

  const rk = rangeKey(range);
  const fbRk = rangeKey(fbRange);

  const summary = useQuery({
    queryKey: ["fb-summary", fbRk],
    queryFn: () => fetchAccountInsights(fbRange),
  });
  const prevSummary = useQuery({
    queryKey: ["fb-summary-prev", prevFbRange ? rangeKey(prevFbRange) : "none"],
    queryFn: () => (prevFbRange ? fetchAccountInsights(prevFbRange) : Promise.resolve(null)),
  });
  const ts = useQuery({
    queryKey: ["fb-timeseries", fbRk],
    queryFn: () => fetchAccountTimeseries(fbRange),
  });
  const campaigns = useQuery({
    queryKey: ["fb-campaigns", fbRk],
    queryFn: () => fetchCampaigns(fbRange),
  });
  const allAds = useQuery({ queryKey: ["fb-all-ads"], queryFn: fetchAllAds, staleTime: 6e5 });

  const salesAll = useQuery({
    queryKey: ["sales-all"],
    queryFn: async (): Promise<SaleRow[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("sales")
        .select(
          "amount,net_amount,status,approved_at,order_date,created_at,product,product_name,payment_method,utm_term,utm_campaign,src",
        )
        .limit(10000);
      if (error) return [];
      return (data ?? []) as SaleRow[];
    },
  });

  const rows = salesAll.data ?? [];
  const cur = useMemo(() => aggregate(rows, range), [rows, range]);
  const prev = useMemo(
    () => (prevRange ? aggregate(rows, prevRange) : null),
    [rows, prevRange],
  );

  // --- números atuais ---
  const spend = (summary.data?.spend ?? 0) * rate;
  const prevSpend = (prevSummary.data?.spend ?? 0) * rate;
  const gross = cur.gross;
  const net = cur.net;
  const refunds = cur.refunds;
  // Vendas reembolsadas já saem do `approved` (status "Reembolsada"), então NÃO
  // entram em `net` nem em `gross`. Subtrair `refunds` de novo descontava o
  // reembolso DUAS vezes no modo Líquido (o modo Bruto nunca subtraiu). Os dois
  // modos agora tratam reembolso igual: já excluído. `refunds` segue como KPI.
  const revenue = revenueMode === "net" ? net : gross;
  const prevRevenue = prev ? (revenueMode === "net" ? prev.net : prev.gross) : 0;
  const salesCount = cur.count;

  const lucro = net - spend; // dinheiro no bolso (líquido após taxa Ticto e ads)
  const prevLucro = prev ? prev.net - prevSpend : 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const prevRoas = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const roi = spend > 0 ? ((revenue - spend) / spend) * 100 : 0;
  const prevRoi = prevSpend > 0 ? ((prevRevenue - prevSpend) / prevSpend) * 100 : 0;
  const ticket = salesCount > 0 ? gross / salesCount : 0;
  const cpa = salesCount > 0 ? spend / salesCount : 0;
  const refundRate = salesCount > 0 ? (cur.refundCount / salesCount) * 100 : 0;
  // breakeven (em ROAS): no modo bruto, gross/net (cobre taxa Ticto); no líquido, 1.
  const breakeven = revenueMode === "net" ? 1 : net > 0 ? gross / net : 1.1;

  // --- série diária: gasto x faturamento (e sparklines) ---
  const daily = useMemo(() => {
    const revByDay = new Map<string, number>();
    for (const s of cur.approved) {
      const d = saleEventDate(s);
      if (!d) continue;
      revByDay.set(ymdSp(d), (revByDay.get(ymdSp(d)) ?? 0) + Number(s.amount ?? 0));
    }
    const spendByDay = new Map<string, number>();
    for (const d of ts.data ?? []) spendByDay.set(d.date, Number(d.spend) * rate);
    const days = Array.from(new Set([...revByDay.keys(), ...spendByDay.keys()])).sort();
    return days.map((ymd) => {
      const g = spendByDay.get(ymd) ?? 0;
      const f = revByDay.get(ymd) ?? 0;
      return {
        date: `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`,
        gasto: g,
        faturamento: f,
        lucro: f - g,
      };
    });
  }, [cur.approved, ts.data, rate]);

  const sparkLucro = daily.map((d) => d.lucro);
  const sparkRoi = daily.map((d) => (d.gasto > 0 ? ((d.faturamento - d.gasto) / d.gasto) * 100 : 0));

  // --- ROAS atribuído por campanha ---
  const campRows = useMemo(() => {
    const camps = campaigns.data ?? [];
    const empty = { list: [] as CampRow[], organic: 0, organicCount: 0 };
    if (camps.length === 0) return empty;
    const index = buildIndex(
      camps.map((c) => ({ id: c.id, name: c.name })),
      (allAds.data ?? []).map((a) => ({ id: a.id, campaign_id: a.campaign_id })),
    );
    const revByCampaign = new Map<string, { revenue: number; count: number }>();
    let organic = 0;
    let organicCount = 0;
    for (const s of cur.approved) {
      const att = attributeSale(
        { utm_term: s.utm_term, utm_campaign: s.utm_campaign, src: s.src },
        index,
      );
      if (att.campaignId) {
        const e = revByCampaign.get(att.campaignId) ?? { revenue: 0, count: 0 };
        e.revenue += Number(s.amount ?? 0);
        e.count += 1;
        revByCampaign.set(att.campaignId, e);
      } else {
        organic += Number(s.amount ?? 0);
        organicCount += 1;
      }
    }
    const list = camps
      .map((c) => {
        const sp = c.insights.spend * rate;
        const r = revByCampaign.get(c.id) ?? { revenue: 0, count: 0 };
        return {
          id: c.id,
          name: c.name,
          spend: sp,
          revenue: r.revenue,
          count: r.count,
          roas: sp > 0 ? r.revenue / sp : 0,
        };
      })
      .filter((c) => c.spend > 0 || c.revenue > 0)
      .sort((a, b) => b.spend - a.spend);
    return { list, organic, organicCount };
  }, [campaigns.data, allAds.data, cur.approved, rate]);

  const loading = summary.isLoading || salesAll.isLoading;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Meta Ads + vendas Ticto.
            <span className="ml-2">
              USD→BRL <strong>{rate.toFixed(4)}</strong>{" "}
              {eff.source === "manual"
                ? "(manual)"
                : eff.source === "fallback"
                  ? "(fallback)"
                  : "(ao vivo)"}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={revenueMode} onValueChange={(v) => setRevenueMode(v as "gross" | "net")}>
            <TabsList>
              <TabsTrigger value="gross">Bruto</TabsTrigger>
              <TabsTrigger value="net">Líquido</TabsTrigger>
            </TabsList>
          </Tabs>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
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
          {/* HERO */}
          <div className="grid gap-4 md:grid-cols-3">
            <HeroCard label="💰 Lucro líquido" value={brl(lucro)} tone={lucro >= 0 ? "good" : "bad"}>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <DeltaPill delta={pctDelta(lucro, prevLucro)} />
                <span className="text-muted-foreground">vs período anterior</span>
              </div>
              <Sparkline data={sparkLucro} color="var(--color-success)" />
            </HeroCard>

            <HeroCard label="🎯 ROAS" value={`${roas.toFixed(2)}x`} tone={roasTone(roas, breakeven)}>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <DeltaPill delta={pctDelta(roas, prevRoas)} />
                <span className="text-muted-foreground">
                  breakeven {breakeven.toFixed(2)}x
                </span>
              </div>
              <div className="mt-3 text-[11.5px] text-muted-foreground">
                {roas >= breakeven ? "acima do breakeven" : "abaixo do breakeven"}
                <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-[oklch(1_0_0_/_8%)]">
                  <div
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{
                      width: `${Math.min(100, (roas / (breakeven * 1.8)) * 100)}%`,
                      background:
                        "linear-gradient(90deg, var(--color-destructive), oklch(0.80 0.15 85), var(--color-success))",
                    }}
                  />
                  <div
                    className="absolute -top-1 bottom-[-4px] w-0.5 bg-foreground/60"
                    style={{ left: `${Math.min(100, (1 / 1.8) * 100)}%` }}
                  />
                </div>
              </div>
            </HeroCard>

            <HeroCard label="📈 ROI" value={`${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%`} tone={roi >= 0 ? "good" : "bad"}>
              <div className="mt-3 flex items-center gap-2 text-xs">
                <DeltaPill delta={pctDelta(roi, prevRoi)} suffix=" pts" />
                <span className="text-muted-foreground">vs período anterior</span>
              </div>
              <Sparkline data={sparkRoi} color="var(--color-info)" />
            </HeroCard>
          </div>

          {/* SECUNDÁRIOS */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <SecCard label="Gasto Ads" value={brl(spend)} mini={`$ ${num((summary.data?.spend ?? 0))} × ${rate.toFixed(2)}`} />
            <SecCard label="Faturamento" value={brl(gross)} mini={`bruto · ${num(salesCount)} vendas`} />
            <SecCard label="Líquido" value={brl(net)} mini="após taxas Ticto" />
            <SecCard label="Reembolsos" value={`${brl(refunds)}`} mini={`${refundRate.toFixed(1)}% · ${cur.refundCount}`} />
            <SecCard label="Ticket médio" value={brl(ticket)} />
            <SecCard label="CPA" value={brl(cpa)} />
          </div>

          {/* CHART */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Gasto x Faturamento</CardTitle>
            </CardHeader>
            <CardContent className="h-72">
              {ts.isLoading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Carregando...
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily}>
                    <defs>
                      <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.25} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 6%)" />
                    <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={12} />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={12}
                      tickFormatter={(v) => brl(Number(v))}
                      width={70}
                    />
                    <Tooltip
                      formatter={(v: number, n) => [brl(Number(v)), n === "gasto" ? "Gasto" : "Faturamento"]}
                      contentStyle={{
                        background: "var(--color-card)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                      }}
                    />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      name="Faturamento"
                      stroke="var(--color-success)"
                      strokeWidth={2.5}
                      fill="url(#gFat)"
                    />
                    <Area
                      type="monotone"
                      dataKey="gasto"
                      name="Gasto"
                      stroke="var(--color-info)"
                      strokeWidth={2.5}
                      fill="transparent"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* CAMPANHAS */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-base">Campanhas por desempenho</CardTitle>
              <span className="text-xs text-muted-foreground">ROAS atribuído</span>
            </CardHeader>
            <CardContent className="p-0">
              {campaigns.isLoading ? (
                <div className="py-6 text-center text-muted-foreground">
                  <Loader2 className="mr-2 inline h-5 w-5 animate-spin" />
                  Carregando...
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campanha</TableHead>
                      <TableHead className="text-right">Gasto</TableHead>
                      <TableHead className="text-right">Faturamento</TableHead>
                      <TableHead className="text-right">Vendas</TableHead>
                      <TableHead className="text-right">ROAS</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campRows.list.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                          Nenhuma campanha com dados no período.
                        </TableCell>
                      </TableRow>
                    )}
                    {campRows.list.map((c) => {
                          const tone = roasTone(c.roas, breakeven);
                          return (
                            <TableRow key={c.id}>
                              <TableCell className="font-medium">{c.name}</TableCell>
                              <TableCell className="text-right tabular-nums">{brl(c.spend)}</TableCell>
                              <TableCell className="text-right tabular-nums">{brl(c.revenue)}</TableCell>
                              <TableCell className="text-right tabular-nums">{num(c.count)}</TableCell>
                              <TableCell className="text-right">
                                <span
                                  className="inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold tabular-nums"
                                  style={{
                                    background:
                                      tone === "good"
                                        ? "oklch(0.74 0.16 165 / .15)"
                                        : tone === "bad"
                                          ? "oklch(0.66 0.22 18 / .15)"
                                          : "oklch(0.80 0.15 85 / .15)",
                                    color:
                                      tone === "good"
                                        ? "var(--color-success)"
                                        : tone === "bad"
                                          ? "var(--color-destructive)"
                                          : "oklch(0.80 0.15 85)",
                                  }}
                                >
                                  {c.roas > 0 ? `${c.roas.toFixed(2)}x` : "—"}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        },
                      )}
                    {campRows.organic > 0 && (
                      <TableRow>
                        <TableCell className="font-medium text-muted-foreground">
                          orgânico / direto
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {brl(campRows.organic)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {num(campRows.organicCount)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">—</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <CheckoutHealthSection rows={cur.inPeriod} />
        </>
      )}
    </div>
  );
}
