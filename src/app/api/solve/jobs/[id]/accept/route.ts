import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "서버 accept는 비활성화되었습니다. 현재 최선안 반영은 브라우저 Worker 메시지로 처리됩니다.",
      mode: "browser-worker",
    },
    { status: 410 },
  );
}
