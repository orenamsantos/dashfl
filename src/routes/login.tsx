import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Lock } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Login — AdsTracker" }] }),
  component: LoginPage,
});

interface MeResponse {
  authenticated: boolean;
  configured: boolean;
}

function LoginPage() {
  const router = useRouter();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meState, setMeState] = useState<MeResponse | null>(null);

  // Se o usuário já está autenticado, manda direto pro dashboard.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j: MeResponse) => {
        if (cancelled) return;
        setMeState(j);
        if (j.authenticated) navigate({ to: "/dashboard" });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error ?? "Falha no login");
        return;
      }
      // invalida o cache do beforeLoad pro _app reavaliar a sessão
      await router.invalidate();
      navigate({ to: "/dashboard" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-md bg-primary/20 grid place-items-center text-primary">
              <Lock className="h-4 w-4" />
            </div>
            <CardTitle>Entrar no AdsTracker</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            {meState && !meState.configured && (
              <p className="text-xs text-muted-foreground">
                Defina a variável de ambiente <code>APP_PASSWORD</code> no
                Cloudflare e faça um novo deploy.
              </p>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={submitting || !password}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Entrar"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
