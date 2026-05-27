import { createFileRoute } from "@tanstack/react-router";
import {
  buildAuthCookie,
  computeAuthToken,
  getAppPassword,
  isSecureRequest,
} from "@/lib/auth-server";

function json(data: unknown, status: number, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const password = getAppPassword();
        if (!password) {
          return json(
            {
              error:
                "APP_PASSWORD não configurada no servidor. Configure o secret no Cloudflare.",
            },
            500,
          );
        }
        let body: { password?: string } = {};
        try {
          const text = await request.text();
          body = text ? JSON.parse(text) : {};
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const provided = String(body.password ?? "");
        if (!provided) return json({ error: "Senha obrigatória" }, 400);
        if (provided !== password) {
          return json({ error: "Senha incorreta" }, 401);
        }
        const token = await computeAuthToken(password);
        const cookie = buildAuthCookie(token, isSecureRequest(request));
        return json({ ok: true }, 200, { "Set-Cookie": cookie });
      },
    },
  },
});
