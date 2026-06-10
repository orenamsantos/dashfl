import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertCircle,
  ArrowUp,
  ArrowDown,
  Pencil,
} from "lucide-react";
import { BudgetEditDialog } from "@/components/budget-edit-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { AccountSelect } from "@/components/account-select";
import { brl, num } from "@/lib/format";
import {
  fetchCampaigns,
  fetchAdSets,
  fetchAds,
  fetchAllAds,
  type DatePreset,
  type DateRange,
  type FBCampaign,
  type FBAdSet,
  type FBAd,
  type FBInsight,
} from "@/lib/facebook-api";
import { fetchUsdBrl } from "@/lib/currency";
import { supabase } from "@/lib/supabase";
import {
  attributeSale,
  buildIndex,
  type AttributionIndex,
} from "@/lib/attribution";
import { isApprovedStatus } from "@/lib/status";
import { isSaleInRange } from "@/lib/date-range";

export const Route = createFileRoute("/_app/campaigns")({
  head: () => ({ meta: [{ title: "Campanhas — AdsTracker" }] }),
  component: CampaignsPage,
});

const PAGE_SIZE = 10;

// ---------- tipos de agregação ----------

interface SaleRow {
  id: string;
  amount: number | null;
  net_amount: number | null;
  status: string | null;
  utm_term: string | null;
  utm_campaign: string | null;
  src: string | null;
  approved_at: string | null;
  order_date: string | null;
  created_at: string | null;
}

interface SalesAgg {
  sales: number; // só aprovadas
  revenue: number; // bruto aprovado
}

interface AttributedSales {
  byCampaign: Map<string, SalesAgg>;
  byAd: Map<string, SalesAgg>;
  unassigned: SalesAgg;
  totalApproved: number;
}

function emptyAgg(): SalesAgg {
  return { sales: 0, revenue: 0 };
}

function addToBucket(map: Map<string, SalesAgg>, key: string, amount: number) {
  const cur = map.get(key) ?? emptyAgg();
  cur.sales += 1;
  cur.revenue += amount;
  map.set(key, cur);
}

function attributeAll(
  sales: SaleRow[],
  index: AttributionIndex,
): AttributedSales {
  const byCampaign = new Map<string, SalesAgg>();
  const byAd = new Map<string, SalesAgg>();
  const unassigned = emptyAgg();
  let totalApproved = 0;

  for (const s of sales) {
    if (!isApprovedStatus(s.status)) continue;
    totalApproved += 1;
    const amount = Number(s.amount ?? 0);
    const attr = attributeSale(s, index);

    if (attr.level === "ad" && attr.adId && attr.campaignId) {
      addToBucket(byAd, attr.adId, amount);
      addToBucket(byCampaign, attr.campaignId, amount);
    } else if (
      (attr.level === "campaign" || attr.level === "campaign_src") &&
      attr.campaignId
    ) {
      addToBucket(byCampaign, attr.campaignId, amount);
    } else {
      unassigned.sales += 1;
      unassigned.revenue += amount;
    }
  }

  return { byCampaign, byAd, unassigned, totalApproved };
}

// ---------- componentes de tabela ----------

function StatusBadge({ s }: { s: FBCampaign["status"] }) {
  if (s === "ACTIVE")
    return (
      <Badge className="bg-[var(--color-success)]/15 text-[var(--color-success)] border-0">
        Ativo
      </Badge>
    );
  return <Badge variant="secondary">{s === "PAUSED" ? "Pausado" : s}</Badge>;
}

// Duas lentes pra não despejar 16 colunas de uma vez: "resultado" (decisão de
// escalar/matar: dinheiro) e "entrega" (diagnóstico de mídia). O cabeçalho e as
// células são dirigidos pela MESMA lista de colunas, então nunca desalinham.
type View = "resultado" | "entrega";

interface MetricCol {
  key: SortKey | null; // null = não ordenável (ex.: Freq.)
  label: string;
}

const RESULT_COLS: MetricCol[] = [
  { key: "spend", label: "Gasto" },
  { key: "revenue", label: "Faturamento" },
  { key: "sales", label: "Vendas" },
  { key: "roas", label: "ROAS" },
  { key: "cpa", label: "CPA" },
  { key: "profit", label: "Lucro" },
];

const DELIVERY_COLS: MetricCol[] = [
  { key: "spend", label: "Gasto" },
  { key: "impressions", label: "Impressões" },
  { key: "reach", label: "Alcance" },
  { key: null, label: "Freq." },
  { key: "clicks", label: "Cliques" },
  { key: "ctr", label: "CTR" },
  { key: "cpc", label: "CPC" },
  { key: "cpm", label: "CPM" },
];

function colsFor(view: View): MetricCol[] {
  return view === "resultado" ? RESULT_COLS : DELIVERY_COLS;
}
// total de colunas da tabela = Nome(2) + Status(1) + métricas da lente
function totalColsFor(view: View): number {
  return 3 + colsFor(view).length;
}

function RoasChip({ roas }: { roas: number }) {
  const good = roas >= 1.1;
  return (
    <span
      className="inline-block rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums"
      style={{
        background: good
          ? "oklch(0.8 0.17 152 / 0.14)"
          : "oklch(0.645 0.205 18 / 0.14)",
        color: good ? "var(--color-success)" : "var(--color-destructive)",
      }}
    >
      {roas.toFixed(2)}x
    </span>
  );
}

// Métricas do Meta (gasto em BRL via rate) + cruzamento com Ticto, por lente.
// `agg` pode ser undefined quando não há venda atribuída — mostra "—".
function MetricsCells({
  m,
  rate,
  agg,
  view,
}: {
  m: FBInsight;
  rate: number;
  agg?: SalesAgg;
  view: View;
}) {
  const spendBrl = m.spend * rate;
  const cpc = m.clicks > 0 ? spendBrl / m.clicks : 0;
  const cpm = m.impressions > 0 ? (spendBrl / m.impressions) * 1000 : 0;
  const revenue = agg?.revenue ?? 0;
  const sales = agg?.sales ?? 0;
  const roas = spendBrl > 0 ? revenue / spendBrl : 0;
  const profit = revenue - spendBrl;
  const cpa = sales > 0 ? spendBrl / sales : 0;

  if (view === "entrega") {
    return (
      <>
        <TableCell className="text-right tabular-nums">{brl(spendBrl)}</TableCell>
        <TableCell className="text-right tabular-nums">{num(m.impressions)}</TableCell>
        <TableCell className="text-right tabular-nums">{num(m.reach ?? 0)}</TableCell>
        <TableCell className="text-right tabular-nums">{(m.frequency ?? 0).toFixed(2)}</TableCell>
        <TableCell className="text-right tabular-nums">{num(m.clicks)}</TableCell>
        <TableCell className="text-right tabular-nums">{(m.ctr ?? 0).toFixed(2)}%</TableCell>
        <TableCell className="text-right tabular-nums">{brl(cpc)}</TableCell>
        <TableCell className="text-right tabular-nums">{brl(cpm)}</TableCell>
      </>
    );
  }
  return (
    <>
      <TableCell className="text-right tabular-nums text-muted-foreground">{brl(spendBrl)}</TableCell>
      <TableCell className="text-right tabular-nums">{agg ? brl(revenue) : "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">{agg ? num(sales) : "—"}</TableCell>
      <TableCell className="text-right">
        {agg && spendBrl > 0 ? <RoasChip roas={roas} /> : "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {agg && sales > 0 ? brl(cpa) : "—"}
      </TableCell>
      <TableCell
        className="text-right font-semibold tabular-nums"
        style={agg ? { color: profit >= 0 ? "var(--color-success)" : "var(--color-destructive)" } : undefined}
      >
        {agg ? brl(profit) : "—"}
      </TableCell>
    </>
  );
}

function AdRow({
  ad,
  rate,
  attr,
  view,
}: {
  ad: FBAd;
  rate: number;
  attr: AttributedSales;
  view: View;
}) {
  const agg = attr.byAd.get(ad.id);
  return (
    <TableRow className="bg-muted/30">
      <TableCell style={{ paddingLeft: 64 }} colSpan={2}>
        <span className="text-muted-foreground">↳ </span>
        {ad.name}
      </TableCell>
      <TableCell>
        <StatusBadge s={ad.status} />
      </TableCell>
      <MetricsCells m={ad.insights} rate={rate} agg={agg} view={view} />
    </TableRow>
  );
}

function AdSetRow({
  adset,
  preset,
  rate,
  attr,
  view,
}: {
  adset: FBAdSet;
  preset: DatePreset;
  rate: number;
  attr: AttributedSales;
  view: View;
}) {
  const [open, setOpen] = useState(false);
  const range: DateRange = { type: "preset", preset };
  const { data: ads, isLoading } = useQuery({
    queryKey: ["fb-ads", adset.id, preset],
    queryFn: () => fetchAds(adset.id, range),
    enabled: open,
  });
  return (
    <>
      <TableRow
        className="bg-muted/10 cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell style={{ paddingLeft: 40 }} colSpan={2}>
          <span className="inline-flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {adset.name}
          </span>
        </TableCell>
        <TableCell>
          <StatusBadge s={adset.status} />
        </TableCell>
        {/* conjunto não tem agregação direta (sales atribuídas vão pra ad ou campanha) */}
        <MetricsCells m={adset.insights} rate={rate} view={view} />
      </TableRow>
      {open && isLoading && (
        <TableRow>
          <TableCell colSpan={totalColsFor(view)} className="text-center text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Carregando anúncios...
          </TableCell>
        </TableRow>
      )}
      {open &&
        ads?.map((ad) => (
          <AdRow key={ad.id} ad={ad} rate={rate} attr={attr} view={view} />
        ))}
    </>
  );
}

function CampaignRow({
  campaign,
  preset,
  rate,
  attr,
  view,
}: {
  campaign: FBCampaign;
  preset: DatePreset;
  rate: number;
  attr: AttributedSales;
  view: View;
}) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const range: DateRange = { type: "preset", preset };
  const { data: adsets, isLoading } = useQuery({
    queryKey: ["fb-adsets", campaign.id, preset],
    queryFn: () => fetchAdSets(campaign.id, range),
    enabled: open,
  });
  const agg = attr.byCampaign.get(campaign.id);
  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell className="font-medium">
          <span className="inline-flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {campaign.name}
          </span>
        </TableCell>
        <TableCell className="w-10">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Editar orçamento"
            onClick={(e) => {
              e.stopPropagation();
              setEditOpen(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </TableCell>
        <TableCell>
          <StatusBadge s={campaign.status} />
        </TableCell>
        <MetricsCells m={campaign.insights} rate={rate} agg={agg} view={view} />
      </TableRow>
      <BudgetEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        campaign={campaign}
        rate={rate}
      />
      {open && isLoading && (
        <TableRow>
          <TableCell colSpan={totalColsFor(view)} className="text-center text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Carregando conjuntos...
          </TableCell>
        </TableRow>
      )}
      {open &&
        adsets?.map((as) => (
          <AdSetRow
            key={as.id}
            adset={as}
            preset={preset}
            rate={rate}
            attr={attr}
            view={view}
          />
        ))}
    </>
  );
}

// ---------- ordenação ----------

type SortKey =
  | "name"
  | "spend"
  | "impressions"
  | "reach"
  | "clicks"
  | "ctr"
  | "cpc"
  | "cpm"
  | "sales"
  | "revenue"
  | "roas"
  | "cpa"
  | "profit";

interface ComputedRow {
  campaign: FBCampaign;
  spendBrl: number;
  sales: number;
  revenue: number;
  roas: number;
  cpa: number;
  profit: number;
}

function buildComputed(
  campaigns: FBCampaign[],
  attr: AttributedSales,
  rate: number,
): ComputedRow[] {
  return campaigns.map((c) => {
    const spendBrl = c.insights.spend * rate;
    const agg = attr.byCampaign.get(c.id);
    const revenue = agg?.revenue ?? 0;
    const sales = agg?.sales ?? 0;
    return {
      campaign: c,
      spendBrl,
      sales,
      revenue,
      roas: spendBrl > 0 ? revenue / spendBrl : 0,
      cpa: sales > 0 ? spendBrl / sales : 0,
      profit: revenue - spendBrl,
    };
  });
}

function compareBy(key: SortKey, dir: "asc" | "desc") {
  return (a: ComputedRow, b: ComputedRow) => {
    let av: number | string;
    let bv: number | string;
    switch (key) {
      case "name":
        av = a.campaign.name.toLowerCase();
        bv = b.campaign.name.toLowerCase();
        break;
      case "spend":
        av = a.spendBrl;
        bv = b.spendBrl;
        break;
      case "impressions":
        av = a.campaign.insights.impressions;
        bv = b.campaign.insights.impressions;
        break;
      case "reach":
        av = a.campaign.insights.reach ?? 0;
        bv = b.campaign.insights.reach ?? 0;
        break;
      case "clicks":
        av = a.campaign.insights.clicks;
        bv = b.campaign.insights.clicks;
        break;
      case "ctr":
        av = a.campaign.insights.ctr ?? 0;
        bv = b.campaign.insights.ctr ?? 0;
        break;
      case "cpc":
        av = a.campaign.insights.cpc ?? 0;
        bv = b.campaign.insights.cpc ?? 0;
        break;
      case "cpm":
        av = a.campaign.insights.cpm ?? 0;
        bv = b.campaign.insights.cpm ?? 0;
        break;
      case "sales":
        av = a.sales;
        bv = b.sales;
        break;
      case "revenue":
        av = a.revenue;
        bv = b.revenue;
        break;
      case "roas":
        av = a.roas;
        bv = b.roas;
        break;
      case "cpa":
        av = a.cpa;
        bv = b.cpa;
        break;
      case "profit":
        av = a.profit;
        bv = b.profit;
        break;
    }
    if (av < bv) return dir === "asc" ? -1 : 1;
    if (av > bv) return dir === "asc" ? 1 : -1;
    return 0;
  };
}

function SortBtn({
  k,
  label,
  align = "right",
  sortKey,
  sortDir,
  onChange,
}: {
  k: SortKey;
  label: string;
  align?: "left" | "right";
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onChange: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onChange(k)}
      className={
        "inline-flex items-center gap-1 hover:text-foreground transition-colors " +
        (active ? "text-foreground" : "text-muted-foreground") +
        (align === "right" ? " float-right" : "")
      }
    >
      {label}
      {active &&
        (sortDir === "desc" ? (
          <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUp className="h-3 w-3" />
        ))}
    </button>
  );
}

function UnassignedRow({ agg, view }: { agg: SalesAgg; view: View }) {
  if (agg.sales === 0 && agg.revenue === 0) return null;
  return (
    <TableRow className="bg-muted/20 border-t-2">
      <TableCell colSpan={3} className="font-medium italic text-muted-foreground">
        Não atribuído / orgânico
      </TableCell>
      {view === "entrega" ? (
        DELIVERY_COLS.map((c) => (
          <TableCell key={c.label} className="text-right text-muted-foreground">
            —
          </TableCell>
        ))
      ) : (
        <>
          <TableCell className="text-right text-muted-foreground">—</TableCell>
          <TableCell className="text-right tabular-nums">{brl(agg.revenue)}</TableCell>
          <TableCell className="text-right tabular-nums text-muted-foreground">{num(agg.sales)}</TableCell>
          <TableCell className="text-right text-muted-foreground">—</TableCell>
          <TableCell className="text-right text-muted-foreground">—</TableCell>
          <TableCell className="text-right font-semibold tabular-nums text-[var(--color-success)]">
            {brl(agg.revenue)}
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

// ---------- página ----------

function CampaignsPage() {
  const [preset, setPreset] = useState<DatePreset>("last_7d");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<View>("resultado");
  const [account, setAccount] = useState("all");
  // padrão: maior lucro no topo (campanhas campeãs)
  const [sortKey, setSortKey] = useState<SortKey>("profit");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function onSortChange(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(k);
      // métricas numéricas começam descrescente; nome começa ascendente
      setSortDir(k === "name" ? "asc" : "desc");
    }
  }

  const pageRange: DateRange = { type: "preset", preset };
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["fb-campaigns", preset, account],
    queryFn: () => fetchCampaigns(pageRange, account),
  });

  const allAds = useQuery({
    queryKey: ["fb-all-ads", account],
    queryFn: () => fetchAllAds(account),
    staleTime: 1000 * 60 * 10,
  });

  const fx = useQuery({
    queryKey: ["fx-usd-brl"],
    queryFn: fetchUsdBrl,
    staleTime: 1000 * 60 * 60,
  });
  const rate = fx.data?.rate ?? 5.2;

  // Mesmo intervalo que o Meta usa pra puxar o gasto. Sem esse filtro a
  // tabela contava o histórico inteiro de vendas — por isso "Hoje" mostrava
  // 177 vendas enquanto o Dashboard mostrava 8 no mesmo período.
  const sales = useQuery({
    queryKey: ["sales-all", preset],
    queryFn: async (): Promise<SaleRow[]> => {
      if (!supabase) return [];
      const { data: rows, error: e } = await supabase
        .from("sales")
        .select(
          "id,amount,net_amount,status,utm_term,utm_campaign,src,approved_at,order_date,created_at",
        )
        .limit(10000);
      if (e) return [];
      return ((rows ?? []) as SaleRow[]).filter((r) =>
        isSaleInRange(r, pageRange),
      );
    },
  });

  const attribution: AttributedSales = useMemo(() => {
    const campaigns = data ?? [];
    const ads = allAds.data ?? [];
    const index = buildIndex(
      campaigns.map((c) => ({ id: c.id, name: c.name })),
      ads.map((a) => ({ id: a.id, campaign_id: a.campaign_id })),
    );
    return attributeAll(sales.data ?? [], index);
  }, [data, allAds.data, sales.data]);

  const computed = useMemo(
    () => buildComputed(data ?? [], attribution, rate),
    [data, attribution, rate],
  );

  const filtered = useMemo(() => {
    return computed.filter(({ campaign: c }) => {
      if (status !== "ALL" && c.status !== status) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [computed, status, search]);

  const sorted = useMemo(
    () => [...filtered].sort(compareBy(sortKey, sortDir)),
    [filtered, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const onLastPage = page >= totalPages;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Desempenho por campanha
          </h1>
          <p className="text-sm text-muted-foreground">
            Gasto do Meta cruzado com vendas da Ticto. Clique nas colunas pra
            ordenar; padrão: maior lucro no topo.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AccountSelect value={account} onChange={setAccount} />
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-sm">
            {(["resultado", "entrega"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={
                  "rounded-[7px] px-3 py-1 transition-colors " +
                  (view === v
                    ? "bg-accent font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {v === "resultado" ? "Resultado" : "Entrega"}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Atualizar"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Select
            value={preset}
            onValueChange={(v) => {
              setPreset(v as DatePreset);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="yesterday">Ontem</SelectItem>
              <SelectItem value="last_7d">Últimos 7 dias</SelectItem>
              <SelectItem value="last_30d">Últimos 30 dias</SelectItem>
              <SelectItem value="this_month">Este mês</SelectItem>
              <SelectItem value="last_month">Mês passado</SelectItem>
              <SelectItem value="maximum">Tudo</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={status}
            onValueChange={(v) => {
              setStatus(v);
              setPage(1);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos</SelectItem>
              <SelectItem value="ACTIVE">Ativo</SelectItem>
              <SelectItem value="PAUSED">Pausado</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder="Buscar por nome..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead colSpan={2}>
                  <SortBtn
                    k="name"
                    label="Nome"
                    align="left"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onChange={onSortChange}
                  />
                </TableHead>
                <TableHead>Status</TableHead>
                {colsFor(view).map((col) => (
                  <TableHead key={col.label} className="text-right">
                    {col.key ? (
                      <SortBtn
                        k={col.key}
                        label={col.label}
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onChange={onSortChange}
                      />
                    ) : (
                      col.label
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={totalColsFor(view)} className="py-2">
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {error && (
                <TableRow>
                  <TableCell
                    colSpan={totalColsFor(view)}
                    className="text-center py-10 text-destructive"
                  >
                    <AlertCircle className="inline h-5 w-5 mr-2" />
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && visible.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={totalColsFor(view)}
                    className="text-center py-10 text-muted-foreground"
                  >
                    Nenhuma campanha encontrada. Verifique a conexão em
                    Integrações.
                  </TableCell>
                </TableRow>
              )}
              {visible.map(({ campaign: c }) => (
                <CampaignRow
                  key={c.id}
                  campaign={c}
                  preset={preset}
                  rate={rate}
                  attr={attribution}
                  view={view}
                />
              ))}
              {/* mostra o bucket "Não atribuído" só na última página
                  pra não duplicar quando há paginação */}
              {onLastPage && <UnassignedRow agg={attribution.unassigned} view={view} />}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {sorted.length} campanhas • {attribution.totalApproved} vendas
          aprovadas no banco
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={onLastPage}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
