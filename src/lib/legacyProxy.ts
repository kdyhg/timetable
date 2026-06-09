import { recordAuditLog, sanitizeForPersistence } from "@/lib/storage";

function legacyBaseUrl(request: Request) {
  return process.env.LEGACY_API_ORIGIN || new URL(request.url).origin;
}

function legacyUrl(request: Request, path: string) {
  const url = new URL("/api", legacyBaseUrl(request));
  url.searchParams.set("__path", path.replace(/^\/+/, ""));
  return url;
}

function legacyHeaders(extra?: HeadersInit) {
  const headers = new Headers(extra);
  const secret = process.env.AUTH_SECRET;
  if (secret) headers.set("X-Internal-Auth", secret);
  return headers;
}

export async function proxyLegacy(
  request: Request,
  path: string,
  init: { method?: string; body?: BodyInit | null; headers?: HeadersInit } = {},
) {
  const method = init.method || request.method;
  const response = await fetch(legacyUrl(request, path), {
    method,
    headers: legacyHeaders(init.headers),
    body: method === "GET" || method === "HEAD" ? undefined : init.body,
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function proxyLegacyRequest(request: Request, path: string) {
  const method = request.method;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  return proxyLegacy(request, path, { method, headers, body });
}

export async function proxyLegacyJson(request: Request, path: string, payload: Record<string, unknown>) {
  const response = await fetch(legacyUrl(request, path), {
    method: "POST",
    headers: legacyHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const text = await response.text();
  let json: Record<string, unknown>;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { error: text || "Legacy API returned a non-JSON response." };
  }
  if (!response.ok) {
    await recordAuditLog("legacy_error", { path, status: response.status, body: sanitizeForPersistence(json) });
  }
  return { status: response.status, json };
}

export function jsonResponse(payload: unknown, status = 200) {
  return Response.json(payload, { status });
}

