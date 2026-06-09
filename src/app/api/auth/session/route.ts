import { getAdminSession, isAuthConfigured } from "@/lib/auth";

export async function GET() {
  return Response.json({ configured: isAuthConfigured(), session: await getAdminSession() });
}

