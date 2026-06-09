import { clearAdminSession } from "@/lib/auth";
import { recordAuditLog } from "@/lib/storage";

export async function POST() {
  await clearAdminSession();
  await recordAuditLog("admin_logout");
  return Response.json({ ok: true });
}

