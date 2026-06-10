import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";
import { brl } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { saleEventDate, ymdSp } from "@/lib/date-range";

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Vendas — AdsTracker" }] }),
  component: SalesPage,
});

interface SaleRow {
  id: string;
  created_at?: string;
  order_date?: string | null;
  approved_at?: string | null;
  date?: string;
  product?: string;
  product_name?: string;
  amount: number;
  checkout?: string;
  source?: string;
  campaign_name?: string | null;
  campaign?: string | null;
  adset_name?: string | null;
  adset?: string | null;
  ad_name?: string | null;
  ad?: string | null;
  status?: string;
  type?: string;
}

function StatusBadge({ s }: { s?: string }) {
  const v = (s ?? "").toLowerCase();
  if (v === "aprovada" || v === "approved")
    return (
      <Badge className="bg-[var(--color-success)]/15 text-[var(--color-success)] border-0">
        Aprovada
      </Badge>
    );
  if (v === "pendente" || v === "pending")
    return (
      <Badge className="bg-yellow-500/15 text-yellow-400 border-0">
        Pendente
      </Badge>
    );
  if (v === "reembolsada" || v === "refunded")
    return (
      <Badge className="bg-destructive/15 text-destructive border-0">
        Reembolsada
      </Badge>
    );
  if (v === "recusada" || v === "refused")
    return (
      <Badge className="bg-destructive/10 text-destructive/90 border-0">
        Recusada
      </Badge>
    );
  if (v === "expirada" || v === "expired")
    return <Badge variant="secondary">Expirada</Badge>;
  if (v === "abandonada" || v === "abandoned_cart")
    return <Badge variant="secondary">Abandonada</Badge>;
  return <Badge variant="secondary">{s ?? "—"}</Badge>;
}

// Rótulo amigável pro filtro de status (a partir do valor canônico do banco).
const STATUS_ORDER = [
  "Aprovada",
  "Pendente",
  "Reembolsada",
  "Recusada",
  "Expirada",
  "Abandonada",
];

function SalesPage() {
  const [checkout, setCheckout] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      if (!supabase) return [];
      // Ordena pela data REAL da venda (order_date), não por created_at — que é
      // a hora em que a linha foi gravada (todas as importadas por CSV teriam a
      // mesma data do import). nullsFirst:false joga datas ausentes pro fim.
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("order_date", { ascending: false, nullsFirst: false })
        .limit(2000);
      if (error) throw new Error(error.message);
      return (data ?? []) as SaleRow[];
    },
  });

  // Opções de filtro derivadas dos dados reais (não chumbadas): só aparecem os
  // checkouts/status que existem de fato no banco.
  const checkoutOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of data ?? []) {
      const co = s.checkout ?? s.source;
      if (co) set.add(co);
    }
    return [...set].sort();
  }, [data]);

  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of data ?? []) if (s.status) set.add(s.status);
    return [...set].sort(
      (a, b) => STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b),
    );
  }, [data]);

  const filtered = useMemo(() => {
    return (data ?? []).filter((s) => {
      const co = s.checkout ?? s.source ?? "";
      if (checkout !== "ALL" && co !== checkout) return false;
      if (status !== "ALL" && (s.status ?? "") !== status) return false;
      if (from || to) {
        const d = saleEventDate(s);
        if (!d) return false;
        const ymd = ymdSp(d);
        if (from && ymd < from) return false;
        if (to && ymd > to) return false;
      }
      return true;
    });
  }, [data, checkout, status, from, to]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Vendas</h1>
        <p className="text-sm text-muted-foreground">
          Vendas recebidas via webhooks dos checkouts.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">De</span>
            <Input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Até</span>
            <Input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Checkout</span>
            <Select value={checkout} onValueChange={setCheckout}>
              <SelectTrigger>
                <SelectValue placeholder="Checkout" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos checkouts</SelectItem>
                {checkoutOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Status</span>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos status</SelectItem>
                {statusOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => {
                setFrom("");
                setTo("");
                setCheckout("ALL");
                setStatus("ALL");
              }}
            >
              Limpar
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Checkout</TableHead>
                <TableHead>Campanha</TableHead>
                <TableHead>Conjunto</TableHead>
                <TableHead>Anúncio</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-10 text-muted-foreground"
                  >
                    <Loader2 className="inline h-5 w-5 animate-spin mr-2" />
                    Carregando...
                  </TableCell>
                </TableRow>
              )}
              {error && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-10 text-destructive"
                  >
                    {(error as Error).message}
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && !error && filtered.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-10 text-muted-foreground"
                  >
                    {(data?.length ?? 0) > 0
                      ? "Nenhuma venda com esses filtros. Ajuste o período ou o status."
                      : "Nenhuma venda ainda. Importe um CSV da Ticto ou configure o webhook em Integrações."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((s) => {
                // Data REAL da venda: approved_at → order_date → created_at.
                const d = saleEventDate(s);
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      {d ? d.toLocaleDateString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {s.product ?? s.product_name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {brl(Number(s.amount ?? 0))}
                    </TableCell>
                    <TableCell>{s.checkout ?? s.source ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.campaign_name ?? s.campaign ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.adset_name ?? s.adset ?? "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.ad_name ?? s.ad ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge s={s.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
