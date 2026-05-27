// Autenticação simples por senha única (APP_PASSWORD).
// Quando a senha bate, gravamos um cookie HttpOnly com um token que é o
// HMAC-SHA256 de uma string fixa usando APP_PASSWORD como chave. Resultado:
//   - O navegador NÃO recebe a senha; só o token derivado.
//   - Qualquer um que conheça a senha consegue recomputar o token (válido).
//   - Se APP_PASSWORD muda, todos os cookies antigos param de bater (logout
//     forçado).
// Mínimo viável; sem dependências extras; roda nos Workers via Web Crypto.

const COOKIE_NAME = "auth";
const TOKEN_PAYLOAD = "auth-v1";
// 30 dias
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

function bytesToHex(buf: ArrayBuffer): string {
  const arr = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += arr[i].toString(16).padStart(2, "0");
  return s;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return bytesToHex(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function getCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function getAppPassword(): string | null {
  const v = process.env.APP_PASSWORD;
  return v && v.length > 0 ? v : null;
}

export async function computeAuthToken(password: string): Promise<string> {
  return hmacHex(password, TOKEN_PAYLOAD);
}

export async function isAuthenticated(request: Request): Promise<boolean> {
  const password = getAppPassword();
  // Se APP_PASSWORD não está configurada, o app é considerado AINDA NÃO
  // configurado e bloqueia o acesso (mais seguro do que deixar tudo aberto).
  if (!password) return false;
  const token = getCookie(request, COOKIE_NAME);
  if (!token) return false;
  const expected = await computeAuthToken(password);
  return timingSafeEqual(token, expected);
}

export function buildAuthCookie(token: string, secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookie(secure: boolean): string {
  const parts = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  // Em prod (Cloudflare) o protocolo é https; em dev local roda em http.
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const xfProto = request.headers.get("x-forwarded-proto");
  return xfProto === "https";
}

export function unauthorized(message = "Não autenticado"): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
