import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { Trash2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/supabase";
import { mockFees } from "@/data/mockData";
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
  const [token, setToken] = useState<string | null>(null);
  const [newToken, setNewToken] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    (async () => {
      setToken(await getSetting("facebook_token"));
      setLastSync(await getSetting("last_fb_sync"));
    })();
  }, []);

  const masked = token ? `${token.slice(0, 10)}...` : "—";

  async function update() {
    if (!newToken) return;
    await setSetting("facebook_token", newToken);
    setToken(newToken);
    setNewToken("");
    toast.success("Token atualizado");
  }

  async function sync() {
    setSyncing(true);
    await new Promise((r) => setTimeout(r, 1200));
    const now = new Date().toISOString();
    await setSetting("last_fb_sync", now);
    setLastSync(now);
    setSyncing(false);
    toast.success("Sincronização concluída");
  }

  return (
    <Card>
      <CardHeader><CardTitle>Facebook Ads</CardTitle></CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div className="space-y-2">
          <Label>Token atual</Label>
          <Input readOnly value={masked} className="font-mono" />
        </div>
        <div className="space-y-2">
          <Label>Atualizar token</Label>
          <div className="flex gap-2">
            <Input value={newToken} onChange={(e) => setNewToken(e.target.value)} placeholder="Cole o novo token" />
            <Button onClick={update} disabled={!newToken}>Atualizar</Button>
          </div>
        </div>
        <div className="pt-2 flex items-center gap-3">
          <Button onClick={sync} disabled={syncing} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
            Sincronizar agora
          </Button>
          <span className="text-sm text-muted-foreground">
            Última: {lastSync ? new Date(lastSync).toLocaleString("pt-BR") : "nunca"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function FeesTab() {
  const [fees, setFees] = useState<Fee[]>(mockFees);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Omit<Fee, "id">>({
    name: "",
    kind: "percent",
    value: 0,
    appliesTo: "revenue",
  });

  function add() {
    if (!draft.name) return;
    setFees((f) => [...f, { ...draft, id: `fee-${Date.now()}` }]);
    setDraft({ name: "", kind: "percent", value: 0, appliesTo: "revenue" });
    setOpen(false);
    toast.success("Taxa adicionada");
  }

  function remove(id: string) {
    setFees((f) => f.filter((x) => x.id !== id));
    toast.success("Taxa removida");
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
              <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={add}>Adicionar</Button>
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
            {fees.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.name}</TableCell>
                <TableCell>{f.kind === "percent" ? "Percentual" : "Fixo"}</TableCell>
                <TableCell>{f.kind === "percent" ? `${f.value}%` : `R$ ${f.value.toFixed(2)}`}</TableCell>
                <TableCell>{f.appliesTo === "revenue" ? "Receita" : "Comissão"}</TableCell>
                <TableCell className="text-right">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon">
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
