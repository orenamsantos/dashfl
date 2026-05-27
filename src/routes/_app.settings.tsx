import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { fetchFBStatus } from "@/lib/facebook-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/supabase";
import { addFee, deleteFee, listFees } from "@/lib/fees";
import type { Fee } from "@/types";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({ meta: [{ title: "Configurações — AdsTracker" }] }),
  component: SettingsPage,
});

function GeneralTab() {
  const [name, setName] = useState("AdsTracker");
  const [tz, setTz] = useState("America/Sao_Paulo");
  const [currency, setCurrency] = useState("BRL");

  useEffect(() => {
    (async () => {
      setName((await getSetting("app_name")) ?? "AdsTracker");
      setTz((await getSetting("timezone")) ?? "America/Sao_Paulo");
      setCurrency((await getSetting("currency")) ?? "BRL");
    })();
  }, []);

  async function save() {
    await setSetting("app_name", name);
    await setSetting("timezone", tz);
    await setSetting("currency", currency);
    toast.success("Configurações salvas");
  }

  return (
    <Card>
      <CardHeader><CardTitle>Geral</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-md">
        <div className="space-y-2">
          <Label>Nome do app</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Fuso horário</Label>
          <Select value={tz} onValueChange={setTz}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="America/Sao_Paulo">America/Sao_Paulo</SelectItem>
              <SelectItem value="America/New_York">America/New_York</SelectItem>
              <SelectItem value="Europe/Lisbon">Europe/Lisbon</SelectItem>
              <SelectItem value="UTC">UTC</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Moeda padrão</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="BRL">BRL — Real</SelectItem>
              <SelectItem value="USD">USD — Dólar</SelectItem>
              <SelectItem value="EUR">EUR — Euro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={save}>Salvar</Button>
      </CardContent>
    </Card>
  );
}

function FacebookTab() {
  const [status, setStatus] = useState<{
    configured: boolean;
    accountId: string | null;
  } | null>(null);

  useEffect(() => {
    fetchFBStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, accountId: null }));
  }, []);

  return (
    <Card>
      <CardHeader><CardTitle>Facebook Ads</CardTitle></CardHeader>
      <CardContent className="space-y-3 max-w-xl text-sm">
        <p className="text-muted-foreground">
          Por segurança, o token do Facebook é configurado no servidor (variável
          de ambiente FACEBOOK_TOKEN) e nunca é inserido ou exibido aqui. Para
          trocar o token, atualize o secret no Cloudflare.
        </p>
        {status?.configured ? (
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="font-medium text-[var(--color-success)]">
              Conectado
            </span>{" "}
            <span className="text-muted-foreground">
              — conta {status.accountId}
            </span>
          </div>
        ) : (
          <div>
            <span className="text-muted-foreground">Status:</span>{" "}
            <span className="font-medium text-destructive">Não configurado</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FeesTab() {
  // Sem seed: a lista começa vazia e é populada do banco. O líquido do
  // dashboard NÃO depende destas taxas — vem de net_amount (producer.amount).
  const [fees, setFees] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<Fee, "id">>({
    name: "",
    kind: "percent",
    value: 0,
    appliesTo: "revenue",
  });

  useEffect(() => {
    let cancelled = false;
    listFees()
      .then((rows) => {
        if (!cancelled) setFees(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) toast.error(`Falha ao carregar taxas: ${e.message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function add() {
    if (!draft.name) return;
    setBusy(true);
    try {
      const created = await addFee(draft);
      setFees((f) => [...f, created]);
      setDraft({ name: "", kind: "percent", value: 0, appliesTo: "revenue" });
      setOpen(false);
      toast.success("Taxa adicionada");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await deleteFee(id);
      setFees((f) => f.filter((x) => x.id !== id));
      toast.success("Taxa removida");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Taxas</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Adicionar taxa</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova taxa</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={draft.kind} onValueChange={(v) => setDraft({ ...draft, kind: v as Fee["kind"] })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">Percentual</SelectItem>
                      <SelectItem value="fixed">Fixo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Valor</Label>
                  <Input type="number" value={draft.value} onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Aplica-se a</Label>
                <Select value={draft.appliesTo} onValueChange={(v) => setDraft({ ...draft, appliesTo: v as Fee["appliesTo"] })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="revenue">Receita</SelectItem>
                    <SelectItem value="commission">Comissão</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancelar</Button>
              <Button onClick={add} disabled={busy || !draft.name}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Adicionar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Aplica-se a</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  <Loader2 className="inline h-4 w-4 animate-spin mr-2" />
                  Carregando...
                </TableCell>
              </TableRow>
            )}
            {!loading && fees.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-6 text-muted-foreground">
                  Nenhuma taxa cadastrada.
                </TableCell>
              </TableRow>
            )}
            {fees.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell>{f.kind === "percent" ? "Percentual" : "Fixo"}</TableCell>
                <TableCell>{f.kind === "percent" ? `${f.value}%` : `R$ ${f.value.toFixed(2)}`}</TableCell>
                <TableCell>{f.appliesTo === "revenue" ? "Receita" : "Comissão"}</TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={busy}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Excluir taxa?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(f.id)}>Excluir</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground">Preferências do app e integrações.</p>
      </div>
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">Geral</TabsTrigger>
          <TabsTrigger value="facebook">Facebook Ads</TabsTrigger>
          <TabsTrigger value="fees">Taxas</TabsTrigger>
        </TabsList>
        <TabsContent value="general" className="mt-4"><GeneralTab /></TabsContent>
        <TabsContent value="facebook" className="mt-4"><FacebookTab /></TabsContent>
        <TabsContent value="fees" className="mt-4"><FeesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
