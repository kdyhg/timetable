import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "AI 채팅은 브라우저 직접 호출 방식으로 실행됩니다. API 키는 서버로 보내지 않습니다.",
      mode: "browser-direct-ai",
    },
    { status: 410 },
  );
}
