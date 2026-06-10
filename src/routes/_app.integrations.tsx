import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { fetchFBStatus } from "@/lib/facebook-api";

export const Route = createFileRoute("/_app/integrations")({
  head: () => ({ meta: [{ title: "Integrações — AdsTracker" }] }),
  component: IntegrationsPage,
});

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

function TictoCard() {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://seu-dominio.com";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Ticto</CardTitle>
          <Badge variant="secondary">Webhook</Badge>
        </div>
        <CardDescription>
          Cole esta URL no campo URL do webhook da Ticto e marque os eventos
          (Venda Realizada, Reembolso, Chargeback).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <CopyField value={`${origin}/api/public/webhooks/ticto`} />
      </CardContent>
    </Card>
  );
}

function FacebookCard() {
  const [status, setStatus] = useState<{
    configured: boolean;
    accountId: string | null;
  } | null>(null);

  useEffect(() => {
    fetchFBStatus()
      .then(setStatus)
      .catch(() => setStatus({ configured: false, accountId: null }));
  }, []);

  const connected = !!status?.configured;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Facebook Ads</CardTitle>
          {connected ? (
            <Badge className="bg-[var(--color-success)]/15 text-[var(--color-success)] border-0">
              Conectado
            </Badge>
          ) : (
            <Badge className="bg-destructive/15 text-destructive border-0">
              Não configurado
            </Badge>
          )}
        </div>
        <CardDescription>
          Por segurança, o token do Facebook é configurado no servidor (variável
          de ambiente FACEBOOK_TOKEN) e nunca é inserido ou exibido aqui.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm">
        {connected ? (
          <div>
            <span className="text-muted-foreground">Conta de anúncios:</span>{" "}
            <span className="font-mono">{status?.accountId}</span>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Defina <span className="font-mono">FACEBOOK_TOKEN</span> e{" "}
            <span className="font-mono">FACEBOOK_AD_ACCOUNT_ID</span> nas
            variáveis de ambiente do servidor (Cloudflare → Settings → Variables
            and Secrets) e faça um novo deploy.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function IntegrationsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Integrações</h1>
        <p className="text-sm text-muted-foreground">
          Conecte o Facebook Ads e o checkout da Ticto.
        </p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <FacebookCard />
        <TictoCard />
      </div>
    </div>
  );
}
