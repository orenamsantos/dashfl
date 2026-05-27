import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { isAuthenticated, unauthorized } from "@/lib/auth-server";

// CRUD de taxas (Configurações > Taxas). Atrás do login da fase 6 e usando
// service role no servidor (a anon não tem write na tabela `fees`).

function getAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Supabase admin credentials missing on server");
  }
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface FeeRow {
  id: string;
  name: string;
  kind: "percent" | "fixed";
  value: number;
  applies_to: "revenue" | "commission";
}

export const Route = createFileRoute("/api/fees")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        try {
          const admin = getAdmin();
          const { data, error } = await admin
            .from("fees")
            .select("id,name,kind,value,applies_to")
            .order("created_at", { ascending: true });
          if (error) return json({ error: error.message }, 500);
          return json({ fees: data ?? [] });
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
      POST: async ({ request }) => {
        if (!(await isAuthenticated(request))) return unauthorized();
        let body: { action?: string; fee?: Partial<FeeRow>; id?: string } = {};
        try {
          const text = await request.text();
          body = text ? JSON.parse(text) : {};
        } catch {
          return json({ error: "JSON inválido" }, 400);
        }
        const action = String(body.action ?? "");
        try {
          const admin = getAdmin();
          if (action === "add") {
            const f = body.fee ?? {};
            const name = String(f.name ?? "").trim();
            const kind = f.kind === "fixed" ? "fixed" : "percent";
            const value = Number(f.value);
            const appliesTo =
              f.applies_to === "commission" ? "commission" : "revenue";
            if (!name) return json({ error: "Nome obrigatório" }, 400);
            if (!Number.isFinite(value) || value < 0)
              return json({ error: "Valor inválido" }, 400);
            const row: FeeRow = {
              id: `fee-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              name,
              kind,
              value,
              applies_to: appliesTo,
            };
            const { error } = await admin.from("fees").insert(row);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, fee: row });
          }
          if (action === "delete") {
            const id = String(body.id ?? "").trim();
            if (!id) return json({ error: "id obrigatório" }, 400);
            const { error } = await admin.from("fees").delete().eq("id", id);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }
          return json({ error: "Ação desconhecida" }, 400);
        } catch (e) {
          return json({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
