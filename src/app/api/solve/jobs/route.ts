import { requireAdmin } from "@/lib/auth";

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json(
    {
      error: "자동배정은 이제 서버 작업 큐가 아니라 브라우저 Web Worker에서 실행됩니다.",
      mode: "browser-worker",
    },
    { status: 410 },
  );
}
