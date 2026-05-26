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
import { ChevronDown, ChevronRight, Loader2, AlertCircle } from "lucide-react";
import { brl, num } from "@/lib/format";
import {
  fetchCampaigns,
  fetchAdSets,
  fetchAds,
  type DatePreset,
  type FBCampaign,
  type FBAdSet,
  type FBAd,
  type FBInsight,
} from "@/lib/facebook-api";
import { fetchUsdBrl } from "@/lib/currency";

export const Route = createFileRoute("/_app/campaigns")({
  head: () => ({ meta: [{ title: "Campanhas — AdsTracker" }] }),
  component: CampaignsPage,
});

const PAGE_SIZE = 10;

function MetricsRow({ m, rate }: { m: FBInsight; rate: number }) {
  const spend = m.spend * rate;
  const cpc = m.clicks > 0 ? spend / m.clicks : 0;
  const cpm = m.impressions > 0 ? (spend / m.impressions) * 1000 : 0;
  return (
    <>
      <TableCell className="text-right">{brl(spend)}</TableCell>
      <TableCell className="text-right">{num(m.impressions)}</TableCell>
      <TableCell className="text-right">{num(m.clicks)}</TableCell>
      <TableCell className="text-right">{brl(cpm)}</TableCell>
      <TableCell className="text-right">{brl(cpc)}</TableCell>
      <TableCell className="text-right">{(m.ctr ?? 0).toFixed(2)}%</TableCell>
    </>
  );
}

function StatusBadge({ s }: { s: FBCampaign["status"] }) {
  if (s === "ACTIVE")
    return (
      <Badge className="bg-[var(--color-success)]/15 text-[var(--color-success)] border-0">
        Ativo
      </Badge>
    );
  return <Badge variant="secondary">{s === "PAUSED" ? "Pausado" : s}</Badge>;
}

function AdRow({ ad, rate }: { ad: FBAd; rate: number }) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell style={{ paddingLeft: 64 }} colSpan={2}>
        <span className="text-muted-foreground">↳ </span>
        {ad.name}
      </TableCell>
      <TableCell>
        <StatusBadge s={ad.status} />
      </TableCell>
      <MetricsRow m={ad.insights} rate={rate} />
    </TableRow>
  );
}

function AdSetRow({
  adset,
  preset,
  rate,
}: {
  adset: FBAdSet;
  preset: DatePreset;
  rate: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: ads, isLoading } = useQuery({
    queryKey: ["fb-ads", adset.id, preset],
    queryFn: () => fetchAds(adset.id, preset),
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
        <MetricsRow m={adset.insights} rate={rate} />
      </TableRow>
      {open && isLoading && (
        <TableRow>
          <TableCell colSpan={9} className="text-center text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Carregando anúncios...
          </TableCell>
        </TableRow>
      )}
      {open && ads?.map((ad) => <AdRow key={ad.id} ad={ad} rate={rate} />)}
    </>
  );
}

function CampaignRow({
  campaign,
  preset,
  rate,
}: {
  campaign: FBCampaign;
  preset: DatePreset;
  rate: number;
}) {
  const [open, setOpen] = useState(false);
  const { data: adsets, isLoading } = useQuery({
    queryKey: ["fb-adsets", campaign.id, preset],
    queryFn: () => fetchAdSets(campaign.id, preset),
    enabled: open,
  });
  return (
    <>
      <TableRow
        className="cursor-pointer"
        onClick={() => setOpen((o) => !o)}
      >
        <TableCell colSpan={2} className="font-medium">
          <span className="inline-flex items-center gap-2">
            {open ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {campaign.name}
          </span>
        </TableCell>
        <TableCell>
          <StatusBadge s={campaign.status} />
        </TableCell>
        <MetricsRow m={campaign.insights} rate={rate} />
      </TableRow>
      {open && isLoading && (
        <TableRow>
          <TableCell colSpan={9} className="text-center text-muted-foreground">
            <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
            Carregando conjuntos...
          </TableCell>
        </TableRow>
      )}
      {open &&
        adsets?.map((as) => (
          <AdSetRow key={as.id} adset={as} preset={preset} rate={rate} />
        ))}
    </>
  );
}

function CampaignsPage() {
  const [preset, setPreset] = useState<DatePreset>("last_7d");
  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["fb-campaigns", preset],
    queryFn: () => fetchCampaigns(preset),
  });

  const fx = useQuery({
    queryKey: ["fx-usd-brl"],
    queryFn: () => import("@/lib/currency").then((m) => m.fetchUsdBrl()),
    staleTime: 1000 * 60 * 60,
  });
  const rate = fx.data?.rate ?? 5.2;

  const filtered = useMemo(() => {
    const list = data ?? [];
    return list.filter((c) => {
      if (status !== "ALL" && c.status !== status) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [data, status, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
          <p className="text-sm text-muted-foreground">
            Dados em tempo real do Facebook Ads.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Atualizar"
          )}
        </Button>
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
                <TableHead colSpan={2}>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Gasto</TableHead>
                <TableHead className="text-right">Impressões</TableHead>
                <TableHead className="text-right">Cliques</TableHead>
                <TableHead className="text-right">CPM</TableHead>
                <TableHead className="text-right">CPC</TableHead>
                <TableHead className="text-right">CTR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
                    Carregando campanhas...
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-destructive">
                    <AlertCircle className="inline h-5 w-5 mr-2" />
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                    Nenhuma campanha encontrada. Verifique a conexão em Integrações.
                  </TableCell>
                </TableRow>
              )}
              {visible.map((c) => (
                <CampaignRow key={c.id} campaign={c} preset={preset} rate={rate} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} campanhas</span>
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
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
    </div>
  );
}
