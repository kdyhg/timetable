import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "서버 tick 탐색은 비활성화되었습니다. 자동배정 chunk는 브라우저 Web Worker가 실행합니다.",
      mode: "browser-worker",
    },
    { status: 410 },
  );
}
