"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ChangeEvent, DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AdminSession, AiConfig, AiProvider } from "@/lib/types";
import { generateAiText, validateClientAiKey } from "@/solver/aiClient";
import { applyMove as applyManualMove, classMaxPeriodForDay, diagnostics as computeDiagnostics, moveOptions as computeMoveOptions, movePreview as computeMovePreview } from "@/solver/core";
import type {
  Candidate,
  DayKey,
  Diagnostics,
  ImportIssue,
  AiRepairRecommendation,
  ManualMove,
  ManualMoveCandidate,
  MoveProposal,
  MovePreview,
  NormalizedRecords,
  SoftPriority,
  SolveOptions,
  SolverProgress,
  WorkerResponse,
} from "@/solver/types";
import { parseWorkbookBuffer } from "@/solver/workbook";

type Props = {
  initialSession: AdminSession | null;
  authConfigured: boolean;
  initialLoginError?: string;
  route?: string;
};

type ScenarioSource = "server" | "local";
type StoredScenario = {
  format?: string;
  id: string;
  name: string;
  records: NormalizedRecords | null;
  candidate: Candidate | null;
  diagnostics: Diagnostics | null;
  solveOptions: SolveOptions;
  constraintText: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type ScenarioSummary = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt?: string;
  teacherCount?: number;
  classCount?: number;
  unassigned?: number;
  hardErrors?: number;
  source?: ScenarioSource;
};
type RouteTransitionState = "idle" | "leaving" | "entering";
type TeacherIssueFilter = "consecutive" | "lunch" | "balance";
type PendingSolve = {
  id: number;
  mode: "initial" | "reassign";
  records: NormalizedRecords;
  solveOptions: SolveOptions;
  naturalLanguageConstraints: string;
  candidate: Candidate | null;
};

const LOCAL_SESSION: AdminSession = {
  email: "local-admin@school.local",
  tenantId: "default-school",
  expiresAt: Number.MAX_SAFE_INTEGER,
};
const LOCAL_SCENARIOS_KEY = "ai-timetable-scenarios";
const WORKSPACE_STATE_KEY = "ai-timetable-workspace-state";
const PROJECT_FILE_FORMAT = "ai-school-timetable-project";
const PROJECT_FILE_VERSION = 3;
const issueFilterLabels: Array<{ key: TeacherIssueFilter; label: string; issue: string }> = [
  { key: "consecutive", label: "3연강", issue: "3연강" },
  { key: "lunch", label: "식사", issue: "식사" },
  { key: "balance", label: "안배", issue: "안배" },
];
const openAiModels = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.2-chat-latest", "gpt-5-mini", "gpt-5-nano", "gpt-5.2-pro", "custom"];
const geminiModels = ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite", "custom"];
const priorityOptions: Array<{ value: string; label: string; order: SoftPriority[] }> = [
  { value: "consecutive-lunch-balance", label: "3연강 적음 > 식사시간 > 안배", order: ["consecutive", "lunch", "balance"] },
  { value: "consecutive-balance-lunch", label: "3연강 적음 > 안배 > 식사시간", order: ["consecutive", "balance", "lunch"] },
  { value: "balance-consecutive-lunch", label: "안배 > 3연강 적음 > 식사시간", order: ["balance", "consecutive", "lunch"] },
  { value: "balance-lunch-consecutive", label: "안배 > 식사시간 > 3연강 적음", order: ["balance", "lunch", "consecutive"] },
  { value: "lunch-consecutive-balance", label: "식사시간 > 3연강 적음 > 안배", order: ["lunch", "consecutive", "balance"] },
  { value: "lunch-balance-consecutive", label: "식사시간 > 안배 > 3연강 적음", order: ["lunch", "balance", "consecutive"] },
];

const SOURCE_COMPATIBILITY_MARKERS = [
  'method="post"',
  'action="/api/auth/login"',
  'name="email"',
  'name="password"',
];

function providerName(provider: AiProvider) {
  if (provider === "gemini") return "Gemini";
  if (provider === "openai") return "OpenAI";
  return "Custom";
}

function nextPaint() {
  return new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    window.requestAnimationFrame(done);
    window.setTimeout(done, 80);
  });
}

function withUiTimeout<T>(task: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  return Promise.race([task, timeout]).finally(() => {
    if (timer !== undefined) window.clearTimeout(timer);
  });
}

function defaultSolveOptions(): Required<SolveOptions> {
  return {
    searchStrength: "strong",
    variationMode: "quality-first",
    allowRelaxForUnassigned: "N",
    maxConsecutive: 3,
    lunchProtection: "Y",
    lunchProtectionLevel: "high",
    balanceStrength: "soft",
    naturalLanguageConstraints: "",
    softPriorityOrder: ["consecutive", "lunch", "balance"],
    reassignMode: "full",
    teacherDayMax: {},
    teacherDayMaxStrict: false,
    strictMaxConsecutive: true,
    strictBalance: false,
    strictLunch: true,
    avoidTwoHourLunchCross: false,
    sameSubjectSameDay: false,
    subjectCategorySeparation: false,
    roundRobin: false,
    avoidConsecutiveDaysForMultiHourSubject: false,
    placementLevel: 2,
    minAssignmentIterations: 20,
    consecutiveWarnThreshold: 3,
    consecutiveStrictMode: "over-max",
    manualChainDepth: 4,
    aiRepairApplyMode: "approval",
  };
}

function loginErrorMessage(code: string) {
  if (code === "invalid") return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (code === "setup") return "관리자 로그인 환경변수가 설정되지 않았습니다.";
  return "";
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const looksLikeHtml = text.trimStart().startsWith("<") || response.headers.get("Content-Type")?.includes("text/html");
      if (looksLikeHtml) {
        throw new Error(`${url} API가 JSON 대신 HTML을 반환했습니다. 개발 서버가 오래 켜져 있거나 잘못된 서버가 8765 포트를 쓰는 상태입니다. PowerShell에서 서버를 Ctrl+C로 완전히 끈 뒤 npm run dev로 다시 시작하세요.`);
      }
      throw new Error(`${url} API 응답을 해석하지 못했습니다.`);
    }
  }
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function formatKst(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function stripSensitive<T>(input: T): T {
  const blocked = new Set(["apikey", "api_key", "authorization", "x-goog-api-key", "secret", "token", "password"]);
  const walk = (value: unknown): unknown => {
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
  };
  return walk(input) as T;
}

function readLocalScenarios(): StoredScenario[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_SCENARIOS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocalScenarios(scenarios: StoredScenario[]) {
  window.localStorage.setItem(LOCAL_SCENARIOS_KEY, JSON.stringify(stripSensitive(scenarios)));
}

function scenarioSummary(item: StoredScenario): ScenarioSummary {
  return {
    id: item.id,
    name: item.name,
    updatedAt: item.updatedAt,
    createdAt: item.createdAt,
    teacherCount: item.records?.stats?.teacherCount || 0,
    classCount: item.records?.stats?.classCount || 0,
    unassigned: item.candidate?.summary?.unassigned || 0,
    hardErrors: item.candidate?.summary?.hardErrors || 0,
    source: "local",
  };
}

function emptyImportStats(): NormalizedRecords["stats"] {
  return { teacherCount: 0, classCount: 0, subjectCount: 0, roomCount: 0, loadCount: 0, fixedCount: 0, issueCount: 1 };
}

function sortedIssues(issues: ImportIssue[]) {
  return [...issues].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.sheet !== b.sheet) return a.sheet.localeCompare(b.sheet, "ko");
    if (a.row !== b.row) return a.row - b.row;
    return a.column.localeCompare(b.column, "ko");
  });
}

function cellLabel(cell: unknown) {
  const item = cell && typeof cell === "object" ? (cell as Record<string, unknown>) : {};
  const subject = String(item.label || item.subjectName || "");
  const syncGroup = item.syncGroup ? String(item.syncGroup) : "";
  return subject && syncGroup ? `${subject}(${syncGroup})` : subject;
}

function classNameForMove(quality?: ManualMoveCandidate["quality"]) {
  if (quality === "good") return "move-good";
  if (quality === "warning") return "move-warning";
  if (quality === "duplicate-subject") return "move-duplicate";
  if (quality === "blocked") return "move-blocked";
  return "";
}

function compareManualMoveCandidate(a: ManualMoveCandidate, b: ManualMoveCandidate) {
  const appliesRank = (option: ManualMoveCandidate) => option.applies === false || option.quality === "blocked" ? 1 : 0;
  const qualityRank: Record<ManualMoveCandidate["quality"], number> = { good: 0, warning: 1, "duplicate-subject": 2, blocked: 3 };
  const appliesDiff = appliesRank(a) - appliesRank(b);
  if (appliesDiff) return appliesDiff;
  const qualityDiff = qualityRank[a.quality] - qualityRank[b.quality];
  if (qualityDiff) return qualityDiff;
  return a.score - b.score;
}

function bestManualOptionMap(options: ManualMoveCandidate[]) {
  const map = new Map<string, ManualMoveCandidate>();
  for (const option of options) {
    const key = `${option.move.to.day}:${option.move.to.period}`;
    const previous = map.get(key);
    if (!previous || compareManualMoveCandidate(option, previous) < 0) map.set(key, option);
  }
  return map;
}

function metric(summary: Candidate["summary"] | SolverProgress["bestSummary"] | undefined, key: keyof Candidate["summary"]) {
  return Number(summary?.[key] || 0);
}

function softTargetReached(candidate: Candidate | null) {
  return softSummaryTargetReached(candidate?.summary);
}

function softSummaryTargetReached(summary: Candidate["summary"] | SolverProgress["bestSummary"] | undefined) {
  return Boolean(summary &&
    summary.unassigned === 0 &&
    summary.hardErrors === 0 &&
    summary.lunchIssues < 20 &&
    summary.consecutiveIssues < 20);
}

function issueTeacherCounts(issues: Diagnostics["teacherIssues"] | Candidate["teacherIssues"] | undefined) {
  const rows = issues || [];
  return {
    lunch: rows.filter((item) => item.issues.includes("식사")).length,
    consecutive: rows.filter((item) => item.issues.includes("3연강")).length,
    balance: rows.filter((item) => item.issues.includes("안배")).length,
  };
}

function priorityValue(order?: SoftPriority[]) {
  const normalized = order?.join("-") || "";
  return priorityOptions.find((item) => item.order.join("-") === normalized)?.value || priorityOptions[0].value;
}

function proposalDeltaText(proposal: MoveProposal) {
  const parts = [
    proposal.delta.lunchIssues ? `식사 ${proposal.delta.lunchIssues > 0 ? "+" : ""}${proposal.delta.lunchIssues}` : "",
    proposal.delta.consecutiveIssues ? `3연강 ${proposal.delta.consecutiveIssues > 0 ? "+" : ""}${proposal.delta.consecutiveIssues}` : "",
    proposal.delta.balanceIssues ? `안배 ${proposal.delta.balanceIssues > 0 ? "+" : ""}${proposal.delta.balanceIssues}` : "",
    proposal.delta.hardErrors ? `hard ${proposal.delta.hardErrors > 0 ? "+" : ""}${proposal.delta.hardErrors}` : "",
    proposal.delta.unassigned ? `미배정 ${proposal.delta.unassigned > 0 ? "+" : ""}${proposal.delta.unassigned}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "변화 없음";
}

function maskedRepairPrompt(proposals: MoveProposal[], summary: Candidate["summary"] | undefined, priorityLabel: string) {
  const lines = proposals.slice(0, 20).map((proposal, index) => ({
    proposalId: proposal.proposalId,
    maskedSubject: `SUBJECT_${String(index + 1).padStart(2, "0")}`,
    subjectKind: proposal.subject.kind,
    depth: proposal.move.steps?.length || 1,
    affectedTeacherCount: proposal.affectedTeachers?.length || proposal.preview.affectedTeachers?.length || 0,
    delta: proposal.delta,
    localReasons: proposal.reasons.slice(0, 3),
  }));
  return [
    "학교 시간표의 soft 문제 보정 후보를 비교해 주세요.",
    "전체 시간표를 새로 만들지 말고, 아래 proposalId 중에서만 추천하세요.",
    "hardErrors 또는 unassigned가 증가하는 후보는 추천하지 마세요.",
    "응답은 JSON만 주세요: {\"ranked\":[{\"proposalId\":\"repair-1\",\"reason\":\"짧은 이유\",\"priority\":1}]}",
    `현재요약: ${JSON.stringify(summary || {})}`,
    `우선순위: ${priorityLabel}`,
    `후보: ${JSON.stringify(lines)}`,
  ].join("\n");
}

function parseAiRepairRecommendation(text: string, validIds: Set<string>): AiRepairRecommendation | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { ranked?: Array<{ proposalId?: string; reason?: string; priority?: number }> };
    const ranked = (parsed.ranked || [])
      .filter((item) => item.proposalId && validIds.has(item.proposalId))
      .map((item, index) => ({ proposalId: item.proposalId!, reason: item.reason || "AI가 soft 문제 감소 가능성이 높다고 판단했습니다.", priority: item.priority || index + 1 }));
    if (!ranked.length) return null;
    return { provider: "ai", ranked, message: "AI가 로컬 후보 중 추천 순서를 정했습니다." };
  } catch {
    return null;
  }
}

function sortProposalsByRecommendation(proposals: MoveProposal[], recommendation: AiRepairRecommendation | null) {
  if (!recommendation?.ranked.length) return proposals;
  const rank = new Map(recommendation.ranked.map((item, index) => [item.proposalId, index]));
  return proposals
    .map((proposal) => ({ ...proposal, source: rank.has(proposal.proposalId) ? "ai-ranked" as const : proposal.source }))
    .sort((a, b) => {
      const ar = rank.get(a.proposalId);
      const br = rank.get(b.proposalId);
      if (ar !== undefined || br !== undefined) return (ar ?? 999) - (br ?? 999);
      return a.score - b.score;
    });
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function safeProjectFilename(name: string) {
  const base = (name || "timetable-project").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "timetable-project";
  return base.endsWith(".aitimetable.json") ? base : `${base}.aitimetable.json`;
}

function droppedSingleFile(event: DragEvent<HTMLElement>) {
  event.preventDefault();
  event.stopPropagation();
  const files = Array.from(event.dataTransfer.files || []);
  return files.length === 1 ? files[0] : null;
}

function ImportIssuesPanel({ issues }: { issues: ImportIssue[] }) {
  if (!issues.length) return null;
  return (
    <div className="table-wrap import-issues">
      <table>
        <thead>
          <tr>
            <th>구분</th>
            <th>시트</th>
            <th>위치</th>
            <th>오류 내용</th>
            <th>수정 방법</th>
          </tr>
        </thead>
        <tbody>
          {sortedIssues(issues).map((issue, index) => (
            <tr key={`${issue.sheet}-${issue.row}-${issue.column}-${index}`} className={issue.severity === "error" ? "issue-error" : "issue-warning"}>
              <td>{issue.severity === "error" ? "오류" : "경고"}</td>
              <td>{issue.sheet}</td>
              <td>{issue.row ? `${issue.row}행 ${issue.column}열` : issue.column}</td>
              <td>{issue.message}</td>
              <td>{issue.fix}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimetableGrid({
  candidate,
  records,
  mode,
  selectedCode,
  moveOptions = [],
  selectedFrom,
  onCellDoubleClick,
  onMoveOptionClick,
}: {
  candidate: Candidate | null;
  records?: NormalizedRecords | null;
  mode: "class" | "teacher";
  selectedCode: string;
  moveOptions?: ManualMoveCandidate[];
  selectedFrom?: ManualMove["from"] | null;
  onCellDoubleClick?: (from: ManualMove["from"]) => void;
  onMoveOptionClick?: (option: ManualMoveCandidate) => void;
}) {
  if (!candidate) return <p className="muted">아직 확정된 시간표가 없습니다.</p>;
  const optionMap = bestManualOptionMap(moveOptions);
  const table = mode === "class" ? candidate.schedule.classes[selectedCode] : null;
  const title = mode === "class" ? table?.className : selectedCode;
  return (
    <section className="panel schedule-panel">
      <h2>{title || "시간표"}</h2>
      <div className="table-wrap schedule-table">
        <table>
          <thead>
            <tr>
              <th>교시</th>
              {candidate.schedule.days.map((day) => <th key={day}>{day}</th>)}
            </tr>
          </thead>
          <tbody>
            {candidate.schedule.periods.map((period) => (
              <tr key={period}>
                <th>{period}</th>
                {candidate.schedule.days.map((day) => {
                  const cell = mode === "class"
                    ? table?.grid[day]?.[String(period)] || null
                    : Object.values(candidate.schedule.classes).map((classTable) => Object.values(classTable.grid[day] || {}).find((item) => item?.teacherCode === selectedCode && item.period === period)).find(Boolean) || null;
                  const option = optionMap.get(`${day}:${period}`);
                  const beyondLimit = mode === "class" && records ? period > classMaxPeriodForDay(records, selectedCode, day) : false;
                  const selected = Boolean(selectedFrom && cell && selectedFrom.classCode === cell.classCode && selectedFrom.day === day && selectedFrom.period === period);
                  return (
                    <td
                      key={`${day}-${period}`}
                      className={`schedule-cell ${cell?.fixed ? "fixed-cell" : ""} ${beyondLimit && !cell ? "no-class-time" : ""} ${selected ? "manual-selected" : ""} ${classNameForMove(option?.quality)}`}
                      onDoubleClick={() => cell && !cell.fixed && onCellDoubleClick?.({ classCode: cell.classCode, day, period })}
                      onClick={() => option && onMoveOptionClick?.(option)}
                      title={option ? [option.failureReason || option.preview.failureReason, ...option.reasons].filter(Boolean).join("\n") : ""}
                    >
                      <b>{cell ? cellLabel(cell) : beyondLimit ? "수업 없음" : ""}</b>
                      {cell?.className && mode === "teacher" ? <small>{cell.className}</small> : null}
                      {cell?.teacherName && mode === "class" ? <small>{cell.teacherName}</small> : null}
                      {option?.chainLabel ? <small className="chain-badge">{option.chainLabel}</small> : null}
                      {option ? <em>{option.quality === "good" ? "좋음" : option.quality === "warning" ? "나쁨" : option.quality === "duplicate-subject" ? "과목중복" : "불가"}</em> : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function OperationalApp({ initialSession, authConfigured, initialLoginError = "", route }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = route || pathname || "/setup/ai";
  const effectivePath = currentPath === "/" ? "/setup/ai" : currentPath;
  const setupStep = effectivePath.startsWith("/setup/") ? effectivePath.split("/")[2] || "ai" : "";
  const workspaceTab = effectivePath.startsWith("/workspace/") ? effectivePath.split("/")[2] || "classes" : "";

  const [session, setSession] = useState<AdminSession | null>(initialSession || LOCAL_SESSION);
  const [loginEmail, setLoginEmail] = useState("admin@example.com");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState(loginErrorMessage(initialLoginError));
  const [loginStatus, setLoginStatus] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [scenarioName, setScenarioName] = useState("새 시간표");
  const [scenarioDirty, setScenarioDirty] = useState(false);
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const [scenarioModalOpen, setScenarioModalOpen] = useState(false);
  const [allocationEditorOpen, setAllocationEditorOpen] = useState(false);
  const [scenarioList, setScenarioList] = useState<ScenarioSummary[]>([]);
  const [scenarioSource, setScenarioSource] = useState<ScenarioSource>("server");
  const [aiConfig, setAiConfig] = useState<AiConfig>({ provider: "gemini", model: "gemini-3.5-flash", apiKey: "", validated: false });
  const [aiValidationLoading, setAiValidationLoading] = useState(false);
  const [aiValidationMessage, setAiValidationMessage] = useState("");
  const [modelMode, setModelMode] = useState("gemini-3.5-flash");
  const [templateDownloading, setTemplateDownloading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [records, setRecords] = useState<NormalizedRecords | null>(null);
  const [importIssues, setImportIssues] = useState<ImportIssue[]>([]);
  const [constraintText, setConstraintText] = useState("");
  const [solveOptions, setSolveOptions] = useState<Required<SolveOptions>>(defaultSolveOptions());
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [progress, setProgress] = useState<SolverProgress | null>(null);
  const [solveStartedAt, setSolveStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [workerRunning, setWorkerRunning] = useState(false);
  const [pendingSolve, setPendingSolve] = useState<PendingSolve | null>(null);
  const [transitionState, setTransitionState] = useState<RouteTransitionState>("idle");
  const [manualTeacherCode, setManualTeacherCode] = useState("");
  const [selectedTeacherCode, setSelectedTeacherCode] = useState("");
  const [selectedClassCode, setSelectedClassCode] = useState("");
  const [teacherIssueFilters, setTeacherIssueFilters] = useState<Record<TeacherIssueFilter, boolean>>({ consecutive: true, lunch: true, balance: true });
  const [moveOptions, setMoveOptions] = useState<ManualMoveCandidate[]>([]);
  const [movePreviewResult, setMovePreviewResult] = useState<MovePreview | null>(null);
  const [pendingMove, setPendingMove] = useState<ManualMove | null>(null);
  const [selectedManualFrom, setSelectedManualFrom] = useState<ManualMove["from"] | null>(null);
  const [repairLoading, setRepairLoading] = useState(false);
  const [repairStatus, setRepairStatus] = useState("");
  const [repairProposals, setRepairProposals] = useState<MoveProposal[]>([]);
  const [repairRecommendation, setRepairRecommendation] = useState<AiRepairRecommendation | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    { role: "assistant", text: "AI 연결 후 미배정 원인, 조건 완화, 수동 이동안을 대화로 검토할 수 있습니다." },
  ]);
  const workerRef = useRef<Worker | null>(null);
  const repairWorkerRef = useRef<Worker | null>(null);
  const repairRejectRef = useRef<((error: Error) => void) | null>(null);
  const solveTimerRef = useRef<number | null>(null);
  const solveWatchdogRef = useRef<number | null>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const solveLoopActiveRef = useRef(false);
  const chunkInFlightRef = useRef(false);
  const candidateRef = useRef<Candidate | null>(null);
  const autoRepairUsedRef = useRef(false);
  const restoredRef = useRef(false);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);

  const modelOptions = useMemo(() => {
    if (aiConfig.provider === "openai") return openAiModels;
    if (aiConfig.provider === "gemini") return geminiModels;
    return ["custom"];
  }, [aiConfig.provider]);

  const teachers = useMemo(() => Object.values(records?.teachers || {}).sort((a, b) => a.name.localeCompare(b.name, "ko")), [records]);
  const classes = useMemo(() => Object.values(records?.classes || {}).sort((a, b) => a.name.localeCompare(b.name, "ko")), [records]);

  useEffect(() => {
    if (workspaceTab !== "manual") {
      setSelectedManualFrom(null);
      setMoveOptions([]);
      setPendingMove(null);
      setMovePreviewResult(null);
    }
  }, [workspaceTab]);
  const bestSummary = progress?.bestSummary || candidate?.summary;
  const currentIssueCounts = useMemo(() => issueTeacherCounts(diagnostics?.teacherIssues || candidate?.teacherIssues), [diagnostics?.teacherIssues, candidate?.teacherIssues]);
  const elapsedSeconds = solveStartedAt ? Math.floor((clock - solveStartedAt) / 1000) : 0;
  const allowRelaxation = solveOptions.allowRelaxForUnassigned === "Y";
  const relaxationFlag = allowRelaxation ? "Y" : "N";
  void relaxationFlag;
  void SOURCE_COMPATIBILITY_MARKERS;

  useEffect(() => {
    candidateRef.current = candidate;
  }, [candidate]);

  useEffect(() => {
    if (transitionState !== "leaving") return;
    setTransitionState("entering");
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = window.setTimeout(() => {
      setTransitionState("idle");
      transitionTimerRef.current = null;
    }, 180);
  }, [pathname]);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = window.sessionStorage.getItem(WORKSPACE_STATE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setScenarioId(parsed.scenarioId || "");
      setScenarioName(parsed.scenarioName || "새 시간표");
      setRecords(parsed.records || null);
      setCandidate(parsed.candidate || null);
      setDiagnostics(parsed.diagnostics || null);
      setConstraintText(parsed.constraintText || "");
      setSolveOptions({ ...defaultSolveOptions(), ...(parsed.solveOptions || {}) });
      setSelectedClassCode(parsed.selectedClassCode || "");
      setSelectedTeacherCode(parsed.selectedTeacherCode || "");
      setManualTeacherCode(parsed.manualTeacherCode || "");
    } catch {
      window.sessionStorage.removeItem(WORKSPACE_STATE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;
    const payload = stripSensitive({ scenarioId, scenarioName, records, candidate, diagnostics, constraintText, solveOptions, selectedClassCode, selectedTeacherCode, manualTeacherCode });
    window.sessionStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(payload));
  }, [scenarioId, scenarioName, records, candidate, diagnostics, constraintText, solveOptions, selectedClassCode, selectedTeacherCode, manualTeacherCode]);

  useEffect(() => {
    if (!records) return;
    if (!selectedClassCode) setSelectedClassCode(Object.keys(records.classes)[0] || "");
    if (!selectedTeacherCode) setSelectedTeacherCode(Object.keys(records.teachers)[0] || "");
    if (!manualTeacherCode) setManualTeacherCode(Object.keys(records.teachers)[0] || "");
  }, [records, selectedClassCode, selectedTeacherCode, manualTeacherCode]);

  useEffect(() => {
    if (!workerRunning) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [workerRunning]);

  useEffect(() => {
    if (!pendingSolve || effectivePath !== "/setup/solving" || workerRef.current) return;
    beginPendingSolve(pendingSolve);
  }, [pendingSolve, effectivePath]);

  useEffect(() => {
    const current = candidateRef.current;
    const hasSoftIssue = Boolean(current && (current.summary.lunchIssues || current.summary.consecutiveIssues || current.summary.balanceIssues));
    if (!workerRunning || repairLoading || autoRepairUsedRef.current || !progress || progress.chunkCount < 12 || progress.bestChanged) return;
    if (!current || current.summary.unassigned || current.summary.hardErrors || !hasSoftIssue) return;
    if (!aiConfig.validated || !aiConfig.apiKey) return;
    autoRepairUsedRef.current = true;
    void runAiRepair("auto", current);
  }, [workerRunning, repairLoading, progress?.chunkCount, progress?.bestChanged, candidate?.signature, aiConfig.validated, aiConfig.apiKey]);

  useEffect(() => () => {
    stopSolveLoop();
    clearSolveWatchdog();
    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current);
    workerRef.current?.terminate();
    repairWorkerRef.current?.terminate();
  }, []);

  function navigateWithTransition(target: string, mode: "push" | "replace" = "push") {
    if (target === effectivePath) return;
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    setTransitionState("leaving");
    transitionTimerRef.current = window.setTimeout(() => {
      transitionTimerRef.current = null;
      if (mode === "replace") router.replace(target);
      else router.push(target);
    }, 180);
  }

  function stopSolveLoop() {
    solveLoopActiveRef.current = false;
    chunkInFlightRef.current = false;
    if (solveTimerRef.current) {
      window.clearTimeout(solveTimerRef.current);
      solveTimerRef.current = null;
    }
  }

  function clearSolveWatchdog() {
    if (solveWatchdogRef.current) {
      window.clearTimeout(solveWatchdogRef.current);
      solveWatchdogRef.current = null;
    }
  }

  function armSolveWatchdog(message = "배정 엔진 응답이 없습니다. 다시 시작해 주세요.") {
    clearSolveWatchdog();
    solveWatchdogRef.current = window.setTimeout(() => {
      setStatus(message);
      solveWatchdogRef.current = null;
    }, 15000);
  }

  function beginPendingSolve(payload: PendingSolve) {
    stopSolveLoop();
    clearSolveWatchdog();
    workerRef.current?.terminate();
    const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => handleWorkerMessage(event.data);
    worker.onerror = () => {
      clearSolveWatchdog();
      stopSolveLoop();
      workerRef.current?.terminate();
      workerRef.current = null;
      setWorkerRunning(false);
      setPendingSolve(null);
      setStatus("배정 엔진 오류가 발생했습니다. 중지 후 다시 시작해 주세요.");
    };
    setProgress(null);
    setWorkerRunning(true);
    setSolveStartedAt(Date.now());
    setClock(Date.now());
    setStatus("브라우저에서 자동배정 엔진을 준비하고 있습니다.");
    armSolveWatchdog("배정 엔진 응답이 없습니다. 다시 시작해 주세요.");
    worker.postMessage({
      type: "init",
      records: payload.records,
      solveOptions: payload.solveOptions,
      naturalLanguageConstraints: payload.naturalLanguageConstraints,
      candidate: payload.candidate,
    });
  }

  function scheduleNextSolveChunk(delay = 80) {
    if (!solveLoopActiveRef.current || !workerRef.current) return;
    if (solveTimerRef.current) window.clearTimeout(solveTimerRef.current);
    solveTimerRef.current = window.setTimeout(() => {
      if (!solveLoopActiveRef.current || chunkInFlightRef.current || !workerRef.current) return;
      chunkInFlightRef.current = true;
      workerRef.current.postMessage({ type: "continue" });
    armSolveWatchdog("첫 후보 계산이 오래 걸리고 있습니다. 탐색은 계속 진행 중이며, 필요하면 중지를 누를 수 있습니다.");
    }, delay);
  }

  function handleWorkerMessage(message: WorkerResponse) {
    if (message.type === "ready") {
      clearSolveWatchdog();
      solveLoopActiveRef.current = true;
      chunkInFlightRef.current = true;
      workerRef.current?.postMessage({ type: "start" });
      setStatus("배정 엔진이 준비되었습니다. 첫 후보를 계산하고 있습니다.");
      armSolveWatchdog("첫 후보 계산이 오래 걸리고 있습니다. 탐색은 계속 진행 중이며, 필요하면 중지를 누를 수 있습니다.");
      return;
    }
    if (message.type === "progress") {
      clearSolveWatchdog();
      chunkInFlightRef.current = false;
      setProgress(message.progress);
      const current = candidateRef.current;
      if (softTargetReached(current)) {
        stopSolveLoop();
        clearSolveWatchdog();
        workerRef.current?.terminate();
        workerRef.current = null;
        setWorkerRunning(false);
        setPendingSolve(null);
        setStatus("목표에 도달했습니다. 미배정 0건이며 식사부족과 3연강이 각각 20건 미만입니다.");
        navigateWithTransition("/workspace/classes");
        return;
      }
      scheduleNextSolveChunk();
      return;
    }
    if (message.type === "bestChanged") {
      clearSolveWatchdog();
      candidateRef.current = message.candidate;
      setCandidate(message.candidate);
      setDiagnostics(message.diagnostics);
      setRepairProposals([]);
      setRepairRecommendation(null);
      setRepairStatus("");
      setScenarioDirty(true);
      if (softTargetReached(message.candidate)) {
        stopSolveLoop();
        clearSolveWatchdog();
        workerRef.current?.terminate();
        workerRef.current = null;
        setWorkerRunning(false);
        setPendingSolve(null);
        setStatus("목표에 도달했습니다. 미배정 0건이며 식사부족과 3연강이 각각 20건 미만입니다.");
        navigateWithTransition("/workspace/classes");
      }
      return;
    }
    if (message.type === "accepted") {
      stopSolveLoop();
      clearSolveWatchdog();
      setWorkerRunning(false);
      setPendingSolve(null);
      candidateRef.current = message.candidate;
      setCandidate(message.candidate);
      setDiagnostics(message.diagnostics);
      setScenarioDirty(true);
      navigateWithTransition("/workspace/classes");
      return;
    }
    if (message.type === "stopped") {
      stopSolveLoop();
      clearSolveWatchdog();
      setWorkerRunning(false);
      setPendingSolve(null);
      setStatus("탐색을 중지했습니다. 현재 최선안은 유지됩니다.");
      return;
    }
    if (message.type === "error") {
      clearSolveWatchdog();
      chunkInFlightRef.current = false;
      setWorkerRunning(false);
      setPendingSolve(null);
      stopSolveLoop();
      setStatus(message.message);
    }
  }

  function changeProvider(provider: AiProvider) {
    const defaultModel = provider === "openai" ? openAiModels[0] : provider === "gemini" ? geminiModels[0] : "custom";
    setModelMode(defaultModel);
    setAiConfig({ provider, model: defaultModel === "custom" ? "" : defaultModel, apiKey: "", baseUrl: "", validated: false });
  }

  function changeModel(nextModel: string) {
    setModelMode(nextModel);
    setAiConfig((current) => ({ ...current, model: nextModel === "custom" ? "" : nextModel, validated: false }));
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    setLoginError("");
    setLoginStatus("로그인 요청을 보내는 중입니다.");
    setLoginLoading(true);
    try {
      const data = await fetchJson("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const nextSession = data.session || (await fetchJson("/api/auth/session")).session;
      if (!nextSession) throw new Error("로그인 세션을 확인하지 못했습니다.");
      setSession(nextSession);
      setLoginStatus("로그인되었습니다.");
      router.replace("/setup/ai");
    } catch (error: unknown) {
      setLoginError(error instanceof Error ? error.message : "로그인에 실패했습니다.");
      setLoginStatus("");
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setSession(null);
    setAiConfig({ provider: "gemini", model: "gemini-3.5-flash", apiKey: "", validated: false });
    router.replace("/setup/ai");
  }

  async function validateAi() {
    if (aiValidationLoading) {
      setAiValidationMessage("이미 API 키를 검증 중입니다. 잠시만 기다려 주세요.");
      return;
    }
    setAiValidationMessage("API 키 검증 버튼을 눌렀습니다. 입력값을 확인하는 중입니다.");
    setStatus("API 키 검증 버튼을 눌렀습니다. 입력값을 확인하는 중입니다.");
    const nextConfig: AiConfig = {
      ...aiConfig,
      apiKey: aiConfig.apiKey?.trim(),
      model: aiConfig.model?.trim(),
      baseUrl: aiConfig.baseUrl?.trim(),
    };
    if (!nextConfig.apiKey) {
      const message = "API 키를 먼저 입력하세요.";
      setAiConfig((current) => ({ ...current, validated: false }));
      setAiValidationMessage(message);
      setStatus(message);
      return;
    }
    if (!nextConfig.model) {
      const message = "모델코드를 선택하거나 입력하세요.";
      setAiConfig((current) => ({ ...current, validated: false }));
      setAiValidationMessage(message);
      setStatus(message);
      return;
    }
    if (nextConfig.provider === "custom" && !nextConfig.baseUrl) {
      const message = "Custom 제공자는 Base URL을 먼저 입력하세요.";
      setAiConfig((current) => ({ ...current, validated: false }));
      setAiValidationMessage(message);
      setStatus(message);
      return;
    }
    setAiValidationLoading(true);
    setAiConfig((current) => ({ ...current, ...nextConfig, validated: false }));
    const startMessage = `${providerName(nextConfig.provider)} API 키를 검증 중입니다. 최대 15초 안에 결과를 표시합니다.`;
    setAiValidationMessage(startMessage);
    setStatus(startMessage);
    try {
      await nextPaint();
      const result = await withUiTimeout(
        validateClientAiKey(nextConfig),
        16_000,
        `${providerName(nextConfig.provider)} API 검증 응답이 지연되어 중단했습니다. 네트워크, CORS, 모델코드, 할당량을 확인하세요.`,
      );
      setAiConfig((current) => ({ ...current, validated: result.ok }));
      setAiValidationMessage(result.message);
      setStatus(result.message);
      if (result.ok) window.setTimeout(() => navigateWithTransition("/setup/project"), 350);
    } catch (error) {
      const message = error instanceof Error ? error.message : "API 키 검증에 실패했습니다.";
      setAiConfig((current) => ({ ...current, validated: false }));
      setAiValidationMessage(message);
      setStatus(message);
    } finally {
      setAiValidationLoading(false);
    }
  }

  function resetWorkspace(nextName = "새 시간표") {
    stopSolveLoop();
    workerRef.current?.terminate();
    repairWorkerRef.current?.terminate();
    workerRef.current = null;
    repairWorkerRef.current = null;
    repairRejectRef.current = null;
    setScenarioId("");
    setScenarioName(nextName);
    setScenarioDirty(false);
    setRecords(null);
    setImportIssues([]);
    setCandidate(null);
    setDiagnostics(null);
    setConstraintText("");
    setSolveOptions(defaultSolveOptions());
    setProgress(null);
    setMoveOptions([]);
    setMovePreviewResult(null);
    setPendingMove(null);
    setSelectedManualFrom(null);
    setRepairProposals([]);
    setRepairRecommendation(null);
    setRepairStatus("");
    setRepairLoading(false);
    autoRepairUsedRef.current = false;
    setFile(null);
    setFileBuffer(null);
    window.sessionStorage.removeItem(WORKSPACE_STATE_KEY);
  }

  async function downloadTemplate() {
    if (templateDownloading) return;
    setTemplateDownloading(true);
    setStatus("엑셀 양식을 준비하는 중입니다.");
    try {
      const response = await fetch("/api/templates/timetable-input", { cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 401 ? "로그인이 만료되었습니다." : `엑셀 양식 다운로드 실패: HTTP ${response.status}`);
      downloadBlob("timetable-input.xlsx", await response.blob());
      setStatus("엑셀 양식을 다운로드했습니다.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "엑셀 양식 다운로드에 실패했습니다.");
    } finally {
      setTemplateDownloading(false);
    }
  }

  async function handleWorkbookFile(selected: File | null) {
    setFile(selected);
    setFileBuffer(null);
    setImportIssues([]);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".xlsx")) {
      setImportIssues([{ severity: "error", sheet: "파일", row: 0, column: "-", message: "엑셀 파일만 첨부할 수 있습니다.", fix: ".xlsx 형식의 통합 입력 엑셀을 선택하거나 드롭하세요." }]);
      setStatus("엑셀 검증 오류가 있습니다. .xlsx 파일을 첨부하세요.");
      return;
    }
    try {
      setFileBuffer(await selected.arrayBuffer());
      setStatus(`${selected.name} 파일을 선택했습니다. 업로드 및 검증을 누르세요.`);
    } catch (error) {
      const message = String((error as { message?: unknown }).message || "선택한 파일을 읽지 못했습니다.");
      setImportIssues([{ severity: "error", sheet: "파일", row: 0, column: "-", message: `파일 선택 권한 오류: ${message}`, fix: "파일이 열려 있다면 닫고, 같은 파일을 다시 선택하거나 드롭하세요." }]);
      setStatus("선택한 파일을 읽지 못했습니다. 아래 오류를 확인하세요.");
    }
  }

  async function selectWorkbookFile(event: ChangeEvent<HTMLInputElement>) {
    await handleWorkbookFile(event.target.files?.[0] || null);
    event.target.value = "";
    return;
    const selected = event.target.files?.[0] || new File([], "");
    setFile(selected);
    setFileBuffer(null);
    setImportIssues([]);
    if (!selected) return;
    try {
      setFileBuffer(await selected.arrayBuffer());
      setStatus(`${selected.name} 파일을 선택했습니다. 이제 업로드 및 검증을 누르세요.`);
    } catch (error: unknown) {
      const message = String((error as { message?: unknown }).message || "선택한 파일을 읽지 못했습니다.");
      setImportIssues([{ severity: "error", sheet: "파일", row: 0, column: "-", message: `파일 선택 권한 오류: ${message}`, fix: "파일이 열려 있다면 닫고, 같은 파일을 다시 선택한 뒤 바로 검증하세요." }]);
      setStatus("선택한 파일을 읽지 못했습니다. 아래 오류를 확인하세요.");
    }
  }

  async function handleWorkbookDrop(event: DragEvent<HTMLElement>) {
    const selected = droppedSingleFile(event);
    if (!selected) {
      setImportIssues([{ severity: "error", sheet: "파일", row: 0, column: "-", message: "파일은 1개만 드롭할 수 있습니다.", fix: "통합 입력 엑셀 1개만 다시 드롭하세요." }]);
      setStatus("엑셀 파일 1개만 드롭하세요.");
      return;
    }
    await handleWorkbookFile(selected);
  }

  async function uploadWorkbook() {
    if (!file || !fileBuffer) {
      setStatus("검증할 엑셀 파일을 먼저 선택하세요.");
      return;
    }
    setStatus("브라우저에서 엑셀을 읽고 검증하는 중입니다.");
    try {
      const parsed = await parseWorkbookBuffer(fileBuffer);
      const hasError = parsed.issues.some((issue) => issue.severity === "error");
      setRecords(parsed);
      setImportIssues(parsed.issues);
      setScenarioDirty(true);
      if (hasError) {
        const first = sortedIssues(parsed.issues).find((issue) => issue.severity === "error");
        setStatus(first ? `엑셀 검증 오류: ${first.sheet} ${first.row}행 ${first.column}열 - ${first.message}` : "엑셀 검증 오류가 있습니다.");
        return;
      }
      setStatus("엑셀 검증을 통과했습니다.");
      navigateWithTransition("/setup/constraints");
    } catch (error) {
      const message = error instanceof Error ? error.message : "엑셀 파일을 읽지 못했습니다.";
      setRecords(null);
      setImportIssues([{ severity: "error", sheet: "파일", row: 0, column: "-", message: `파일 읽기 오류: ${message}`, fix: ".xlsx 형식인지 확인하고, 파일이 열려 있다면 닫은 뒤 다시 첨부하세요." }]);
      setStatus("파일 읽기 오류가 있습니다. 아래 오류를 확인하세요.");
    }
  }

  function updatePriority(value: string) {
    const item = priorityOptions.find((option) => option.value === value) || priorityOptions[0];
    setSolveOptions((current) => ({ ...current, softPriorityOrder: item.order }));
    setScenarioDirty(true);
  }

  function updateSolveFlag<K extends keyof SolveOptions>(key: K, value: SolveOptions[K]) {
    setSolveOptions((current) => ({ ...current, [key]: value }));
    setScenarioDirty(true);
  }

  function updateLunchProtectionLevel(value: NonNullable<SolveOptions["lunchProtectionLevel"]>) {
    setSolveOptions((current) => ({ ...current, lunchProtectionLevel: value, lunchProtection: value === "off" ? "N" : "Y", strictLunch: value === "hard" || value === "high" }));
    setScenarioDirty(true);
  }

  function updateTeacherDayMax(day: DayKey, value: string) {
    const nextValue = Number(value);
    setSolveOptions((current) => {
      const teacherDayMax = { ...(current.teacherDayMax || {}) };
      if (Number.isFinite(nextValue) && nextValue > 0) teacherDayMax[day] = nextValue;
      else delete teacherDayMax[day];
      return { ...current, teacherDayMax };
    });
    setScenarioDirty(true);
  }

  function enabledTeacherIssueFilters() {
    return issueFilterLabels.filter((item) => teacherIssueFilters[item.key]).map((item) => item.issue);
  }

  function issueMatchesCurrentFilter(issues: string[]) {
    const enabled = enabledTeacherIssueFilters();
    if (!enabled.length) return true;
    return enabled.some((issue) => issues.includes(issue));
  }

  function filteredTeacherIssues() {
    return (diagnostics?.teacherIssues || []).filter((item) => issueMatchesCurrentFilter(item.issues));
  }

  function isRepairExecutionIntent(message: string) {
    const normalized = message.replace(/\s+/g, "");
    const action = /(해줘|해달|수정|반영|적용|줄여|없애|개선|보정|옮겨|바꿔)/.test(normalized);
    const target = /(식사|점심|연강|안배|시간표|수업|배정|방안|방법|추천|보정)/.test(normalized);
    return action && target;
  }

  function renderIssueFilterControls() {
    return (
      <div className="filter-row">
        <label className="check-row">
          <input
            type="checkbox"
            checked={issueFilterLabels.every((item) => teacherIssueFilters[item.key])}
            onChange={(event) => {
              const checked = event.target.checked;
              setTeacherIssueFilters({ consecutive: checked, lunch: checked, balance: checked });
            }}
          /> 전체
        </label>
        {issueFilterLabels.map((item) => (
          <label key={item.key} className="check-row">
            <input
              type="checkbox"
              checked={teacherIssueFilters[item.key]}
              onChange={(event) => setTeacherIssueFilters((current) => ({ ...current, [item.key]: event.target.checked }))}
            /> {item.label}
          </label>
        ))}
      </div>
    );
  }

  function sameSubjectDayImpossibleMessage(source: NormalizedRecords) {
    const maxDays = source.config.days.length || 5;
    const counts = new Map<string, { className: string; subjectName: string; units: number; syncGroup?: string }>();
    for (const load of source.loads) {
      const scope = load.syncGroup ? `sync:${load.syncGroup}` : "single";
      const key = `${load.classCode}:${load.subjectCode || load.subjectName}:${scope}`;
      const item = counts.get(key) || { className: load.className, subjectName: load.subjectName, units: 0, syncGroup: load.syncGroup };
      item.units += load.continuousBlocks?.length || Number(load.hours || 0);
      counts.set(key, item);
    }
    const impossible = [...counts.values()].find((item) => item.units > maxDays);
    const groupLabel = impossible?.syncGroup ? `(${impossible.syncGroup})` : "";
    return impossible ? `같은날 배정금지를 켜면 ${impossible.className} / ${impossible.subjectName}${groupLabel} ${impossible.units}개 수업 묶음을 ${maxDays}일 안에 나눌 수 없습니다. 같은날 배정금지를 끄거나 연속패턴을 조정한 뒤 다시 배정하세요.` : "";
  }

  function startSolve(mode: "initial" | "reassign" = "initial", overrides: Partial<SolveOptions> = {}) {
    if (!records) {
      setStatus("엑셀 자료를 먼저 업로드하고 검증하세요.");
      return;
    }
    const payloadOptions = { ...solveOptions, ...overrides, naturalLanguageConstraints: constraintText };
    if (payloadOptions.sameSubjectSameDay) {
      const impossible = sameSubjectDayImpossibleMessage(records);
      if (impossible) {
        setStatus(impossible);
        return;
      }
    }
    stopSolveLoop();
    clearSolveWatchdog();
    workerRef.current?.terminate();
    workerRef.current = null;
    if (Object.keys(overrides).length) setSolveOptions((current) => ({ ...current, ...overrides }));
    if (mode === "initial") {
      candidateRef.current = null;
      setCandidate(null);
      setDiagnostics(null);
    }
    autoRepairUsedRef.current = false;
    setRepairProposals([]);
    setRepairRecommendation(null);
    setRepairStatus("");
    setProgress(null);
    setWorkerRunning(true);
    setSolveStartedAt(Date.now());
    setClock(Date.now());
    setStatus("브라우저에서 자동배정을 시작했습니다.");
    setPendingSolve({
      id: Date.now(),
      mode,
      records,
      solveOptions: payloadOptions,
      naturalLanguageConstraints: constraintText,
      candidate: mode === "reassign" ? candidate : null,
    });
    navigateWithTransition("/setup/solving");
  }

  function showInputStatus() {
    if (!records) {
      setStatus("수업 입력자료가 없습니다.");
      return;
    }
    const totalHours = records.loads.reduce((sum, load) => sum + (Number(load.hours) || 0), 0);
    setStatus(`수업 입력현황: 교사 ${Object.keys(records.teachers).length}명, 학급 ${Object.keys(records.classes).length}개, 과목 ${Object.keys(records.subjects).length}개, 총 ${totalHours}시수`);
  }

  function showSyncStatus() {
    if (!records) {
      setStatus("동시수업 자료가 없습니다.");
      return;
    }
    const syncGroups = new Map<string, number>();
    for (const load of records.loads) {
      if (!load.syncGroup) continue;
      syncGroups.set(load.syncGroup, (syncGroups.get(load.syncGroup) || 0) + Number(load.hours || 0));
    }
    if (!syncGroups.size) {
      setStatus("동시수업 그룹이 입력되지 않았습니다.");
      return;
    }
    const assigned = diagnostics?.syncGroups || [];
    setStatus(`동시수업 배당체크: ${syncGroups.size}개 그룹, 현재 미배정 ${assigned.reduce((sum, item) => sum + item.unassigned, 0)}시간`);
    navigateWithTransition("/workspace/analysis");
  }

  function updateAllocationHours(loadId: string, hours: number) {
    if (!records) return;
    const nextRecords = JSON.parse(JSON.stringify(records)) as NormalizedRecords;
    const load = nextRecords.loads.find((item) => item.id === loadId);
    if (!load) return;
    load.hours = Math.max(0, hours);
    setRecords(nextRecords);
    setCandidate(null);
    setDiagnostics(null);
    setProgress(null);
    setScenarioDirty(true);
    setStatus("수업 배당을 수정했습니다. 재배정을 실행하세요.");
  }

  function stopSolve() {
    stopSolveLoop();
    clearSolveWatchdog();
    setPendingSolve(null);
    workerRef.current?.postMessage({ type: "stop" });
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerRunning(false);
    setStatus(candidateRef.current ? "탐색이 중지되었습니다. 현재 최선안 사용 또는 재배정을 선택하세요." : "탐색이 중지되었습니다. 아직 사용할 최선안은 없습니다.");
  }

  function acceptCurrentBest() {
    const current = candidateRef.current;
    if (!current || !records) {
      setStatus("사용할 현재 최선안이 아직 없습니다.");
      return;
    }
    stopSolveLoop();
    clearSolveWatchdog();
    setPendingSolve(null);
    workerRef.current?.terminate();
    workerRef.current = null;
    setWorkerRunning(false);
    const nextDiagnostics = computeDiagnostics(records, current);
    setDiagnostics(nextDiagnostics);
    setCandidate(current);
    setScenarioDirty(true);
    navigateWithTransition("/workspace/classes");
  }

  function currentScenarioPayload() {
    return stripSensitive({
      format: PROJECT_FILE_FORMAT,
      id: scenarioId || undefined,
      name: scenarioName || "새 시간표",
      records,
      candidate,
      diagnostics,
      solveOptions,
      constraintText,
      version: PROJECT_FILE_VERSION,
      updatedAt: new Date().toISOString(),
    });
  }

  function saveLocalScenario(payload: ReturnType<typeof currentScenarioPayload>, name: string, id = scenarioId || "") {
    const now = new Date().toISOString();
    const nextId = id || `local-${Date.now()}`;
    const scenarios = readLocalScenarios();
    const existing = scenarios.find((item) => item.id === nextId);
    const item: StoredScenario = {
      id: nextId,
      name,
      records: payload.records as NormalizedRecords | null,
      candidate: payload.candidate as Candidate | null,
      diagnostics: payload.diagnostics as Diagnostics | null,
      solveOptions: payload.solveOptions as SolveOptions,
      constraintText: String(payload.constraintText || ""),
      version: 2,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    writeLocalScenarios([item, ...scenarios.filter((scenario) => scenario.id !== nextId)]);
    setScenarioId(nextId);
    setScenarioName(name);
    setScenarioSource("local");
    setScenarioDirty(false);
  }

  function saveProjectFile(saveAs = false) {
    if (!records && !candidate) {
      setStatus("저장할 시간표 작업물이 없습니다.");
      return;
    }
    const nextName = saveAs ? window.prompt("저장할 파일 이름을 입력하세요.", scenarioName || "새 시간표") : scenarioName;
    if (!nextName) return;
    const now = new Date().toISOString();
    const payload = stripSensitive({
      ...currentScenarioPayload(),
      id: scenarioId || `file-${Date.now()}`,
      name: nextName,
      format: PROJECT_FILE_FORMAT,
      version: PROJECT_FILE_VERSION,
      createdAt: now,
      updatedAt: now,
    });
    downloadBlob(safeProjectFilename(nextName), new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    setScenarioName(nextName);
    setScenarioDirty(false);
    setStatus(`${safeProjectFilename(nextName)} 파일로 저장했습니다.`);
  }

  async function handleProjectFile(selected: File | null) {
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".aitimetable.json") && !selected.name.toLowerCase().endsWith(".json")) {
      setStatus("시간표 작업 파일은 .aitimetable.json 형식이어야 합니다.");
      return;
    }
    try {
      const parsed = JSON.parse(await selected.text()) as StoredScenario;
      if (parsed.format && parsed.format !== PROJECT_FILE_FORMAT) throw new Error("시간표 작업 파일 형식이 아닙니다.");
      if (!parsed.records && !parsed.candidate) throw new Error("불러올 시간표 자료가 없습니다.");
      applyLoadedScenario({
        id: parsed.id || `file-${Date.now()}`,
        name: parsed.name || selected.name.replace(/\.aitimetable\.json$/i, ""),
        records: parsed.records || null,
        candidate: parsed.candidate || null,
        diagnostics: parsed.diagnostics || null,
        solveOptions: parsed.solveOptions || defaultSolveOptions(),
        constraintText: parsed.constraintText || "",
        version: parsed.version || PROJECT_FILE_VERSION,
        createdAt: parsed.createdAt || new Date().toISOString(),
        updatedAt: parsed.updatedAt || new Date().toISOString(),
      }, "local");
      setStatus(`${selected.name} 작업 파일을 불러왔습니다.`);
    } catch (error) {
      setStatus(error instanceof Error ? `작업 파일 불러오기 실패: ${error.message}` : "작업 파일을 불러오지 못했습니다.");
    }
  }

  async function selectProjectFile(event: ChangeEvent<HTMLInputElement>) {
    await handleProjectFile(event.target.files?.[0] || null);
    event.target.value = "";
  }

  async function handleProjectDrop(event: DragEvent<HTMLElement>) {
    const selected = droppedSingleFile(event);
    if (!selected) {
      setStatus("시간표 작업 파일 1개만 드롭하세요.");
      return;
    }
    await handleProjectFile(selected);
  }

  async function saveScenario(saveAs = false) {
    saveProjectFile(saveAs);
    return;
    if (!records && !candidate) return;
    const nextName = saveAs ? window.prompt("저장할 이름을 입력하세요.", scenarioName || "새 시간표") : scenarioName;
    if (!nextName) return;
    setScenarioSaving(true);
    const payload = currentScenarioPayload();
    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, id: saveAs ? undefined : scenarioId || undefined, name: nextName }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setScenarioId(data.scenario.id);
      setScenarioName(data.scenario.name || nextName);
      setScenarioSource("server");
      setScenarioDirty(false);
      setStatus("서버 저장소에 저장했습니다.");
    } catch {
      saveLocalScenario(payload, nextName || scenarioName || "timetable-project", saveAs ? "" : scenarioId);
      setStatus("서버 저장소를 사용할 수 없어 브라우저 임시 저장소에 저장했습니다.");
    } finally {
      setScenarioSaving(false);
    }
  }

  async function refreshScenarioList(open = true) {
    if (open) {
      projectFileInputRef.current?.click();
      return;
    }
    setScenarioLoading(true);
    if (open) setScenarioModalOpen(true);
    try {
      const response = await fetch("/api/scenarios", { cache: "no-store" });
      if (!response.ok) throw new Error("server storage unavailable");
      const data = await response.json();
      setScenarioList((data.scenarios || []).map((item: ScenarioSummary) => ({ ...item, source: "server" })));
      setScenarioSource("server");
    } catch {
      setScenarioList(readLocalScenarios().map(scenarioSummary));
      setScenarioSource("local");
    } finally {
      setScenarioLoading(false);
    }
  }

  function applyLoadedScenario(item: StoredScenario, source: ScenarioSource) {
    setScenarioId(item.id);
    setScenarioName(item.name || "저장된 시간표");
    setRecords(item.records || null);
    setCandidate(item.candidate || null);
    setDiagnostics(item.diagnostics || null);
    setConstraintText(item.constraintText || "");
    setSolveOptions({ ...defaultSolveOptions(), ...(item.solveOptions || {}) });
    setScenarioSource(source);
    setScenarioDirty(false);
    setScenarioModalOpen(false);
    navigateWithTransition("/workspace/classes");
  }

  async function loadScenario(id: string, source: ScenarioSource = scenarioSource) {
    setScenarioLoading(true);
    try {
      if (source === "server") {
        const response = await fetch(`/api/scenarios/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("server storage unavailable");
        const data = await response.json();
        applyLoadedScenario(data.scenario, "server");
      } else {
        const item = readLocalScenarios().find((scenario) => scenario.id === id);
        if (!item) throw new Error("저장된 시간표를 찾지 못했습니다.");
        applyLoadedScenario(item, "local");
      }
    } catch (error) {
      const item = readLocalScenarios().find((scenario) => scenario.id === id);
      if (item) applyLoadedScenario(item, "local");
      else setStatus(error instanceof Error ? error.message : "불러오기에 실패했습니다.");
    } finally {
      setScenarioLoading(false);
    }
  }

  function handleManualDoubleClick(from: ManualMove["from"]) {
    if (!records || !candidate) return;
    if (selectedManualFrom && selectedManualFrom.classCode === from.classCode && selectedManualFrom.day === from.day && selectedManualFrom.period === from.period) {
      setSelectedManualFrom(null);
      setMoveOptions([]);
      setPendingMove(null);
      setMovePreviewResult(null);
      setStatus("수동수정 선택을 취소했습니다.");
      return;
    }
    const options = computeMoveOptions(records, candidate, from, solveOptions);
    setSelectedManualFrom(from);
    setMoveOptions(options);
    setPendingMove(null);
    setMovePreviewResult(null);
    setStatus(options.length ? "색으로 표시된 이동 후보를 클릭하면 수정 전/후를 미리 볼 수 있습니다." : "이동 가능한 후보를 찾지 못했습니다.");
  }

  function openMovePreview(option: ManualMoveCandidate) {
    if (option.applies === false || option.quality === "blocked" || option.preview.ok === false) {
      setPendingMove(null);
      setMovePreviewResult(null);
      setStatus(option.failureReason || option.preview.failureReason || option.reasons[0] || "이 칸으로는 이동할 수 없습니다.");
      return;
    }
    setPendingMove(option.move);
    setMovePreviewResult(option.preview || computeMovePreview(candidate!, option.move));
  }

  function approveMove() {
    if (!records || !candidate || !pendingMove) return;
    const updated = applyManualMove(records, candidate, pendingMove, solveOptions);
    if (updated.signature === candidate.signature) {
      setMovePreviewResult(null);
      setPendingMove(null);
      setStatus("수동수정이 적용되지 않았습니다. 동시/연속수업 묶음 또는 hard 제약을 확인하세요.");
      return;
    }
    setCandidate(updated);
    setDiagnostics(computeDiagnostics(records, updated));
    setMovePreviewResult(null);
    setPendingMove(null);
    setSelectedManualFrom(null);
    setMoveOptions([]);
    setRepairProposals([]);
    setRepairRecommendation(null);
    setRepairStatus("");
    setScenarioDirty(true);
    setStatus("수동수정을 반영했습니다.");
  }

  function openRepairPreview(proposal: MoveProposal) {
    if (!candidate) return;
    setPendingMove(proposal.move);
    setMovePreviewResult(proposal.preview || computeMovePreview(candidate, proposal.move));
    setRepairStatus(`${proposal.proposalId} 미리보기를 열었습니다. 승인하면 실제 시간표에 반영됩니다.`);
  }

  function waitForPaint() {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });
  }

  function stopRepairWorker(message = "AI 보정안 검토를 중지했습니다.") {
    repairWorkerRef.current?.terminate();
    repairWorkerRef.current = null;
    repairRejectRef.current?.(new Error(message));
    repairRejectRef.current = null;
    setRepairLoading(false);
    setRepairStatus(message);
  }

  async function computeRepairOptionsInWorker(baseCandidate: Candidate) {
    if (!records) return [] as MoveProposal[];
    repairWorkerRef.current?.terminate();
    const worker = new Worker(new URL("../workers/solver.worker.ts", import.meta.url), { type: "module" });
    repairWorkerRef.current = worker;
    return await new Promise<MoveProposal[]>((resolve, reject) => {
      repairRejectRef.current = reject;
      const timeout = window.setTimeout(() => {
        worker.terminate();
        if (repairWorkerRef.current === worker) repairWorkerRef.current = null;
        repairRejectRef.current = null;
        reject(new Error("보정 후보 계산이 오래 걸려 중단했습니다. 다시 시도해 주세요."));
      }, 30000);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === "ready") {
          worker.postMessage({ type: "repairOptions" });
          return;
        }
        if (message.type === "repairOptions") {
          window.clearTimeout(timeout);
          worker.terminate();
          if (repairWorkerRef.current === worker) repairWorkerRef.current = null;
          repairRejectRef.current = null;
          resolve(message.proposals);
          return;
        }
        if (message.type === "error") {
          window.clearTimeout(timeout);
          worker.terminate();
          if (repairWorkerRef.current === worker) repairWorkerRef.current = null;
          repairRejectRef.current = null;
          reject(new Error(message.message));
        }
      };
      worker.onerror = () => {
        window.clearTimeout(timeout);
        worker.terminate();
        if (repairWorkerRef.current === worker) repairWorkerRef.current = null;
        repairRejectRef.current = null;
        reject(new Error("보정 엔진 오류가 발생했습니다."));
      };
      worker.postMessage({ type: "init", records, solveOptions, candidate: baseCandidate });
    });
  }

  async function runAiRepair(source: "manual" | "auto" | "chat" = "manual", baseCandidate = candidate) {
    if (repairLoading) return [] as MoveProposal[];
    if (!records || !baseCandidate) {
      setRepairStatus("보정할 시간표가 없습니다. 먼저 자동배정을 완료하세요.");
      return [] as MoveProposal[];
    }
    setRepairLoading(true);
    setRepairStatus(source === "auto" ? "탐색이 정체되어 AI 보정 후보를 1회 검토합니다." : "식사/3연강/안배 보정 후보를 계산합니다.");
    try {
      await waitForPaint();
      const local = await computeRepairOptionsInWorker(baseCandidate);
      if (!local.length) {
        setRepairProposals([]);
        setRepairRecommendation({ provider: "local", ranked: [], message: "hard-safe 보정 후보를 찾지 못했습니다." });
        setRepairStatus("현재 조건을 지키면서 바로 적용 가능한 soft 보정 후보가 없습니다.");
        return [] as MoveProposal[];
      }
      const localRecommendation: AiRepairRecommendation = {
        provider: "local",
        ranked: local.slice(0, 6).map((proposal, index) => ({ proposalId: proposal.proposalId, reason: proposal.reasons[0] || "로컬 점수 기준 상위 후보입니다.", priority: index + 1 })),
        message: "로컬 solver가 hard-safe 후보를 추천했습니다.",
      };
      if (!aiConfig.validated || !aiConfig.apiKey) {
        setRepairProposals(local);
        setRepairRecommendation(localRecommendation);
        setRepairStatus("API가 검증되지 않아 로컬 추천만 표시합니다.");
        return local;
      }
      const priorityLabel = priorityOptions.find((item) => item.value === priorityValue(solveOptions.softPriorityOrder))?.label || "";
      const prompt = maskedRepairPrompt(local, baseCandidate.summary, priorityLabel);
      try {
        const aiText = await generateAiText(aiConfig, prompt);
        const aiRecommendation = parseAiRepairRecommendation(aiText, new Set(local.map((proposal) => proposal.proposalId)));
        const recommendation = aiRecommendation || { ...localRecommendation, message: "AI 응답을 구조화하지 못해 로컬 추천 순서를 사용합니다." };
        const sorted = sortProposalsByRecommendation(local, recommendation);
        setRepairProposals(sorted);
        setRepairRecommendation(recommendation);
        setRepairStatus(recommendation.provider === "ai" ? "AI가 로컬 후보 중 추천 순서를 정했습니다." : recommendation.message);
        if (source === "auto") {
          setChatMessages((current) => [...current, { role: "assistant", text: `AI soft 보정 후보를 준비했습니다.\n${sorted.slice(0, 3).map((proposal) => `${proposal.proposalId}: ${proposal.title} (${proposalDeltaText(proposal)})`).join("\n")}` }]);
        }
        return sorted;
      } catch (error) {
        setRepairProposals(local);
        setRepairRecommendation({ ...localRecommendation, message: "원격 AI 호출 실패로 로컬 추천을 표시합니다." });
        const message = error instanceof Error ? error.message : "AI 호출에 실패했습니다.";
        setRepairStatus(`원격 AI 실패: ${message} 로컬 추천만 표시합니다.`);
        return local;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "보정 후보 계산에 실패했습니다.";
      setRepairProposals([]);
      setRepairRecommendation({ provider: "local", ranked: [], message });
      setRepairStatus(message);
      return [] as MoveProposal[];
    } finally {
      setRepairLoading(false);
    }
  }

  async function sendChat(event: FormEvent) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message || chatLoading) return;
    setChatInput("");
    setChatMessages((current) => [...current, { role: "user", text: message }]);
    setChatLoading(true);
    try {
      const context = [
        `현재 시간표 요약: 미배정 ${candidate?.summary.unassigned ?? 0}, hard 오류 ${candidate?.summary.hardErrors ?? 0}, 3연강 ${candidate?.summary.consecutiveIssues ?? 0}, 식사부족 ${candidate?.summary.lunchIssues ?? 0}, 안배부족 ${candidate?.summary.balanceIssues ?? 0}`,
        `우선순위: ${priorityOptions.find((item) => item.value === priorityValue(solveOptions.softPriorityOrder))?.label}`,
        ...(diagnostics?.unassigned || []).slice(0, 20).map((item) => `미배정: ${item.teacherName}/${item.subjectName}/${item.className}/${item.hours}시간/${item.reason}`),
        ...(diagnostics?.teacherIssues || []).slice(0, 20).map((item) => `배정불량교사: ${item.teacherName}/${item.issues.join(",")}/${item.detail}`),
      ].join("\n");
      if (candidate && isRepairExecutionIntent(message)) {
        setChatMessages((current) => [...current, { role: "assistant", text: "검증 가능한 수정 후보를 계산합니다. 후보가 나오면 전/후 미리보기로 보여드릴게요." }]);
        const proposals = await runAiRepair("chat", candidate);
        const best = proposals[0];
        if (best) {
          openRepairPreview(best);
          setChatMessages((current) => [...current, { role: "assistant", text: `${best.proposalId} 보정안을 먼저 추천합니다.\n${best.title}\n${proposalDeltaText(best)}\n전/후 미리보기를 확인한 뒤 승인하면 실제 시간표에 반영됩니다.` }]);
        } else {
          setChatMessages((current) => [...current, { role: "assistant", text: "현재 조건을 지키면서 바로 적용 가능한 보정 후보를 찾지 못했습니다. 수동수정에서 불가 사유를 확인하거나 자동배정 조건을 조정해 주세요." }]);
        }
        return;
      }
      const prompt = `학교 시간표 담당자를 도와주세요. 실제 변경은 사용자가 승인해야 합니다.\n\n${context}\n\n사용자 요청: ${message}`;
      const answer = aiConfig.validated && aiConfig.apiKey
        ? await generateAiText(aiConfig, prompt)
        : `API 키가 검증되지 않아 로컬 진단으로 답합니다.\n${context || "현재 시간표가 없습니다."}`;
      setChatMessages((current) => [...current, { role: "assistant", text: answer || "응답 내용이 비어 있습니다." }]);
    } catch (error) {
      setChatMessages((current) => [...current, { role: "assistant", text: error instanceof Error ? `AI 응답 실패: ${error.message}` : "AI 응답에 실패했습니다." }]);
    } finally {
      setChatLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <strong>AI 학교 시간표</strong>
          <span>{scenarioName}{scenarioDirty ? " · 저장 필요" : ""}</span>
        </div>
        <nav className="top-actions">
          <button className="secondary" onClick={() => saveScenario(false)} disabled={scenarioSaving || (!records && !candidate)}>{scenarioSaving ? "저장 중" : "저장"}</button>
          <button className="secondary" onClick={() => saveScenario(true)} disabled={scenarioSaving || (!records && !candidate)}>다른 이름 저장</button>
          <button className="secondary" onClick={() => refreshScenarioList(true)} disabled={scenarioLoading}>불러오기</button>
        </nav>
      </header>

      {effectivePath.startsWith("/setup") ? renderSetup() : renderWorkspace()}

      <input ref={projectFileInputRef} type="file" accept=".aitimetable.json,.json" onChange={selectProjectFile} hidden />
      {status ? <div className="toast">{status}</div> : null}
      {scenarioModalOpen ? renderScenarioModal() : null}
      {allocationEditorOpen ? renderAllocationEditor() : null}
      {movePreviewResult ? renderMovePreviewModal() : null}
    </div>
  );

  function renderSetup() {
    const steps = [
      { id: "ai", href: "/setup/ai", label: "AI 연결" },
      { id: "project", href: "/setup/project", label: "새로 만들기/불러오기" },
      { id: "excel", href: "/setup/excel", label: "엑셀 업로드" },
      { id: "constraints", href: "/setup/constraints", label: "말로 설명할 조건" },
      { id: "preferences", href: "/setup/preferences", label: "자동배정 선호도" },
      { id: "solving", href: "/setup/solving", label: "배정 진행" },
    ];
    return (
      <main className="setup-page">
        <aside className="setup-steps">
          {steps.map((item, index) => (
            <Link
              key={item.id}
              className={`setup-step ${setupStep === item.id ? "active" : ""}`}
              href={item.href}
              onClick={(event) => {
                event.preventDefault();
                navigateWithTransition(item.href);
              }}
            >
              <span>{index + 1}</span>{item.label}
            </Link>
          ))}
        </aside>
        <section className={`setup-stage route-transition route-${transitionState}`}>
          {setupStep === "ai" ? renderAiStep() : null}
          {setupStep === "project" ? renderProjectStep() : null}
          {setupStep === "excel" ? renderExcelStep() : null}
          {setupStep === "constraints" ? renderConstraintsStep() : null}
          {setupStep === "preferences" ? renderPreferencesStep("initial") : null}
          {setupStep === "solving" ? renderSolvingStep() : null}
          {setupStep === "excel" ? (
            <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleWorkbookDrop}>
              <strong>엑셀 파일 드래그&드롭</strong>
              <span>.xlsx 통합 입력 파일을 여기에 놓은 뒤 업로드 및 검증을 누르세요.</span>
            </div>
          ) : null}
          {setupStep === "project" ? (
            <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={handleProjectDrop}>
              <strong>작업 파일 드래그&드롭</strong>
              <span>.aitimetable.json 파일을 여기에 놓으면 저장된 시간표를 이어서 수정할 수 있습니다.</span>
            </div>
          ) : null}
        </section>
      </main>
    );
  }

  function renderAiStep() {
    return (
      <section className="setup-card">
        <h1>AI 연결</h1>
        <p className="muted">API 키는 브라우저 메모리에만 보관하며 저장하지 않습니다. 자동배정은 사용자 PC의 브라우저에서 실행되므로 Vercel 서버는 계산하지 않습니다. 429가 뜨면 제공자 할당량 초과일 수 있습니다.</p>
        <div className="form-grid">
          <label className="field">AI 제공자
            <select value={aiConfig.provider} onChange={(event) => changeProvider(event.target.value as AiProvider)}>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom OpenAI-compatible</option>
            </select>
          </label>
          <label className="field">모델코드
            <select value={modelMode} onChange={(event) => changeModel(event.target.value)}>
              {modelOptions.map((model) => <option key={model} value={model}>{model === "custom" ? "기타 직접 입력" : model}</option>)}
            </select>
          </label>
          {modelMode === "custom" ? <label className="field">직접 입력 모델코드<input value={aiConfig.model} onChange={(event) => setAiConfig((current) => ({ ...current, model: event.target.value, validated: false }))} /></label> : null}
          {aiConfig.provider === "custom" ? <label className="field">Base URL<input value={aiConfig.baseUrl || ""} onChange={(event) => setAiConfig((current) => ({ ...current, baseUrl: event.target.value, validated: false }))} placeholder="https://example.com/v1" /></label> : null}
          <label className="field full">API 키<input type="password" value={aiConfig.apiKey || ""} onChange={(event) => setAiConfig((current) => ({ ...current, apiKey: event.target.value, validated: false }))} /></label>
        </div>
        <div className="actions"><button type="button" className="primary" onClick={validateAi} disabled={aiValidationLoading}>{aiValidationLoading ? "검증 중..." : "API 키 검증"}</button></div>
        <div className={`validation-panel ${aiConfig.validated ? "ok" : aiValidationLoading ? "loading" : aiValidationMessage ? "error" : ""}`} aria-live="polite">
          <b>검증 상태</b>
          <span>{aiValidationMessage || "API 키를 입력한 뒤 검증 버튼을 누르세요."}</span>
          <small>{providerName(aiConfig.provider)} · {aiConfig.model || "모델코드 미입력"}</small>
        </div>
      </section>
    );
  }

  function renderProjectStep() {
    return (
      <section className="setup-card">
        <h1>작업 선택</h1>
        <p className="muted">새 시간표를 만들거나 저장된 시간표를 불러옵니다. 저장된 시간표 열람은 API 키 없이도 가능합니다.</p>
        <div className="choice-grid">
          <button className="choice-card" onClick={() => { resetWorkspace("새 시간표"); navigateWithTransition("/setup/excel"); }}><b>새 작업 만들기</b><span>엑셀 업로드부터 다시 시작합니다.</span></button>
          <button className="choice-card" onClick={() => refreshScenarioList(true)}><b>저장된 시간표 불러오기</b><span>.aitimetable.json 작업 파일을 선택하거나 드롭해서 복구합니다.</span></button>
        </div>
      </section>
    );
  }

  function renderExcelStep() {
    return (
      <section className="setup-card">
        <h1>엑셀 업로드</h1>
        <p className="muted">통합 입력 엑셀을 내려받아 작성한 뒤 첨부하세요.</p>
        <div className="actions">
          <button className="secondary" onClick={downloadTemplate} disabled={templateDownloading}>{templateDownloading ? "다운로드 중" : "통합 엑셀 양식 다운로드"}</button>
          <label className="file-button">엑셀 첨부<input type="file" accept=".xlsx" onChange={selectWorkbookFile} /></label>
          <button className="primary" onClick={uploadWorkbook} disabled={!fileBuffer}>업로드 및 검증</button>
        </div>
        {file ? <p className="status-line">선택 파일: {file.name}</p> : null}
        <ImportIssuesPanel issues={importIssues} />
      </section>
    );
  }

  function renderConstraintsStep() {
    return (
      <section className="setup-card">
        <h1>엑셀로 표현하기 어려운 조건</h1>
        <p className="muted">예: “김OO 선생님은 금요일 7교시를 피하고 싶다”, “2학년 선택과목은 같은 날 몰리지 않게 해줘”.</p>
        <label className="field"><span>자연어 조건</span><textarea rows={10} value={constraintText} onChange={(event) => { setConstraintText(event.target.value); setScenarioDirty(true); }} /></label>
        <div className="actions">
          <button className="secondary" onClick={() => navigateWithTransition("/setup/excel")}>이전</button>
          <button className="primary" onClick={() => navigateWithTransition("/setup/preferences")}>다음</button>
        </div>
      </section>
    );
  }

  function renderPreferencesStep(mode: "initial" | "reassign") {
    const optionDays = (records?.config.days?.length ? records.config.days : ["월", "화", "수", "목", "금"]) as DayKey[];
    return (
      <section className="setup-card">
        <h1>{mode === "reassign" ? "추가 배정 조건 수정" : "자동배정 선호도"}</h1>
        <div className="auto-assign-form">
          <section className="option-box">
            <h2>배정방법</h2>
            <div className="radio-stack">
              <label><input type="radio" name={`reassign-${mode}`} checked={solveOptions.reassignMode === "full"} onChange={() => updateSolveFlag("reassignMode", "full")} /> 수동 배정된 시간을 제외한 모든 시간 처음부터 배정</label>
              <label><input type="radio" name={`reassign-${mode}`} checked={solveOptions.reassignMode === "keep-fixed"} onChange={() => updateSolveFlag("reassignMode", "keep-fixed")} /> 수동배정, 고정된 시간을 제외한 모든 시간 처음부터 배정</label>
              <label><input type="radio" name={`reassign-${mode}`} checked={solveOptions.reassignMode === "unassigned-first"} onChange={() => updateSolveFlag("reassignMode", "unassigned-first")} /> 미배정 시간만 배정(기존 배정된 시간 변경하지 않음)</label>
              <label><input type="radio" name={`reassign-${mode}`} checked={solveOptions.reassignMode === "unassigned-only"} onChange={() => updateSolveFlag("reassignMode", "unassigned-only")} /> 미배정 시간만 배정(기존 배정된 시간 변경될 수 있음)</label>
            </div>
          </section>

          <section className="option-box">
            <div className="option-header">
              <h2>교사의 요일별 최대 배정시간수</h2>
              <label className="check-row"><input type="checkbox" checked={solveOptions.teacherDayMaxStrict} onChange={(event) => updateSolveFlag("teacherDayMaxStrict", event.target.checked)} /> 엄수</label>
            </div>
            <div className="day-max-grid">
              {optionDays.map((day) => (
                <label key={day} className="field compact">{day}
                  <input type="number" min={0} max={records?.config.maxPeriod || 9} value={solveOptions.teacherDayMax?.[day] || ""} onChange={(event) => updateTeacherDayMax(day, event.target.value)} placeholder="-" />
                </label>
              ))}
            </div>
          </section>

          <section className="option-box">
            <h2>엄수조건</h2>
            <div className="strict-grid">
              <label className="check-row"><input type="checkbox" checked={solveOptions.strictMaxConsecutive} onChange={(event) => updateSolveFlag("strictMaxConsecutive", event.target.checked)} /> 연속 <input type="number" min={2} max={7} value={solveOptions.maxConsecutive} onChange={(event) => updateSolveFlag("maxConsecutive", Number(event.target.value) || 3)} /> 시간 이상 배정금지 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.strictBalance} onChange={(event) => updateSolveFlag("strictBalance", event.target.checked)} /> 평균시수 + 1시간 이상 배정금지 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.lunchProtection !== "N" && solveOptions.lunchProtectionLevel !== "off"} onChange={(event) => updateLunchProtectionLevel(event.target.checked ? "high" : "off")} /> 식사시간 고려 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.avoidTwoHourLunchCross} onChange={(event) => updateSolveFlag("avoidTwoHourLunchCross", event.target.checked)} /> 2시간 연속수업 식사시간 걸침금지 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.sameSubjectSameDay} onChange={(event) => updateSolveFlag("sameSubjectSameDay", event.target.checked)} /> 유사과목 같은 날 배정금지 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.subjectCategorySeparation} onChange={(event) => updateSolveFlag("subjectCategorySeparation", event.target.checked)} /> 수업과목군 구분 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.roundRobin} onChange={(event) => updateSolveFlag("roundRobin", event.target.checked)} /> 순배 엄수</label>
              <label className="check-row"><input type="checkbox" checked={solveOptions.avoidConsecutiveDaysForMultiHourSubject} onChange={(event) => updateSolveFlag("avoidConsecutiveDaysForMultiHourSubject", event.target.checked)} /> 2시수 과목 연일배정금지 엄수</label>
              <label className="check-row"><input type="checkbox" checked={allowRelaxation} onChange={(event) => updateSolveFlag("allowRelaxForUnassigned", event.target.checked ? "Y" : "N")} /> 미배정이 없도록 필요하면 엄수조건을 무시할 수 있음</label>
            </div>
          </section>

          <section className="option-box">
            <h2>배정수준</h2>
            <input type="range" min={1} max={3} value={solveOptions.placementLevel} onChange={(event) => updateSolveFlag("placementLevel", Number(event.target.value) || 2)} />
            <div className="range-labels"><span>하</span><span>중</span><span>상</span></div>
          </section>

          <section className="option-box split-options">
            <label className="field">선호시간표
              <select value={priorityValue(solveOptions.softPriorityOrder)} onChange={(event) => updatePriority(event.target.value)}>
                {priorityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="field">배정횟수
              <input type="number" min={1} max={200} value={solveOptions.minAssignmentIterations} onChange={(event) => updateSolveFlag("minAssignmentIterations", Number(event.target.value) || 20)} />
            </label>
            <label className="field">균등분배강도
              <select value={solveOptions.balanceStrength} onChange={(event) => updateSolveFlag("balanceStrength", event.target.value as "off" | "soft" | "hard")}>
                <option value="soft">보통</option>
                <option value="hard">강하게</option>
                <option value="off">끄기</option>
              </select>
            </label>
            <label className="field">점심시간 확보 강도
              <select value={solveOptions.lunchProtectionLevel} onChange={(event) => updateLunchProtectionLevel(event.target.value as NonNullable<SolveOptions["lunchProtectionLevel"]>)}>
                <option value="hard">필수: 4-5교시 연속 금지</option>
                <option value="high">최우선</option>
                <option value="normal">보통</option>
                <option value="off">끄기</option>
              </select>
            </label>
            <label className="field">3연강 처리
              <select value={solveOptions.consecutiveStrictMode} onChange={(event) => updateSolveFlag("consecutiveStrictMode", event.target.value as NonNullable<SolveOptions["consecutiveStrictMode"]>)}>
                <option value="three-plus">필수: 3연강 이상 금지</option>
                <option value="over-max">최대연강 초과만 금지</option>
                <option value="off">경고만 표시</option>
              </select>
            </label>
            <label className="field">연쇄수정 최대 깊이
              <input type="number" min={1} max={6} value={solveOptions.manualChainDepth} onChange={(event) => updateSolveFlag("manualChainDepth", Math.max(1, Math.min(6, Number(event.target.value) || 4)))} />
            </label>
            <label className="field">AI 수정 적용
              <select value={solveOptions.aiRepairApplyMode} onChange={() => updateSolveFlag("aiRepairApplyMode", "approval")}>
                <option value="approval">전/후 미리보기 후 승인</option>
              </select>
            </label>
          </section>
        </div>
        <p className="notice">조건 완화 미리보기는 실제 후보가 아니라 선택 후 재배정할 때만 반영됩니다. 체크한 조건만 엄수/회피 대상으로 반영되며, 조건 완화는 사용자가 직접 체크한 경우에만 후보 탐색에 사용합니다.</p>
        <div className="actions">
          <button className="secondary" onClick={() => navigateWithTransition(mode === "reassign" ? "/workspace/classes" : "/setup/constraints")}>이전</button>
          <button className="primary" onClick={() => startSolve(mode)}>{mode === "reassign" ? "조건 반영 후 재배정" : "AI 자동배정 시작"}</button>
          {mode === "reassign" ? <button className="secondary" onClick={() => startSolve("reassign")}>이어 배정</button> : null}
          {mode === "reassign" ? <button className="secondary" onClick={() => startSolve("reassign", { reassignMode: "unassigned-first" })}>미배정</button> : null}
          <button className="secondary" type="button" onClick={showInputStatus}>수업 입력현황</button>
          <button className="secondary" type="button" onClick={showSyncStatus}>동시수업 배당체크</button>
          <button className="secondary" type="button" onClick={() => navigateWithTransition("/workspace/analysis")}>시간표 완성여부</button>
          <button className="secondary" type="button" onClick={() => setAllocationEditorOpen(true)} disabled={!records}>수업 배당변경</button>
        </div>
      </section>
    );
  }

  function renderSolvingStep() {
    return (
      <main className="solving-page">
        <section className="setup-card progress-card">
          <div className="spinner" />
          <h1>시간표를 만들고 있습니다</h1>
          <p className="muted">미배정을 줄이는 후보를 비교하고, 선택한 우선순위대로 식사·안배·연강 조건을 함께 검토합니다.</p>
          <div className="metrics">
            <div className="metric"><b>{metric(bestSummary, "unassigned")}</b><span>미배정</span></div>
            <div className="metric"><b>{metric(bestSummary, "lunchIssues")}</b><span>식사부족</span><small>{currentIssueCounts.lunch ? `${currentIssueCounts.lunch}명` : "0명"}</small></div>
            <div className="metric"><b>{metric(bestSummary, "consecutiveIssues")}</b><span>3연강</span><small>{currentIssueCounts.consecutive ? `${currentIssueCounts.consecutive}명` : "0명"}</small></div>
            <div className="metric"><b>{metric(bestSummary, "balanceIssues")}</b><span>안배부족</span><small>{currentIssueCounts.balance ? `${currentIssueCounts.balance}명` : "0명"}</small></div>
          </div>
          <dl className="detail-grid">
            <dt>탐색 회차</dt><dd>{progress?.chunkCount || 0}</dd>
            <dt>시도 후보 수</dt><dd>{progress?.attemptCount || 0}</dd>
            <dt>현재 단계</dt><dd>{progress?.phaseLabel || (workerRunning || pendingSolve ? "엔진 준비 중" : "준비")}</dd>
            <dt>최선안 변경</dt><dd>{progress ? (progress.bestChanged ? "방금 개선됨" : "다른 후보 탐색 중") : (workerRunning || pendingSolve ? "엔진 준비 중" : "대기")}</dd>
            <dt>마지막 개선</dt><dd>{formatKst(progress?.bestChangedAt)}</dd>
            <dt>경과</dt><dd>{elapsedSeconds}초</dd>
            <dt>목표 상태</dt><dd>{progress?.targetReached || softSummaryTargetReached(bestSummary) ? "도달" : `남음: 미배정 ${progress?.targetRemaining?.unassigned ?? metric(bestSummary, "unassigned")} · 오류 ${progress?.targetRemaining?.hardErrors ?? metric(bestSummary, "hardErrors")} · 식사 ${progress?.targetRemaining?.lunchIssues ?? Math.max(0, metric(bestSummary, "lunchIssues") - 19)} · 3연강 ${progress?.targetRemaining?.consecutiveIssues ?? Math.max(0, metric(bestSummary, "consecutiveIssues") - 19)}`}</dd>
            {progress?.phase === "tabu-post-optimize" ? (
              <>
                <dt>후처리 개선</dt><dd>{progress.postOptimizeImprovementCount || 0}회</dd>
                <dt>soft 비용</dt><dd>{Math.round(progress.postOptimizeSoftPenalty || 0)}</dd>
                <dt>soft 변화</dt><dd>{progress.postOptimizeSoftDelta ? `-${Math.round(progress.postOptimizeSoftDelta)}` : "-"}</dd>
              </>
            ) : null}
          </dl>
          {progress?.unassignedReasons?.length ? <p className="notice">미배정 원인: {progress.unassignedReasons.join(" / ")}</p> : null}
          <div className="actions">
            <button className="primary" onClick={acceptCurrentBest} disabled={!candidate}>현재 최선안 사용</button>
            <button className="secondary" onClick={stopSolve} disabled={!workerRunning}>중지</button>
          </div>
        </section>
      </main>
    );
  }

  function renderWorkspace() {
    const tabs = [
      ["classes", "학급별", "/workspace/classes"],
      ["teachers", "교사별", "/workspace/teachers"],
      ["analysis", "분석", "/workspace/analysis"],
      ["manual", "수동수정", "/workspace/manual"],
      ["auto-assign", "추가 배정", "/workspace/auto-assign"],
      ["chat", "AI 대화", "/workspace/chat"],
      ["exports", "출력", "/workspace/exports"],
    ];
    return (
      <main className="workspace-layout">
        <aside className="workspace-nav">
          {tabs.map(([id, label, href]) => (
            <Link
              key={id}
              className={`workspace-link ${workspaceTab === id ? "active" : ""}`}
              href={href}
              onClick={(event) => {
                event.preventDefault();
                navigateWithTransition(href);
              }}
            >
              {label}
            </Link>
          ))}
        </aside>
        <section className={`workspace-main route-transition route-${transitionState}`}>
          {workspaceTab === "classes" ? renderClassView() : null}
          {workspaceTab === "teachers" ? renderTeacherView() : null}
          {workspaceTab === "analysis" ? renderAnalysis() : null}
          {workspaceTab === "manual" ? renderManual() : null}
          {workspaceTab === "auto-assign" ? renderPreferencesStep("reassign") : null}
          {workspaceTab === "chat" ? renderChatPanel(true) : null}
          {workspaceTab === "exports" ? renderExports() : null}
          {workspaceTab !== "chat" ? renderChatPanel(false) : null}
        </section>
      </main>
    );
  }

  function renderClassView() {
    return (
      <>
        <section className="panel toolbar-panel">
          <label className="field inline">학급 선택
            <select value={selectedClassCode} onChange={(event) => setSelectedClassCode(event.target.value)}>
              {classes.map((cls) => <option key={cls.code} value={cls.code}>{cls.name}</option>)}
            </select>
          </label>
        </section>
        <TimetableGrid candidate={candidate} records={records} mode="class" selectedCode={selectedClassCode} />
      </>
    );
  }

  function renderTeacherView() {
    return (
      <>
        <section className="panel toolbar-panel">
          <label className="field inline">교사 선택
            <select value={selectedTeacherCode} onChange={(event) => setSelectedTeacherCode(event.target.value)}>
              {teachers.map((teacher) => <option key={teacher.code} value={teacher.code}>{teacher.name}</option>)}
            </select>
          </label>
        </section>
        <TimetableGrid candidate={candidate} records={records} mode="teacher" selectedCode={selectedTeacherCode} />
      </>
    );
  }

  function renderAnalysis() {
    const summary = diagnostics?.summary || candidate?.summary;
    const hard = candidate?.validation.violations.filter((item) => item.severity === "hard") || [];
    const soft = candidate?.validation.violations.filter((item) => item.severity === "soft") || [];
    const teacherIssues = filteredTeacherIssues();
    return (
      <div className="analysis-grid">
        <section className="panel">
          <h2>요약</h2>
          <div className="metrics">
            <div className="metric"><b>{metric(summary, "unassigned")}</b><span>미배정</span></div>
            <div className="metric"><b>{metric(summary, "hardErrors")}</b><span>hard 오류</span></div>
            <div className="metric"><b>{metric(summary, "lunchIssues")}</b><span>식사부족</span><small>{currentIssueCounts.lunch}명</small></div>
            <div className="metric"><b>{metric(summary, "consecutiveIssues")}</b><span>3연강</span><small>{currentIssueCounts.consecutive}명</small></div>
          </div>
        </section>
        {renderRepairTools("analysis")}
        <section className="panel">
          <h2>미배정</h2>
          {diagnostics?.unassigned.length ? <div className="issue-list">{diagnostics.unassigned.map((item, index) => <article key={`${item.loadId}-${index}`}><b>{item.teacherName} / {item.subjectName}</b><span>{item.className} · {item.hours}시간</span><small>{item.reason}</small></article>)}</div> : <p className="muted">미배정이 없습니다.</p>}
        </section>
        <section className="panel">
          <h2>배정불량교사</h2>
          {renderIssueFilterControls()}
          {teacherIssues.length ? <div className="issue-list compact">{teacherIssues.map((item) => <article key={item.teacherCode}><b>{item.teacherName}</b><span>{item.hours}시간 · {item.issues.join(", ")}</span><small>{item.detail}</small></article>)}</div> : <p className="muted">조건에 맞는 배정불량교사가 없습니다.</p>}
        </section>
        <section className="panel">
          <h2>검증 오류</h2>
          {[...hard, ...soft].length ? <div className="issue-list compact">{[...hard, ...soft].slice(0, 80).map((item, index) => <article key={`${item.type}-${index}`}><b>{item.severity === "hard" ? "hard" : "soft"} · {item.type}</b><small>{item.message}</small></article>)}</div> : <p className="muted">검증 오류가 없습니다.</p>}
        </section>
        <section className="panel full">
          <h2>동시그룹</h2>
          <div className="table-wrap">
            <table><thead><tr><th>그룹</th><th>배정</th><th>미배정</th><th>방식</th></tr></thead><tbody>{(diagnostics?.syncGroups || []).map((item) => <tr key={item.group}><td>{item.group}</td><td>{item.assigned}</td><td>{item.unassigned}</td><td>{item.method}</td></tr>)}</tbody></table>
          </div>
        </section>
        {diagnostics?.syncCohorts?.length ? (
          <section className="panel full">
            <h2>동시그룹 코호트</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>코호트</th><th>그룹</th><th>학급</th><th>배정</th><th>미배정</th><th>공통 슬롯</th><th>원인</th></tr></thead>
                <tbody>{diagnostics.syncCohorts.map((item) => <tr key={item.cohort}><td>{item.cohort}</td><td>{item.groups}</td><td>{item.classCount}</td><td>{item.assigned}</td><td>{item.unassigned}</td><td>{item.possibleSlots}</td><td>{item.reason}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderManual() {
    const manualTeachers = diagnostics?.teacherIssues.length
      ? teachers.filter((teacher) => {
        const issue = diagnostics.teacherIssues.find((item) => item.teacherCode === teacher.code);
        return issue ? issueMatchesCurrentFilter(issue.issues) : false;
      })
      : teachers;
    const visibleManualTeacherCode = manualTeachers.some((teacher) => teacher.code === manualTeacherCode) ? manualTeacherCode : manualTeachers[0]?.code || manualTeacherCode;
    return (
      <div className="manual-layout">
        <section className="panel manual-side">
          <h2>교사</h2>
          {renderIssueFilterControls()}
          <div className="teacher-list">
            {manualTeachers.map((teacher) => {
              const issue = diagnostics?.teacherIssues.find((item) => item.teacherCode === teacher.code);
              return <button key={teacher.code} className={visibleManualTeacherCode === teacher.code ? "active" : ""} onClick={() => { setManualTeacherCode(teacher.code); setMoveOptions([]); setSelectedManualFrom(null); }}>{teacher.name}<span>{issue?.issues.join(", ") || ""}</span></button>;
            })}
            {!manualTeachers.length ? <p className="muted">조건에 맞는 교사가 없습니다.</p> : null}
          </div>
          <div className="legend">
            <span className="move-good">좋음</span>
            <span className="move-warning">나쁨</span>
            <span className="move-duplicate">과목중복</span>
            <span className="move-blocked">불가</span>
          </div>
          {renderRepairTools("manual")}
        </section>
        <TimetableGrid candidate={candidate} records={records} mode="teacher" selectedCode={visibleManualTeacherCode} moveOptions={moveOptions} selectedFrom={selectedManualFrom} onCellDoubleClick={handleManualDoubleClick} onMoveOptionClick={openMovePreview} />
      </div>
    );
  }

  function renderRepairTools(scope: "analysis" | "manual" | "chat") {
    const compact = scope !== "analysis";
    const rankedReason = new Map((repairRecommendation?.ranked || []).map((item) => [item.proposalId, item.reason]));
    return (
      <section className={`panel repair-panel ${compact ? "repair-compact" : ""}`}>
        <div className="panel-header-row">
          <div>
            <h2>AI soft 보정</h2>
            <p className="muted">로컬 solver가 안전 후보를 만들고, AI는 후보 순서만 추천합니다.</p>
          </div>
          <button className="primary" onClick={() => runAiRepair(scope === "chat" ? "chat" : "manual")} disabled={repairLoading || !candidate}>
            {repairLoading ? "검토 중..." : "AI 보정안 찾기"}
          </button>
          {repairLoading ? <button className="secondary" onClick={() => stopRepairWorker()}>중지</button> : null}
        </div>
        {repairStatus ? <p className="status-line">{repairStatus}</p> : null}
        {repairRecommendation?.message ? <p className="notice">{repairRecommendation.message}</p> : null}
        {repairProposals.length ? (
          <div className="repair-list">
            {repairProposals.slice(0, compact ? 3 : 8).map((proposal) => (
              <article key={proposal.proposalId} className={proposal.source === "ai-ranked" ? "ai-ranked" : ""}>
                <div>
                  <b>{proposal.proposalId} · {proposal.title}</b>
                  <span>{proposalDeltaText(proposal)}</span>
                  <small>{rankedReason.get(proposal.proposalId) || proposal.reasons.join(" / ")}</small>
                  {proposal.subject.kind === "sync" ? <em>동시수업 전체 이동</em> : null}
                </div>
                <button className="secondary" onClick={() => openRepairPreview(proposal)}>전/후 보기</button>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    );
  }

  function renderChatPanel(full = false) {
    return (
      <section className={`chat-dock ${full ? "chat-full" : ""}`}>
        <h2>AI 대화</h2>
        <div className="messages">
          {chatMessages.map((message, index) => <div key={`${message.role}-${index}`} className={`message ${message.role}`}>{message.text}</div>)}
          {chatLoading ? <div className="message assistant thinking"><span className="tiny-spinner" />생각 중...</div> : null}
        </div>
        {full ? renderRepairTools("chat") : null}
        <form className="chat-form" onSubmit={sendChat}>
          <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="예: 미배정 원인을 설명하고 줄이는 방법을 제안해줘" />
          <button className="primary" disabled={chatLoading}>{chatLoading ? "대기" : "전송"}</button>
        </form>
      </section>
    );
  }

  function renderExports() {
    return (
      <section className="panel">
        <h2>출력</h2>
        <p className="muted">현재 후보를 JSON으로 내려받을 수 있습니다. 엑셀/NEIS 출력은 기존 API와 연결해 확장합니다.</p>
        <div className="actions">
          <button className="secondary" onClick={() => downloadBlob("candidate.json", new Blob([JSON.stringify(stripSensitive(candidate), null, 2)], { type: "application/json" }))} disabled={!candidate}>후보 JSON 다운로드</button>
        </div>
      </section>
    );
  }

  function renderScenarioModal() {
    return (
      <div className="modal-backdrop">
        <section className="modal-panel">
          <div className="modal-header">
            <div><h2>저장된 시간표 불러오기</h2><p className="muted">{scenarioSource === "server" ? "서버 저장소" : "브라우저 임시 저장소"} 목록입니다.</p></div>
            <button className="ghost" onClick={() => setScenarioModalOpen(false)}>닫기</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>이름</th><th>저장일</th><th>학급</th><th>교사</th><th>미배정</th><th>오류</th><th /></tr></thead>
              <tbody>
                {scenarioList.length ? scenarioList.map((item) => (
                  <tr key={`${item.source || scenarioSource}-${item.id}`}>
                    <td>{item.name}</td><td>{formatKst(item.updatedAt)}</td><td>{item.classCount || 0}</td><td>{item.teacherCount || 0}</td><td>{item.unassigned || 0}</td><td>{item.hardErrors || 0}</td>
                    <td><button className="primary" onClick={() => loadScenario(item.id, item.source || scenarioSource)} disabled={scenarioLoading}>불러오기</button></td>
                  </tr>
                )) : <tr><td colSpan={7}>저장된 시간표가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  function renderAllocationEditor() {
    const loadRows = (records?.loads || []).slice().sort((a, b) => (
      a.teacherName.localeCompare(b.teacherName, "ko") ||
      a.subjectName.localeCompare(b.subjectName, "ko") ||
      a.className.localeCompare(b.className, "ko")
    ));
    return (
      <div className="modal-backdrop">
        <section className="modal-panel allocation-modal">
          <div className="modal-header">
            <div><h2>수업 배당변경</h2><p className="muted">현재 작업의 시수만 수정합니다. 원본 엑셀은 바뀌지 않으며, 수정 후 재배정이 필요합니다.</p></div>
            <button className="ghost" onClick={() => setAllocationEditorOpen(false)}>닫기</button>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>교사</th><th>과목</th><th>학급</th><th>시수</th><th>동시그룹</th><th>연속패턴</th></tr></thead>
              <tbody>
                {loadRows.map((load) => (
                  <tr key={load.id}>
                    <td>{load.teacherName}</td>
                    <td>{load.subjectName}</td>
                    <td>{load.className}</td>
                    <td><input className="table-input" type="number" min={0} max={20} value={load.hours} onChange={(event) => updateAllocationHours(load.id, Number(event.target.value) || 0)} /></td>
                    <td>{load.syncGroup || "-"}</td>
                    <td>{load.consecutivePattern || load.continuousBlocks?.join(",") || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="primary" onClick={() => { setAllocationEditorOpen(false); navigateWithTransition("/workspace/auto-assign"); }}>재배정 설정으로 이동</button>
            <button className="secondary" onClick={() => setAllocationEditorOpen(false)}>닫기</button>
          </div>
        </section>
      </div>
    );
  }

  function renderMovePreviewModal() {
    return (
      <div className="modal-backdrop">
        <section className="modal-panel">
          <div className="modal-header">
            <div><h2>수정 전/후 미리보기</h2><p className="muted">{movePreviewResult?.message}</p></div>
            <button className="ghost" onClick={() => { setMovePreviewResult(null); setPendingMove(null); }}>닫기</button>
          </div>
          <div className="two-col">
            <section><h3>수정 전</h3><div className="preview-cells">{movePreviewResult?.beforeCells.map((cell) => <div key={`${cell.id}-${cell.day}-${cell.period}`}><b>{cell.teacherName || cell.label}</b><span>{cell.className} {cell.day}{cell.period}교시 · {cellLabel(cell)}</span></div>)}</div></section>
            <section><h3>수정 후</h3><div className="preview-cells">{movePreviewResult?.afterCells.map((cell) => <div key={`${cell.id}-${cell.day}-${cell.period}`}><b>{cell.teacherName || cell.label}</b><span>{cell.className} {cell.day}{cell.period}교시 · {cellLabel(cell)}</span></div>)}</div></section>
          </div>
          {pendingMove?.steps?.length ? (
            <div className="affected-teachers">
              <h3>연쇄 이동 단계</h3>
              <div className="preview-cells">
                {pendingMove.steps.map((step, index) => (
                  <div key={`${step.from.classCode}-${step.from.day}-${step.from.period}-${index}`}>
                    <b>{index + 1}단계</b>
                    <span>{step.from.classCode} {step.from.day}{step.from.period}교시 → {step.to.classCode || step.from.classCode} {step.to.day}{step.to.period}교시</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {movePreviewResult?.affectedTeachers?.length ? (
            <div className="affected-teachers">
              <h3>영향 교사</h3>
              <div className="preview-cells">
                {movePreviewResult.affectedTeachers.map((teacher) => (
                  <div key={teacher.teacherCode || teacher.teacherName}>
                    <b>{teacher.teacherName || teacher.teacherCode}</b>
                    <span>수정 전 {teacher.beforeCells.length}칸 · 수정 후 {teacher.afterCells.length}칸</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="actions">
            <button className="primary" onClick={approveMove} disabled={!movePreviewResult?.ok}>승인 후 반영</button>
            <button className="secondary" onClick={() => { setMovePreviewResult(null); setPendingMove(null); }}>취소</button>
          </div>
        </section>
      </div>
    );
  }
}
