import { createFileRoute } from "@tanstack/react-router";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";

// Endpoint de ESCRITA, separado do /api/fb que só lê. Atualiza o orçamento
// (daily_budget ou lifetime_budget) de uma campanha do Meta via Graph API.
// Requer:
//   - sessão autenticada (cookie da fase 6)
//   - FACEBOOK_TOKEN com escopo `ads_management`
// O valor é em UNIDADE MÍNIMA da moeda da conta (centavos USD pra contas USD).

const API = "https://graph.facebook.com/v24.0";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface BudgetBody {
  campaign_id?: string;
  daily_budget?: number;
  lifetime_budget?: number;
}

export const Route = createFileRoute("/api/budget")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();

        const token = process.env.FACEBOOK_TOKEN;
        if (!token) {
          return json(
            { error: "FACEBOOK_TOKEN não configurado no servidor" },
            500,
          );
        }

        let body: BudgetBody = {};
        try {
          const text = await request.text();
          body = text ? JSON.parse(text) : {};
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }

        const campaignId = String(body.campaign_id ?? "").trim();
        if (!campaignId) return json({ error: "campaign_id é obrigatório" }, 400);

        const daily =
          body.daily_budget != null ? Math.round(Number(body.daily_budget)) : null;
        const lifetime =
          body.lifetime_budget != null
            ? Math.round(Number(body.lifetime_budget))
            : null;

        if (daily == null && lifetime == null) {
          return json(
            { error: "Informe daily_budget ou lifetime_budget (em centavos)" },
            400,
          );
        }
        if (daily != null && lifetime != null) {
          return json(
            { error: "Defina daily_budget OU lifetime_budget, não ambos" },
            400,
          );
        }
        const value = daily ?? lifetime;
        if (value == null || !Number.isFinite(value) || value <= 0) {
          return json({ error: "Valor de orçamento inválido" }, 400);
        }

        const form = new URLSearchParams();
        form.set("access_token", token);
        if (daily != null) form.set("daily_budget", String(daily));
        if (lifetime != null) form.set("lifetime_budget", String(lifetime));

        try {
          const res = await fetch(`${API}/${encodeURIComponent(campaignId)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
          });
          const j = await res.json();
          if (j?.error) {
            const code = j.error.code;
            // 10 = permission denied; 200 = permissions error; 100 = invalid param
            const isPerm = code === 10 || code === 200 || code === 294;
            return json(
              {
                error: j.error.message ?? "Erro ao atualizar orçamento",
                permission: isPerm,
                code,
              },
              isPerm ? 403 : 400,
            );
          }
          return json({ ok: true, success: j?.success ?? true });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
