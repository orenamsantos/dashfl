import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Entrar — dashfl" }] }),
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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, oklch(0.8 0.17 152 / 0.07), transparent 70%)",
        }}
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/15 ring-1 ring-primary/25">
            <TrendingUp className="h-6 w-6 text-primary" />
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">dashfl</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Painel de ROI · Meta Ads + Ticto
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6 shadow-[0_20px_50px_-30px_#000]">
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">Senha de acesso</Label>
              <Input
                id="password"
                type="password"
                autoFocus
                autoComplete="current-password"
                placeholder="••••••••"
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
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Entrar"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
