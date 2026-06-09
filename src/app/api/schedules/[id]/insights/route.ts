import { requireAdmin } from "@/lib/auth";
import { proxyLegacyRequest } from "@/lib/legacyProxy";

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;
  return proxyLegacyRequest(request, "/schedules/insights");
}

