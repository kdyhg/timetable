import { createAdminSession, isAuthConfigured, verifyPasswordHash } from "@/lib/auth";
import { recordAuditLog } from "@/lib/storage";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const expectsHtml = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const redirectTo = (path: string) => Response.redirect(new URL(path, request.url), 303);

  if (!isAuthConfigured()) {
    if (expectsHtml) return redirectTo("/?loginError=setup");
    return Response.json(
      { error: "ADMIN_EMAIL, ADMIN_PASSWORD_HASH, AUTH_SECRET 환경변수를 먼저 설정하세요." },
      { status: 503 },
    );
  }
  const body = expectsHtml
    ? Object.fromEntries((await request.formData()).entries())
    : await request.json().catch(() => ({}));
  const email = String(body.email || "").trim();
  const password = String(body.password || "");
  const expectedEmail = process.env.ADMIN_EMAIL || "";
  const expectedHash = process.env.ADMIN_PASSWORD_HASH || "";

  if (email !== expectedEmail || !verifyPasswordHash(password, expectedHash)) {
    await recordAuditLog("admin_login_failed", { email });
    if (expectsHtml) return redirectTo("/?loginError=invalid");
    return Response.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const session = await createAdminSession(email);
  await recordAuditLog("admin_login", { email, tenantId: session.tenantId });
  if (expectsHtml) return redirectTo("/");
  return Response.json({ ok: true, session });
}
