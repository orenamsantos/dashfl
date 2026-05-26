import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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

export const Route = createFileRoute("/_app/sales")({
  head: () => ({ meta: [{ title: "Vendas — AdsTracker" }] }),
  component: SalesPage,
});

interface SaleRow {
  id: string;
  created_at?: string;
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
  return <Badge variant="secondary">{s ?? "—"}</Badge>;
}

function SalesPage() {
  const [checkout, setCheckout] = useState("ALL");
  const [status, setStatus] = useState("ALL");

  const { data, isLoading, error } = useQuery({
    queryKey: ["sales"],
    queryFn: async () => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from("sales")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw new Error(error.message);
      return (data ?? []) as SaleRow[];
    },
  });

  const filtered = useMemo(() => {
    return (data ?? []).filter((s) => {
      const co = s.checkout ?? s.source ?? "";
      if (checkout !== "ALL" && co !== checkout) return false;
      if (status !== "ALL" && (s.status ?? "") !== status) return false;
      return true;
    });
  }, [data, checkout, status]);

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
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Input type="date" />
          <Select value={checkout} onValueChange={setCheckout}>
            <SelectTrigger>
              <SelectValue placeholder="Checkout" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos checkouts</SelectItem>
              <SelectItem value="Hotmart">Hotmart</SelectItem>
              <SelectItem value="Kiwify">Kiwify</SelectItem>
              <SelectItem value="Kirvano">Kirvano</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Todos status</SelectItem>
              <SelectItem value="Aprovada">Aprovada</SelectItem>
              <SelectItem value="Pendente">Pendente</SelectItem>
              <SelectItem value="Reembolsada">Reembolsada</SelectItem>
            </SelectContent>
          </Select>
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
                    Nenhuma venda ainda. Configure os webhooks dos checkouts em
                    Integrações.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((s) => {
                const date = s.created_at ?? s.date;
                return (
                  <TableRow key={s.id}>
                    <TableCell>
                      {date ? new Date(date).toLocaleDateString("pt-BR") : "—"}
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
