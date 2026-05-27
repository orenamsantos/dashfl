import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { AppLayout } from "@/components/app-layout";
import { isAuthenticated } from "@/lib/auth-server";

// Roda no servidor a cada navegação pra dentro do _app. Se o cookie não
// validar contra APP_PASSWORD, redireciona pro /login. Garante que o dashboard
// inteiro fica atrás do login (inclusive a edição de orçamento da fase 7).
const requireAuth = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const ok = await isAuthenticated(request);
  return { authenticated: ok };
});

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const { authenticated } = await requireAuth();
    if (!authenticated) {
      throw redirect({ to: "/login" });
    }
  },
  component: AppLayout,
});
