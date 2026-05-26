import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Copy, Check, Loader2, Plug, Unplug } from "lucide-react";
import { toast } from "sonner";
import { getSetting, setSetting } from "@/lib/supabase";

export const Route = createFileRoute("/_app/integrations")({
  head: () => ({ meta: [{ title: "Integrações — AdsTracker" }] }),
  component: IntegrationsPage,
});

interface AdAccount {
  id: string;
  name: string;
  account_id: string;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" />
      <Button
        variant="outline"
        size="icon"
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success("URL copiada");
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  );
}

function WebhookCard({ name, slug }: { name: string; slug: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://seu-dominio.com";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>{name}</CardTitle>
          <Badge variant="secondary">Inativo</Badge>
        </div>
        <CardDescription>Configure este webhook no painel da {name}.</CardDescription>
      </CardHeader>
      <CardContent>
        <CopyField value={`${origin}/webhook/${slug}`} />
      </CardContent>
    </Card>
  );
}

function FacebookCard() {
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [savedToken, setSavedToken] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setSavedToken(await getSetting("facebook_token"));
      setSavedId(await getSetting("facebook_ad_account_id"));
      setSavedName(await getSetting("facebook_ad_account_name"));
    })();
  }, []);

  const connected = !!savedToken && !!savedId;

  async function fetchAccounts() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch(
        `https://graph.facebook.com/v19.0/me/adaccounts?fields=id,name,account_id&access_token=${encodeURIComponent(token)}`,
      );
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      setAccounts(data.data ?? []);
      toast.success("Contas carregadas");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveSelection() {
    const acct = accounts?.find((a) => a.id === selected);
    if (!acct) return;
    await setSetting("facebook_token", token);
    await setSetting("facebook_ad_account_id", acct.id);
    await setSetting("facebook_ad_account_name", acct.name);
    setSavedToken(token);
    setSavedId(acct.id);
    setSavedName(acct.name);
    toast.success("Conta conectada");
  }

  async function disconnect() {
    await setSetting("facebook_token", null);
    await setSetting("facebook_ad_account_id", null);
    await setSetting("facebook_ad_account_name", null);
    setSavedToken(null);
    setSavedId(null);
    setSavedName(null);
    setToken("");
    setAccounts(null);
    setSelected("");
    toast.success("Desconectado");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Facebook Ads</CardTitle>
          {connected ? (
            <Badge className="bg-[var(--color-success)]/15 text-[var(--color-success)] border-0">Conectado</Badge>
          ) : (
            <Badge className="bg-destructive/15 text-destructive border-0">Desconectado</Badge>
          )}
        </div>
        <CardDescription>
          Cole seu Access Token (Graph API v19.0) para listar e escolher a conta de anúncios.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">Conta:</span>{" "}
              <span className="font-medium">{savedName}</span>{" "}
              <span className="text-muted-foreground">({savedId})</span>
            </div>
            <Button variant="destructive" onClick={disconnect} className="gap-2">
              <Unplug className="h-4 w-4" /> Desconectar
            </Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <Input
                placeholder="EAAB..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                className="font-mono text-xs"
              />
              <Button onClick={fetchAccounts} disabled={!token || loading} className="gap-2">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                Conectar
              </Button>
            </div>
            {accounts && accounts.length > 0 && (
              <div className="space-y-2">
                <Select value={selected} onValueChange={setSelected}>
                  <SelectTrigger><SelectValue placeholder="Selecione a conta" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name} ({a.account_id})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={saveSelection} disabled={!selected}>Salvar conta</Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">Conecte o Facebook Ads e os checkouts.</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FacebookCard />
        <WebhookCard name="Hotmart" slug="hotmart" />
        <WebhookCard name="Kiwify" slug="kiwify" />
        <WebhookCard name="Kirvano" slug="kirvano" />
      </div>
    </div>
  );
}
