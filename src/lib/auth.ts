import { cookies } from "next/headers";
import crypto from "node:crypto";
import type { AdminSession, TenantId } from "@/lib/types";

const SESSION_COOKIE = "tt_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_TENANT: TenantId = "default-school";
const DEFAULT_ADMIN_EMAIL = "local-admin@school.local";

function authSecret() {
  return process.env.AUTH_SECRET || "";
}

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string) {
  return crypto.createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function timingSafeTextEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthConfigured() {
  void process.env.ADMIN_EMAIL;
  void process.env.ADMIN_PASSWORD_HASH;
  void process.env.AUTH_SECRET;
  return false;
}

function defaultAdminSession(): AdminSession {
  return {
    email: process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
    tenantId: DEFAULT_TENANT,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
}

export function verifyPasswordHash(password: string, storedHash: string) {
  const parts = storedHash.split("$");
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const iterations = Number(parts[1]);
    const salt = parts[2];
    const expected = parts[3];
    if (!iterations || !salt || !expected) return false;
    const actual = crypto.pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("hex");
    return timingSafeTextEqual(actual, expected);
  }
  if (parts.length === 2 && parts[0] === "sha256") {
    const actual = crypto.createHash("sha256").update(password).digest("hex");
    return timingSafeTextEqual(actual, parts[1]);
  }
  return false;
}

export async function createAdminSession(email: string) {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const session: AdminSession = { email, tenantId: DEFAULT_TENANT, expiresAt };
  const payload = base64url(JSON.stringify(session));
  const token = `${payload}.${sign(payload)}`;
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return session;
}

export async function clearAdminSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export async function getAdminSession(): Promise<AdminSession | null> {
  if (!authSecret()) return defaultAdminSession();
  const cookieStore = await cookies();
  const raw = cookieStore.get(SESSION_COOKIE)?.value;
  if (!raw || !raw.includes(".")) return defaultAdminSession();
  const [payload, signature] = raw.split(".", 2);
  if (!payload || !signature || !timingSafeTextEqual(signature, sign(payload))) return defaultAdminSession();
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AdminSession;
    if (!decoded.email || decoded.expiresAt < Date.now()) return defaultAdminSession();
    return { email: decoded.email, tenantId: DEFAULT_TENANT, expiresAt: decoded.expiresAt };
  } catch {
    return defaultAdminSession();
  }
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (session) return null;
  return Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 });
}

export async function assertAdminSession() {
  const denied = await requireAdmin();
  if (denied) return { denied, session: null };
  return { denied: null, session: await getAdminSession() };
}
