import { createFileRoute } from "@tanstack/react-router";

// Server-side proxy for the Meta Graph API.
// The Facebook token NEVER reaches the browser: it lives only in
// process.env.FACEBOOK_TOKEN on the server. The client calls /api/fb and
// receives only processed data (spend, impressions, campaigns, ...).

const API = "https://graph.facebook.com/v24.0";
const INSIGHTS_FIELDS = "spend,impressions,clicks,reach,cpm,cpc,ctr";

function getCreds() {
  const token = process.env.FACEBOOK_TOKEN;
  let accountId = process.env.FACEBOOK_AD_ACCOUNT_ID;
  // Accept both "act_123" and bare "123".
  if (accountId && !accountId.startsWith("act_")) accountId = `act_${accountId}`;
  return { token, accountId };
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

function parseInsights(arr: any[] | undefined) {
  const i = arr?.[0];
  if (!i)
    return {
      spend: 0,
      impressions: 0,
      clicks: 0,
      reach: 0,
      cpm: 0,
      cpc: 0,
      ctr: 0,
    };
  return {
    spend: Number(i.spend ?? 0),
    impressions: Number(i.impressions ?? 0),
    clicks: Number(i.clicks ?? 0),
    reach: Number(i.reach ?? 0),
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

export const Route = createFileRoute("/api/fb")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const resource = url.searchParams.get("resource") ?? "status";
        const preset = url.searchParams.get("preset") ?? "last_7d";
        const id = url.searchParams.get("id") ?? "";
        const { token, accountId } = getCreds();

        // Status never exposes the token — only whether it's configured.
        if (resource === "status") {
          return jsonResponse({
            configured: Boolean(token && accountId),
            accountId: accountId ?? null,
          });
        }

        // Not configured yet → graceful empty so the dashboard shows zeros.
        if (!token || !accountId) {
          return jsonResponse(emptyFor(resource));
        }

        try {
          switch (resource) {
            case "account_insights": {
              const j = await graph(
                `/${accountId}/insights?fields=${INSIGHTS_FIELDS}&date_preset=${preset}`,
                token,
              );
              const i = parseInsights(j.data);
              return jsonResponse({
                spend: i.spend,
                impressions: i.impressions,
                clicks: i.clicks,
                cpc: i.cpc,
                cpm: i.cpm,
                ctr: i.ctr,
              });
            }
            case "timeseries": {
              const j = await graph(
                `/${accountId}/insights?fields=spend,impressions,clicks&date_preset=${preset}&time_increment=1`,
                token,
              );
              return jsonResponse(
                (j.data ?? []).map((d: any) => ({
                  date: d.date_start,
                  spend: Number(d.spend ?? 0),
                  impressions: Number(d.impressions ?? 0),
                  clicks: Number(d.clicks ?? 0),
                })),
              );
            }
            case "campaigns": {
              const fields = `id,name,status,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
              const j = await graph(
                `/${accountId}/campaigns?fields=${fields}&limit=200`,
                token,
              );
              return jsonResponse(
                (j.data ?? []).map((c: any) => ({
                  id: c.id,
                  name: c.name,
                  status: c.status,
                  insights: parseInsights(c.insights?.data),
                })),
              );
            }
            case "adsets": {
              if (!id) return jsonResponse([]);
              const fields = `id,name,status,campaign_id,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
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
              const fields = `id,name,status,adset_id,campaign_id,insights.date_preset(${preset}){${INSIGHTS_FIELDS}}`;
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
