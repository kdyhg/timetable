import { assertAdminSession } from "@/lib/auth";
import { listTimetableScenarios, saveTimetableScenario } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  const { denied, session } = await assertAdminSession();
  if (denied) return denied;
  const scenarios = await listTimetableScenarios(session?.tenantId);
  if (!scenarios) return Response.json({ error: "server storage unavailable" }, { status: 503 });
  return Response.json({ ok: true, scenarios });
}

export async function POST(request: Request) {
  const { denied, session } = await assertAdminSession();
  if (denied) return denied;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "저장할 시나리오 데이터가 없습니다." }, { status: 400 });
  const name = String(body.name || "").trim();
  if (!name) return Response.json({ error: "시나리오 이름을 입력하세요." }, { status: 400 });
  const saved = await saveTimetableScenario({
    id: body.id ? String(body.id) : undefined,
    name,
    tenantId: session?.tenantId,
    payload: {
      records: body.records as Record<string, unknown> | null,
      candidate: body.candidate as Record<string, unknown> | null,
      diagnostics: body.diagnostics as Record<string, unknown> | null,
      solveOptions: body.solveOptions as Record<string, unknown> | null,
      constraintText: String(body.constraintText || ""),
      version: Number(body.version || 1),
    },
  });
  if (!saved) return Response.json({ error: "server storage unavailable" }, { status: 503 });
  return Response.json({ ok: true, scenario: saved });
}
