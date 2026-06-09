import { requireAdmin } from "@/lib/auth";

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "서버 자동배정 job 조회는 비활성화되었습니다. 브라우저 Worker 진행 상태를 사용하세요.",
      mode: "browser-worker",
    },
    { status: 410 },
  );
}
