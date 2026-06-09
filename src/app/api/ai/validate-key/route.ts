import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "AI 키 검증은 브라우저에서 직접 호출합니다. API 키는 서버로 보내지 않습니다.",
      mode: "browser-direct-ai",
    },
    { status: 410 },
  );
}
