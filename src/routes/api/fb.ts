import { createFileRoute } from "@tanstack/react-router";

// Server-side proxy for the Meta Graph API.
// The Facebook token NEVER reaches the browser: it lives only in
// process.env.FACEBOOK_TOKEN on the server. The client calls /api/fb and
// receives only processed data (spend, impressions, campaigns, ...).

const API = "https://graph.facebook.com/v24.0";
const INSIGHTS_FIELDS =
  "spend,impressions,clicks,reach,frequency,cpm,cpc,ctr";

function normAcc(a: string): string {
  const t = a.trim();
  return t.startsWith("act_") ? t : `act_${t}`;
}

// FACEBOOK_AD_ACCOUNT_ID aceita UMA conta ("123") ou VÁRIAS separadas por
// vírgula ("123,456"). Com mais de uma, o dashboard agrega o gasto das duas
// (ex.: C03 + C05 da VORTX BR, que disparam o mesmo pixel e webhook).
function getCreds() {
  const token = process.env.FACEBOOK_TOKEN;
  const raw = process.env.FACEBOOK_AD_ACCOUNT_ID ?? "";
  const accountIds = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normAcc);
  return { token, accountIds };
}

// Resolve quais contas usar nesta chamada: se vier ?account=<id> e ele estiver
// na lista configurada, escopa só nele; senão usa todas (visão agregada).
function pickAccounts(all: string[], param: string | null): string[] {
  if (!param || param === "all") return all;
  const want = normAcc(param);
  return all.includes(want) ? [want] : all;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function graph(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(
    `${API}${path}${sep}access_token=${encodeURIComponent(token)}`,
  );
  const json = await res.json();
  if (json?.error) throw new Error(json.error.message ?? "Graph API error");
  return json;
}

// Constrói o trecho de query string que delimita o período pro insights.
// Aceita ou um `preset` (date_preset=...) OU um par {since, until} (time_range={...}).
// Mantém compat com chamadas que só passam preset.
function rangeParam(opts: {
  preset?: string | null;
  since?: string | null;
  until?: string | null;
}): string {
  const since = opts.since?.trim();
  const until = opts.until?.trim();
  if (since && until) {
    const tr = JSON.stringify({ since, until });
    return `time_range=${encodeURIComponent(tr)}`;
  }
  const preset = opts.preset?.trim() || "last_7d";
  return `date_preset=${encodeURIComponent(preset)}`;
}

function parseInsights(arr: any[] | undefined) {
  const i = arr?.[0];
  if (!i)
    return {
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      frequency: 0,
      cpm: 0,
      cpc: 0,
      ctr: 0,
    };
  return {
    spend: Number(i.spend ?? 0),
    impressions: Number(i.impressions ?? 0),
    clicks: Number(i.clicks ?? 0),
    reach: Number(i.reach ?? 0),
    frequency: Number(i.frequency ?? 0),
    cpm: Number(i.cpm ?? 0),
    cpc: Number(i.cpc ?? 0),
    ctr: Number(i.ctr ?? 0),
  };
}

function emptyFor(resource: string): unknown {
  if (resource === "account_insights")
    return { spend: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0 };
  return [];
}

// Pagina cursores do Graph até `maxPages` (ou até esgotar). Usado pelo
// `all_ads` que pode trazer milhares de anúncios — limitamos pra não estourar
// o tempo do worker.
async function graphPaged(
  path: string,
  token: string,
  maxPages: number,
): Promise<any[]> {
  const all: any[] = [];
  let next: string | null = null;
  for (let i = 0; i < maxPages; i++) {
    let url: string;
    if (next) {
      url = next;
    } else {
      const sep = path.includes("?") ? "&" : "?";
      url = `${API}${path}${sep}access_token=${encodeURIComponent(token)}`;
    }
    const res = await fetch(url);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message ?? "Graph API error");
    if (Array.isArray(json.data)) all.push(...json.data);
    next = json?.paging?.next ?? null;
    if (!next) break;
  }
  return all;
}

export const Route = createFileRoute("/api/fb")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const resource = url.searchParams.get("resource") ?? "status";
        const preset = url.searchParams.get("preset") ?? "last_7d";
        const since = url.searchParams.get("since");
        const until = url.searchParams.get("until");
        const range = rangeParam({ preset, since, until });
        // Para insights aninhados em campaigns/adsets/ads o Graph aceita o
        // mesmo time_range, mas com sintaxe um pouco diferente — montamos um
        // string com chaves do tipo `time_range({...})` quando necessário.
        const nestedRange =
          since && until
            ? `time_range({"since":"${since}","until":"${until}"})`
            : `date_preset(${preset})`;
        const id = url.searchParams.get("id") ?? "";
        const { token, accountIds } = getCreds();
        const accounts = pickAccounts(accountIds, url.searchParams.get("account"));

        // Status never exposes the token — only whether it's configured.
        // Devolve TODAS as contas configuradas (id + nome + fuso) pro seletor.
        // O fuso (timezone_name) é o que a Meta usa pra fechar o dia do gasto;
        // se diferente de SP, "hoje"/"ontem" do gasto e das vendas não batem.
        if (resource === "status") {
          const accs: { id: string; name: string; timezone: string | null }[] = [];
          if (token) {
            for (const acc of accountIds) {
              try {
                const j = await graph(`/${acc}?fields=name,timezone_name`, token);
                accs.push({
                  id: acc,
                  name: j?.name ?? acc,
                  timezone: j?.timezone_name ?? null,
                });
              } catch {
                accs.push({ id: acc, name: acc, timezone: null });
              }
            }
          }
          return jsonResponse({
            configured: Boolean(token && accountIds.length),
            accountId: accountIds[0] ?? null,
            accounts: accs,
            timezone: accs[0]?.timezone ?? null,
          });
        }

        // Not configured yet → graceful empty so the dashboard shows zeros.
        if (!token || accounts.length === 0) {
          return jsonResponse(emptyFor(resource));
        }

        try {
          switch (resource) {
            case "account_insights": {
              // Soma o gasto/impressões/cliques de TODAS as contas do escopo;
              // recalcula cpc/cpm/ctr a partir dos totais.
              let spend = 0;
              let impressions = 0;
              let clicks = 0;
              for (const acc of accounts) {
                const j = await graph(
                  `/${acc}/insights?fields=${INSIGHTS_FIELDS}&${range}`,
                  token,
                );
                const i = parseInsights(j.data);
                spend += i.spend;
                impressions += i.impressions;
                clicks += i.clicks;
              }
              return jsonResponse({
                spend,
                impressions,
                clicks,
                cpc: clicks > 0 ? spend / clicks : 0,
                cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
                ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
              });
            }
            case "timeseries": {
              // Funde as séries diárias das contas por data (soma).
              const byDate = new Map<
                string,
                { spend: number; impressions: number; clicks: number }
              >();
              for (const acc of accounts) {
                const j = await graph(
                  `/${acc}/insights?fields=spend,impressions,clicks&${range}&time_increment=1`,
                  token,
                );
                for (const d of j.data ?? []) {
                  const e =
                    byDate.get(d.date_start) ?? { spend: 0, impressions: 0, clicks: 0 };
                  e.spend += Number(d.spend ?? 0);
                  e.impressions += Number(d.impressions ?? 0);
                  e.clicks += Number(d.clicks ?? 0);
                  byDate.set(d.date_start, e);
                }
              }
              return jsonResponse(
                [...byDate.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([date, v]) => ({ date, ...v })),
              );
            }
            case "campaigns": {
              const fields = `id,name,status,daily_budget,lifetime_budget,insights.${nestedRange}{${INSIGHTS_FIELDS}}`;
              const out: any[] = [];
              for (const acc of accounts) {
                const j = await graph(
                  `/${acc}/campaigns?fields=${fields}&limit=200`,
                  token,
                );
                for (const c of j.data ?? []) {
                  out.push({
                    id: c.id,
                    name: c.name,
                    status: c.status,
                    daily_budget: c.daily_budget != null ? Number(c.daily_budget) : null,
                    lifetime_budget:
                      c.lifetime_budget != null ? Number(c.lifetime_budget) : null,
                    insights: parseInsights(c.insights?.data),
                  });
                }
              }
              return jsonResponse(out);
            }
            case "all_ads": {
              // Lista enxuta de TODOS os anúncios das contas (id + campaign_id)
              // pra montar o índice ad.id → campaign_id e cruzar com vendas
              // que vêm com utm_term=ad.id. Sem insights pra ficar barato.
              const out: any[] = [];
              for (const acc of accounts) {
                const data = await graphPaged(
                  `/${acc}/ads?fields=id,campaign_id,adset_id&limit=500`,
                  token,
                  10,
                );
                for (const a of data) {
                  out.push({
                    id: a.id,
                    campaign_id: a.campaign_id,
                    adset_id: a.adset_id,
                  });
                }
              }
              return jsonResponse(out);
            }
            case "adsets": {
              if (!id) return jsonResponse([]);
              const fields = `id,name,status,campaign_id,insights.${nestedRange}{${INSIGHTS_FIELDS}}`;
              const j = await graph(
                `/${id}/adsets?fields=${fields}&limit=200`,
                token,
              );
              return jsonResponse(
                (j.data ?? []).map((a: any) => ({
                  id: a.id,
                  name: a.name,
                  status: a.status,
                  campaign_id: a.campaign_id,
                  insights: parseInsights(a.insights?.data),
                })),
              );
            }
            case "ads": {
              if (!id) return jsonResponse([]);
              const fields = `id,name,status,adset_id,campaign_id,insights.${nestedRange}{${INSIGHTS_FIELDS}}`;
              const j = await graph(
                `/${id}/ads?fields=${fields}&limit=200`,
                token,
              );
              return jsonResponse(
                (j.data ?? []).map((a: any) => ({
                  id: a.id,
                  name: a.name,
                  status: a.status,
                  adset_id: a.adset_id,
                  campaign_id: a.campaign_id,
                  insights: parseInsights(a.insights?.data),
                })),
              );
            }
            default:
              return jsonResponse({ error: "unknown resource" }, 400);
          }
        } catch (e) {
          return jsonResponse({ error: (e as Error).message }, 500);
        }
      },
    },
  },
});
