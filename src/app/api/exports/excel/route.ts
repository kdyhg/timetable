import { requireAdmin } from "@/lib/auth";
import { proxyLegacyRequest } from "@/lib/legacyProxy";

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  return proxyLegacyRequest(request, "/exports/excel");
}

