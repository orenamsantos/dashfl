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
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSelect } from "@/components/account-select";

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
  if (!data || data.length < 2) return <div className="h-10" />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const w = 240;
  const h = 40;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;
  const id = `sp-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg className="mt-4 block h-10 w-full" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.22} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={line}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Panel({
  className = "",
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded-xl border border-border bg-card shadow-[0_1px_0_0_oklch(1_0_0_/_4%)_inset,0_20px_40px_-32px_#000] " +
        className
      }
    >
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  mini,
  tone,
}: {
  label: string;
  value: string;
  mini?: string;
  tone?: "neg";
}) {
  return (
    <div className="p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className="mt-1.5 text-lg font-semibold tracking-tight tabular-nums"
        style={tone === "neg" ? { color: "var(--color-destructive)" } : undefined}
      >
        {value}
      </div>
      {mini && <div className="mt-0.5 text-[11px] text-muted-foreground">{mini}</div>}
    </div>
  );
}

function ChartLegend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-4">
        <Skeleton className="h-[150px] lg:col-span-2" />
        <Skeleton className="h-[150px]" />
        <Skeleton className="h-[150px]" />
      </div>
      <Skeleton className="h-[88px]" />
      <Skeleton className="h-[340px]" />
      <Skeleton className="h-[260px]" />
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
  const [account, setAccount] = useState("all");

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
    queryKey: ["fb-summary", fbRk, account],
    queryFn: () => fetchAccountInsights(fbRange, account),
  });
  const prevSummary = useQuery({
    queryKey: ["fb-summary-prev", prevFbRange ? rangeKey(prevFbRange) : "none", account],
    queryFn: () =>
      prevFbRange ? fetchAccountInsights(prevFbRange, account) : Promise.resolve(null),
  });
  const ts = useQuery({
    queryKey: ["fb-timeseries", fbRk, account],
    queryFn: () => fetchAccountTimeseries(fbRange, account),
  });
  const campaigns = useQuery({
    queryKey: ["fb-campaigns", fbRk, account],
    queryFn: () => fetchCampaigns(fbRange, account),
  });
  const allAds = useQuery({
    queryKey: ["fb-all-ads", account],
    queryFn: () => fetchAllAds(account),
    staleTime: 6e5,
  });

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

  // Índice de atribuição venda→campanha, montado com as campanhas/anúncios da
  // conta no escopo atual (quando o seletor está numa conta, campaigns/allAds
  // já vêm só dela). Compartilhado entre o filtro por conta e o ROAS atribuído.
  const index = useMemo(
    () =>
      buildIndex(
        (campaigns.data ?? []).map((c) => ({ id: c.id, name: c.name })),
        (allAds.data ?? []).map((a) => ({ id: a.id, campaign_id: a.campaign_id })),
      ),
    [campaigns.data, allAds.data],
  );

  // Com "Todas as contas", usa todas as vendas (visão agregada da operação).
  // Com uma conta selecionada, mantém só as vendas atribuíveis a ela — senão o
  // faturamento somaria vendas de outra conta sobre o gasto de uma só (ROAS
  // inflado). Atribuível = a venda resolve uma campanha no índice da conta.
  const scopedRows = useMemo(() => {
    if (account === "all") return rows;
    return rows.filter(
      (s) =>
        !!attributeSale(
          { utm_term: s.utm_term, utm_campaign: s.utm_campaign, src: s.src },
          index,
        ).campaignId,
    );
  }, [rows, account, index]);

  const cur = useMemo(() => aggregate(scopedRows, range), [scopedRows, range]);
  const prev = useMemo(
    () => (prevRange ? aggregate(scopedRows, prevRange) : null),
    [scopedRows, prevRange],
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
  }, [campaigns.data, index, cur.approved, rate]);

  const loading = summary.isLoading || salesAll.isLoading;

  const roasOk = roas >= breakeven;
  const gaugePct = Math.min(100, (roas / (breakeven * 1.8)) * 100);
  const breakMarker = Math.min(100, (1 / 1.8) * 100);

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
          <p className="text-sm text-muted-foreground">
            Meta Ads cruzado com vendas da Ticto · USD→BRL{" "}
            <strong className="text-foreground">{rate.toFixed(4)}</strong>{" "}
            {eff.source === "manual"
              ? "(manual)"
              : eff.source === "fallback"
                ? "(fallback)"
                : "(ao vivo)"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AccountSelect value={account} onChange={setAccount} />
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
            {(["gross", "net"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setRevenueMode(m)}
                className={
                  "rounded-[7px] px-3 py-1 transition-colors " +
                  (revenueMode === m
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m === "gross" ? "Bruto" : "Líquido"}
              </button>
            ))}
          </div>
          <DateRangePicker value={range} onChange={setRange} />
        </div>
      </div>

      {loading ? (
        <DashboardSkeleton />
      ) : summary.error ? (
        <Panel className="p-8 text-center text-destructive">
          {(summary.error as Error).message}
        </Panel>
      ) : (
        <>
          {/* HERO */}
          <div className="grid gap-4 lg:grid-cols-4">
            {/* lucro — painel-feature */}
            <Panel className="relative isolate overflow-hidden p-5 lg:col-span-2">
              <div
                className="pointer-events-none absolute inset-0 -z-10"
                style={{
                  background:
                    "radial-gradient(120% 140% at 0% 0%, oklch(0.8 0.17 152 / 0.08), transparent 55%)",
                }}
              />
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[13px] font-medium text-muted-foreground">
                    Lucro líquido
                  </div>
                  <div
                    className="mt-2 text-[2.75rem] font-bold leading-none tracking-tight tabular-nums"
                    style={{ color: lucro >= 0 ? "var(--color-success)" : "var(--color-destructive)" }}
                  >
                    {brl(lucro)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <DeltaPill delta={pctDelta(lucro, prevLucro)} />
                  <span className="text-[11px] text-muted-foreground">vs período anterior</span>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                após taxa Ticto e {brl(spend)} de mídia · {num(salesCount)} vendas
              </div>
              <Sparkline data={sparkLucro} color="var(--color-success)" />
            </Panel>

            {/* ROAS com gauge de breakeven */}
            <Panel className="p-5">
              <div className="text-[13px] font-medium text-muted-foreground">ROAS</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[2rem] font-bold leading-none tracking-tight tabular-nums text-foreground">
                  {roas.toFixed(2)}x
                </span>
                <span className="mb-0.5">
                  <DeltaPill delta={pctDelta(roas, prevRoas)} />
                </span>
              </div>
              <div className="mt-4 text-[11.5px]">
                <span style={{ color: roasOk ? "var(--color-success)" : "var(--color-destructive)" }}>
                  {roasOk ? "acima" : "abaixo"}
                </span>
                <span className="text-muted-foreground">
                  {" "}do breakeven {breakeven.toFixed(2)}x
                </span>
              </div>
              <div className="relative mt-2 h-1.5 overflow-hidden rounded-full bg-[oklch(1_0_0_/_8%)]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${gaugePct}%`,
                    background:
                      "linear-gradient(90deg, var(--color-destructive), var(--color-warning), var(--color-success))",
                  }}
                />
                <div
                  className="absolute -top-1 bottom-[-4px] w-0.5 bg-foreground/70"
                  style={{ left: `${breakMarker}%` }}
                />
              </div>
            </Panel>

            {/* ROI */}
            <Panel className="p-5">
              <div className="text-[13px] font-medium text-muted-foreground">ROI</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[2rem] font-bold leading-none tracking-tight tabular-nums text-foreground">
                  {roi >= 0 ? "+" : ""}
                  {roi.toFixed(1)}%
                </span>
                <span className="mb-0.5">
                  <DeltaPill delta={pctDelta(roi, prevRoi)} suffix=" pts" />
                </span>
              </div>
              <Sparkline data={sparkRoi} color="var(--color-info)" />
            </Panel>
          </div>

          {/* SECUNDÁRIOS — faixa dividida */}
          <Panel className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6">
            <Stat label="Gasto Ads" value={brl(spend)} mini={`$ ${num(summary.data?.spend ?? 0)} × ${rate.toFixed(2)}`} />
            <Stat label="Faturamento" value={brl(gross)} mini={`${num(salesCount)} vendas`} />
            <Stat label="Líquido" value={brl(net)} mini="após taxas Ticto" />
            <Stat label="Reembolsos" value={brl(refunds)} mini={`${refundRate.toFixed(1)}% · ${cur.refundCount}`} tone="neg" />
            <Stat label="Ticket médio" value={brl(ticket)} />
            <Stat label="CPA" value={brl(cpa)} />
          </Panel>

          {/* CHART */}
          <Panel className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">Gasto x Faturamento</h2>
                <p className="text-xs text-muted-foreground">por dia, em BRL</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <ChartLegend color="var(--color-success)" label="Faturamento" />
                <ChartLegend color="var(--color-info)" label="Gasto" />
              </div>
            </div>
            <div className="h-72">
              {ts.isLoading ? (
                <Skeleton className="h-full w-full" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={daily} margin={{ left: 4, right: 8, top: 4 }}>
                    <defs>
                      <linearGradient id="gFat" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-success)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-success)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gGasto" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-info)" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="var(--color-info)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 5%)" vertical={false} />
                    <XAxis
                      dataKey="date"
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      tickLine={false}
                      axisLine={false}
                      width={56}
                      tickFormatter={(v) => brl(Number(v))}
                    />
                    <Tooltip
                      cursor={{ stroke: "oklch(1 0 0 / 12%)" }}
                      contentStyle={{
                        background: "var(--color-popover)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 10,
                        fontSize: 12,
                        boxShadow: "0 20px 40px -20px #000",
                      }}
                      formatter={(v: number, n) => [brl(Number(v)), n === "gasto" ? "Gasto" : "Faturamento"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="faturamento"
                      name="faturamento"
                      stroke="var(--color-success)"
                      strokeWidth={2}
                      fill="url(#gFat)"
                    />
                    <Area
                      type="monotone"
                      dataKey="gasto"
                      name="gasto"
                      stroke="var(--color-info)"
                      strokeWidth={2}
                      fill="url(#gGasto)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </Panel>

          {/* CAMPANHAS */}
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-tight">Campanhas por desempenho</h2>
              <span className="text-xs text-muted-foreground">ROAS atribuído</span>
            </div>
            {campaigns.isLoading ? (
              <div className="space-y-2 p-5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="px-5 py-2.5 text-left font-medium">Campanha</th>
                    <th className="px-3 py-2.5 text-right font-medium">Gasto</th>
                    <th className="px-3 py-2.5 text-right font-medium">Faturamento</th>
                    <th className="px-3 py-2.5 text-right font-medium">Vendas</th>
                    <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                    <th className="px-5 py-2.5 text-right font-medium">Lucro</th>
                  </tr>
                </thead>
                <tbody>
                  {campRows.list.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                        Nenhuma campanha com dados no período.
                      </td>
                    </tr>
                  )}
                  {campRows.list.map((c) => {
                    const tone = roasTone(c.roas, breakeven);
                    const profit = c.revenue - c.spend;
                    return (
                      <tr
                        key={c.id}
                        className="border-t border-border transition-colors hover:bg-accent/40"
                      >
                        <td className="max-w-[260px] truncate px-5 py-3 font-medium">{c.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{brl(c.spend)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{brl(c.revenue)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{num(c.count)}</td>
                        <td className="px-3 py-3 text-right">
                          <span
                            className="inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums"
                            style={{
                              background:
                                tone === "good"
                                  ? "oklch(0.8 0.17 152 / 0.14)"
                                  : tone === "bad"
                                    ? "oklch(0.645 0.205 18 / 0.14)"
                                    : "oklch(0.82 0.135 80 / 0.14)",
                              color:
                                tone === "good"
                                  ? "var(--color-success)"
                                  : tone === "bad"
                                    ? "var(--color-destructive)"
                                    : "var(--color-warning)",
                            }}
                          >
                            {c.roas > 0 ? `${c.roas.toFixed(2)}x` : "—"}
                          </span>
                        </td>
                        <td
                          className="px-5 py-3 text-right font-semibold tabular-nums"
                          style={{ color: profit >= 0 ? "var(--color-success)" : "var(--color-destructive)" }}
                        >
                          {brl(profit)}
                        </td>
                      </tr>
                    );
                  })}
                  {campRows.organic > 0 && (
                    <tr className="border-t border-border">
                      <td className="px-5 py-3 italic text-muted-foreground">orgânico / direto</td>
                      <td className="px-3 py-3 text-right text-muted-foreground">—</td>
                      <td className="px-3 py-3 text-right tabular-nums">{brl(campRows.organic)}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">{num(campRows.organicCount)}</td>
                      <td className="px-3 py-3 text-right text-muted-foreground">—</td>
                      <td className="px-5 py-3 text-right font-semibold tabular-nums text-[var(--color-success)]">{brl(campRows.organic)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </Panel>

          <CheckoutHealthSection rows={cur.inPeriod} />
        </>
      )}
    </div>
  );
}
