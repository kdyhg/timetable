import { assertAdminSession } from "@/lib/auth";
import { deleteTimetableScenario, getTimetableScenario } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, session } = await assertAdminSession();
  if (denied) return denied;
  const { id } = await params;
  const scenario = await getTimetableScenario(id, session?.tenantId);
  if (scenario === null) return Response.json({ error: "server storage unavailable" }, { status: 503 });
  if (scenario === false) return Response.json({ error: "저장된 시간표를 찾을 수 없습니다." }, { status: 404 });
  return Response.json({ ok: true, scenario });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { denied, session } = await assertAdminSession();
  if (denied) return denied;
  const { id } = await params;
  const deleted = await deleteTimetableScenario(id, session?.tenantId);
  if (!deleted) return Response.json({ error: "server storage unavailable" }, { status: 503 });
  return Response.json({ ok: true });
}
