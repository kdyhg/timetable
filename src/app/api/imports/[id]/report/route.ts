import { requireAdmin } from "@/lib/auth";
import { proxyLegacyRequest } from "@/lib/legacyProxy";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireAdmin();
  if (denied) return denied;
  const { id } = await context.params;
  return proxyLegacyRequest(request, `/imports/${encodeURIComponent(id)}/report.xlsx`);
}

