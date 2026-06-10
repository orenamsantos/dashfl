import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  LayoutDashboard,
  Megaphone,
  ShoppingCart,
  Upload,
  Plug,
  Settings as SettingsIcon,
  RefreshCw,
  LogOut,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
} from "lucide-react";
import { brl, num } from "@/lib/format";

// ─────────────────────────────────────────────────────────────
// PREVIEW (sem auth, dados mockados) pra iterar o visual premium.
// NÃO vai pra produção — removido antes do merge. O que for aprovado
// aqui é portado pro _app.dashboard.tsx e app-layout.tsx reais.
// ─────────────────────────────────────────────────────────────

export const Route = createFileRoute("/preview")({
  component: PreviewPage,
});

// ---- mock data (próximo dos números reais do Flavio) ----
const M = {
  lucro: 4855.4,
  lucroPrev: 4120.0,
  roas: 1.54,
  roasPrev: 1.41,
  breakeven: 1.09,
  roi: 54.3,
  roiPrev: 41.0,
  gasto: 8940.3,
  faturamento: 13795.09,
  liquido: 12640.4,
  reembolsos: 148,
  reembolsoCount: 4,
  ticket: 38.4,
  cpa: 23.1,
  vendas: 359,
  refundRate: 1.1,
};

const DAILY = [
  { d: "27/05", gasto: 410, fat: 786 },
  { d: "28/05", gasto: 360, fat: 388 },
  { d: "29/05", gasto: 280, fat: 224 },
  { d: "30/05", gasto: 300, fat: 305 },
  { d: "31/05", gasto: 520, fat: 767 },
  { d: "01/06", gasto: 470, fat: 610 },
  { d: "02/06", gasto: 430, fat: 509 },
  { d: "03/06", gasto: 250, fat: 245 },
  { d: "04/06", gasto: 540, fat: 707 },
  { d: "05/06", gasto: 510, fat: 712 },
  { d: "06/06", gasto: 420, fat: 545 },
  { d: "07/06", gasto: 360, fat: 310 },
  { d: "08/06", gasto: 480, fat: 544 },
  { d: "09/06", gasto: 470, fat: 662 },
];

const CAMPAIGNS = [
  { name: "cp03-vtx-br", spend: 4120, revenue: 7240, sales: 188 },
  { name: "cp05-bidcap-br", spend: 2980, revenue: 4010, sales: 104 },
  { name: "cp02-retarget", spend: 1240, revenue: 1890, sales: 49 },
  { name: "Orgânico / Direto", spend: 0, revenue: 655, sales: 18, organic: true },
];

const NAV = [
  { label: "Dashboard", icon: LayoutDashboard, active: true },
  { label: "Campanhas", icon: Megaphone },
  { label: "Vendas", icon: ShoppingCart },
  { label: "Importar CSV", icon: Upload },
  { label: "Integrações", icon: Plug },
  { label: "Configurações", icon: SettingsIcon },
];

function pctDelta(cur: number, prev: number) {
  if (!prev) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function DeltaPill({ delta, suffix = "%" }: { delta: number | null; suffix?: string }) {
  if (delta == null)
    return <span className="text-xs text-muted-foreground">sem base</span>;
  const up = delta >= 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
      style={{
        background: up ? "oklch(0.8 0.17 152 / 0.14)" : "oklch(0.645 0.205 18 / 0.14)",
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

function PreviewPage() {
  const [mode, setMode] = useState<"gross" | "net">("net");
  const lucroUp = M.lucro >= 0;
  const roasOk = M.roas >= M.breakeven;
  const gaugePct = Math.min(100, (M.roas / (M.breakeven * 1.8)) * 100);
  const breakMarker = Math.min(100, (1 / 1.8) * 100);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      {/* ─── sidebar ─── */}
      <aside className="hidden md:flex w-60 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex h-16 items-center gap-2.5 px-5">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/15 ring-1 ring-primary/25">
            <TrendingUp className="h-4 w-4 text-primary" />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">dashfl</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-3 py-2">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.label}
                className={
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors " +
                  (item.active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground")
                }
              >
                <Icon
                  className={
                    "h-4 w-4 " + (item.active ? "text-primary" : "")
                  }
                />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/70">
            <div className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-semibold">
              FL
            </div>
            <span className="truncate">Flavio</span>
            <LogOut className="ml-auto h-4 w-4 opacity-60" />
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ─── topbar ─── */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-6 backdrop-blur">
          <div className="text-sm text-muted-foreground">
            dashfl <span className="mx-1.5 opacity-40">/</span>
            <span className="font-medium text-foreground">Dashboard</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground sm:inline-flex">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              USD→BRL 5,4300
            </span>
            <button className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-accent">
              <RefreshCw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
          </div>
        </header>

        {/* ─── conteúdo ─── */}
        <main className="flex-1 space-y-6 p-6 lg:p-8">
          {/* título + controles */}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Visão geral</h1>
              <p className="text-sm text-muted-foreground">
                Meta Ads cruzado com vendas da Ticto · últimos 14 dias
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
                {(["gross", "net"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={
                      "rounded-[7px] px-3 py-1 transition-colors " +
                      (mode === m
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {m === "gross" ? "Bruto" : "Líquido"}
                  </button>
                ))}
              </div>
              <button className="inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-accent">
                Últimos 14 dias
              </button>
            </div>
          </div>

          {/* HERO: lucro em destaque + ROAS + ROI */}
          <div className="grid gap-4 lg:grid-cols-4">
            {/* lucro — painel-feature (2 colunas) */}
            <Panel className="relative isolate overflow-hidden lg:col-span-2 p-5">
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
                    style={{ color: lucroUp ? "var(--color-success)" : "var(--color-destructive)" }}
                  >
                    {brl(M.lucro)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <DeltaPill delta={pctDelta(M.lucro, M.lucroPrev)} />
                  <span className="text-[11px] text-muted-foreground">vs 14d anteriores</span>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                após taxa Ticto e {brl(M.gasto)} de mídia · {num(M.vendas)} vendas
              </div>
              <Sparkline
                data={DAILY.map((d) => d.fat - d.gasto)}
                color="var(--color-success)"
              />
            </Panel>

            {/* ROAS com gauge de breakeven */}
            <Panel className="p-5">
              <div className="text-[13px] font-medium text-muted-foreground">ROAS</div>
              <div className="mt-2 flex items-end gap-2">
                <span className="text-[2rem] font-bold leading-none tracking-tight tabular-nums text-foreground">
                  {M.roas.toFixed(2)}x
                </span>
                <span className="mb-0.5">
                  <DeltaPill delta={pctDelta(M.roas, M.roasPrev)} />
                </span>
              </div>
              <div className="mt-4 text-[11.5px]">
                <span style={{ color: roasOk ? "var(--color-success)" : "var(--color-destructive)" }}>
                  {roasOk ? "acima" : "abaixo"}
                </span>
                <span className="text-muted-foreground">
                  {" "}do breakeven {M.breakeven.toFixed(2)}x
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
                  {M.roi >= 0 ? "+" : ""}
                  {M.roi.toFixed(1)}%
                </span>
                <span className="mb-0.5">
                  <DeltaPill delta={pctDelta(M.roi, M.roiPrev)} suffix=" pts" />
                </span>
              </div>
              <Sparkline
                data={DAILY.map((d) => (d.gasto ? ((d.fat - d.gasto) / d.gasto) * 100 : 0))}
                color="var(--color-info)"
              />
            </Panel>
          </div>

          {/* faixa de stats secundários (não-cards, faixa dividida) */}
          <Panel className="grid grid-cols-2 divide-x divide-y divide-border sm:grid-cols-3 sm:divide-y-0 xl:grid-cols-6">
            <Stat label="Gasto Ads" value={brl(M.gasto)} mini="$1.646 × 5,43" />
            <Stat label="Faturamento" value={brl(M.faturamento)} mini={`${num(M.vendas)} vendas`} />
            <Stat label="Líquido" value={brl(M.liquido)} mini="após taxas" />
            <Stat
              label="Reembolsos"
              value={brl(M.reembolsos)}
              mini={`${M.refundRate.toFixed(1)}% · ${M.reembolsoCount}`}
              tone="neg"
            />
            <Stat label="Ticket médio" value={brl(M.ticket)} />
            <Stat label="CPA" value={brl(M.cpa)} />
          </Panel>

          {/* chart gasto x faturamento */}
          <Panel className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  Gasto x Faturamento
                </h2>
                <p className="text-xs text-muted-foreground">por dia, em BRL</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <Legend color="var(--color-success)" label="Faturamento" />
                <Legend color="var(--color-info)" label="Gasto" />
              </div>
            </div>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={DAILY} margin={{ left: 4, right: 8, top: 4 }}>
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
                    dataKey="d"
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
                    width={44}
                    tickFormatter={(v) => `${v}`}
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
                    dataKey="fat"
                    stroke="var(--color-success)"
                    strokeWidth={2}
                    fill="url(#gFat)"
                  />
                  <Area
                    type="monotone"
                    dataKey="gasto"
                    stroke="var(--color-info)"
                    strokeWidth={2}
                    fill="url(#gGasto)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* top campanhas */}
          <Panel className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-[15px] font-semibold tracking-tight">
                Campanhas por lucro
              </h2>
              <a className="text-xs font-medium text-primary hover:underline">
                Ver todas
              </a>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 text-left font-medium">Campanha</th>
                  <th className="px-3 py-2.5 text-right font-medium">Gasto</th>
                  <th className="px-3 py-2.5 text-right font-medium">Faturamento</th>
                  <th className="px-3 py-2.5 text-right font-medium">ROAS</th>
                  <th className="px-3 py-2.5 text-right font-medium">Vendas</th>
                  <th className="px-5 py-2.5 text-right font-medium">Lucro</th>
                </tr>
              </thead>
              <tbody>
                {CAMPAIGNS.map((c) => {
                  const roas = c.spend ? c.revenue / c.spend : 0;
                  const profit = c.revenue - c.spend;
                  return (
                    <tr
                      key={c.name}
                      className="border-t border-border transition-colors hover:bg-accent/40"
                    >
                      <td className="px-5 py-3">
                        <span className={c.organic ? "italic text-muted-foreground" : "font-medium"}>
                          {c.name}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {c.spend ? brl(c.spend) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{brl(c.revenue)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {c.spend ? (
                          <span
                            className="rounded-md px-1.5 py-0.5 text-xs font-semibold"
                            style={{
                              background:
                                roas >= 1.1
                                  ? "oklch(0.8 0.17 152 / 0.14)"
                                  : "oklch(0.645 0.205 18 / 0.14)",
                              color:
                                roas >= 1.1 ? "var(--color-success)" : "var(--color-destructive)",
                            }}
                          >
                            {roas.toFixed(2)}x
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {num(c.sales)}
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
              </tbody>
            </table>
          </Panel>
        </main>
      </div>
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

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
