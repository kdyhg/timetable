import { Buffer } from "node:buffer";
import type { TimetableScenarioPayload } from "@/lib/types";

type NeonQuery = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>;

let sqlClient: NeonQuery | null | undefined;

export async function getSqlClient() {
  if (sqlClient !== undefined) return sqlClient;
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!databaseUrl) {
    sqlClient = null;
    return null;
  }
  const { neon } = await import("@neondatabase/serverless");
  sqlClient = neon(databaseUrl) as NeonQuery;
  return sqlClient;
}

export async function ensureOperationsSchema() {
  const sql = await getSqlClient();
  if (!sql) return false;
  await sql`
    create table if not exists timetable_admins (
      email text primary key,
      tenant_id text not null default 'default-school',
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists timetable_audit_log (
      id bigserial primary key,
      tenant_id text not null default 'default-school',
      event text not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists timetable_scenarios (
      id text primary key,
      tenant_id text not null default 'default-school',
      name text not null,
      schedule_result jsonb not null,
      records jsonb not null default '{}'::jsonb,
      diagnostics jsonb not null default '{}'::jsonb,
      solve_options jsonb not null default '{}'::jsonb,
      constraint_text text not null default '',
      version integer not null default 1,
      created_at timestamptz not null default now()
    )
  `;
  await sql`alter table timetable_scenarios add column if not exists records jsonb not null default '{}'::jsonb`;
  await sql`alter table timetable_scenarios add column if not exists diagnostics jsonb not null default '{}'::jsonb`;
  await sql`alter table timetable_scenarios add column if not exists solve_options jsonb not null default '{}'::jsonb`;
  await sql`alter table timetable_scenarios add column if not exists constraint_text text not null default ''`;
  await sql`alter table timetable_scenarios add column if not exists version integer not null default 1`;
  await sql`alter table timetable_scenarios add column if not exists updated_at timestamptz not null default now()`;
  return true;
}

export async function recordAuditLog(event: string, payload: Record<string, unknown> = {}) {
  try {
    const sql = await getSqlClient();
    if (!sql) return;
    await ensureOperationsSchema();
    await sql`
      insert into timetable_audit_log (tenant_id, event, payload)
      values ('default-school', ${event}, ${JSON.stringify(sanitizeForPersistence(payload))}::jsonb)
    `;
  } catch {
    // Logging must never block timetable work.
  }
}

export function sanitizeForPersistence<T>(input: T): T {
  const blocked = new Set(["apikey", "api_key", "authorization", "x-goog-api-key", "secret", "token", "password"]);
  function walk(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const output: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (blocked.has(key.toLowerCase())) continue;
        output[key] = walk(child);
      }
      return output;
    }
    return value;
  }
  return walk(input) as T;
}

function rowValue<T>(row: unknown, key: string, fallback: T): T {
  if (!row || typeof row !== "object") return fallback;
  const value = (row as Record<string, unknown>)[key];
  return (value === undefined || value === null ? fallback : value) as T;
}

export function scenarioSummaryFromPayload(id: string, name: string, updatedAt: string, createdAt: string, payload: TimetableScenarioPayload) {
  const records = payload.records as Record<string, unknown> | null | undefined;
  const candidate = payload.candidate as Record<string, unknown> | null | undefined;
  const stats = records?.stats as Record<string, unknown> | undefined;
  const summary = candidate?.summary as Record<string, unknown> | undefined;
  return {
    id,
    name,
    updatedAt,
    createdAt,
    teacherCount: Number(stats?.teacherCount || 0),
    classCount: Number(stats?.classCount || 0),
    unassigned: Number(summary?.unassigned || 0),
    hardErrors: Number(summary?.hardErrors || 0),
  };
}

export async function listTimetableScenarios(tenantId = "default-school") {
  const sql = await getSqlClient();
  if (!sql) return null;
  await ensureOperationsSchema();
  const rows = await sql`
    select id, name, schedule_result, records, created_at, updated_at
    from timetable_scenarios
    where tenant_id = ${tenantId}
    order by updated_at desc
  `;
  return rows.map((row) => scenarioSummaryFromPayload(
    rowValue(row, "id", ""),
    rowValue(row, "name", ""),
    rowValue(row, "updated_at", ""),
    rowValue(row, "created_at", ""),
    {
      records: rowValue(row, "records", {}) as Record<string, unknown>,
      candidate: rowValue(row, "schedule_result", {}) as Record<string, unknown>,
    },
  ));
}

export async function getTimetableScenario(id: string, tenantId = "default-school") {
  const sql = await getSqlClient();
  if (!sql) return null;
  await ensureOperationsSchema();
  const rows = await sql`
    select id, name, schedule_result, records, diagnostics, solve_options, constraint_text, version, created_at, updated_at
    from timetable_scenarios
    where id = ${id} and tenant_id = ${tenantId}
    limit 1
  `;
  const row = rows[0];
  if (!row) return false;
  return {
    id: rowValue(row, "id", id),
    name: rowValue(row, "name", ""),
    records: rowValue(row, "records", {}),
    candidate: rowValue(row, "schedule_result", {}),
    diagnostics: rowValue(row, "diagnostics", {}),
    solveOptions: rowValue(row, "solve_options", {}),
    constraintText: rowValue(row, "constraint_text", ""),
    version: Number(rowValue(row, "version", 1)),
    createdAt: rowValue(row, "created_at", ""),
    updatedAt: rowValue(row, "updated_at", ""),
  };
}

export async function saveTimetableScenario(input: { id?: string; name: string; tenantId?: string; payload: TimetableScenarioPayload }) {
  const sql = await getSqlClient();
  if (!sql) return null;
  await ensureOperationsSchema();
  const id = input.id || `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const tenantId = input.tenantId || "default-school";
  const safe = sanitizeForPersistence(input.payload);
  await sql`
    insert into timetable_scenarios (id, tenant_id, name, schedule_result, records, diagnostics, solve_options, constraint_text, version, updated_at)
    values (
      ${id},
      ${tenantId},
      ${input.name},
      ${JSON.stringify(safe.candidate || {})}::jsonb,
      ${JSON.stringify(safe.records || {})}::jsonb,
      ${JSON.stringify(safe.diagnostics || {})}::jsonb,
      ${JSON.stringify(safe.solveOptions || {})}::jsonb,
      ${safe.constraintText || ""},
      ${safe.version || 1},
      now()
    )
    on conflict (id) do update set
      name = excluded.name,
      schedule_result = excluded.schedule_result,
      records = excluded.records,
      diagnostics = excluded.diagnostics,
      solve_options = excluded.solve_options,
      constraint_text = excluded.constraint_text,
      version = excluded.version,
      updated_at = now()
  `;
  await recordAuditLog("scenario.save", { id, name: input.name });
  const saved = await getTimetableScenario(id, tenantId);
  return saved || { id, name: input.name, ...safe };
}

export async function deleteTimetableScenario(id: string, tenantId = "default-school") {
  const sql = await getSqlClient();
  if (!sql) return null;
  await ensureOperationsSchema();
  await sql`
    delete from timetable_scenarios
    where id = ${id} and tenant_id = ${tenantId}
  `;
  await recordAuditLog("scenario.delete", { id });
  return true;
}

export async function putPrivateBlob(path: string, body: Blob | ArrayBuffer | Uint8Array | Buffer | string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const { put } = await import("@vercel/blob");
  const payload = body instanceof Uint8Array && !Buffer.isBuffer(body) ? Buffer.from(body) : body;
  return put(path, payload, { access: "private" });
}
