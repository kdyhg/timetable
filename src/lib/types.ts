export type TenantId = "default-school";

export type AdminSession = {
  email: string;
  tenantId: TenantId;
  expiresAt: number;
};

export type AiProvider = "openai" | "gemini" | "custom";

export type AiConfig = {
  provider: AiProvider;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  validated?: boolean;
};

export type TimetableScenarioPayload = {
  records?: Record<string, unknown> | null;
  candidate?: Record<string, unknown> | null;
  diagnostics?: Record<string, unknown> | null;
  solveOptions?: Record<string, unknown> | null;
  constraintText?: string;
  version?: number;
};

export type TimetableScenarioSummary = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt?: string;
  teacherCount?: number;
  classCount?: number;
  unassigned?: number;
  hardErrors?: number;
};

export type SolveJobStatus = "running" | "failed" | "accepted" | "cancelled";

export type SolveJob = {
  id: string;
  tenantId: TenantId;
  status: SolveJobStatus;
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  importId?: string;
  payload: Record<string, unknown>;
  progress: Record<string, unknown>;
  best?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
};

export type LegacyJson = Record<string, unknown>;
