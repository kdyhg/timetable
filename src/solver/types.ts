export type DayKey = "월" | "화" | "수" | "목" | "금" | "토" | "일";

export type SoftPriority = "consecutive" | "balance" | "lunch";

export type Teacher = {
  code: string;
  name: string;
  lunchPeriod?: number;
  unavailable?: string;
};

export type ClassInfo = {
  code: string;
  name: string;
  grade: string;
  track: string;
  homeroomTeacherName?: string;
  dayLimits: Record<string, number>;
  virtual?: boolean;
};

export type Subject = {
  code: string;
  name: string;
  shortName: string;
  neisName?: string;
  similarGroup?: string;
};

export type Room = {
  code: string;
  name: string;
  unavailable?: string;
};

export type LoadUnit = {
  id: string;
  teacherCode: string;
  teacherName: string;
  subjectCode: string;
  subjectName: string;
  classCode: string;
  className: string;
  hours: number;
  roomCode?: string;
  roomName?: string;
  syncGroup?: string;
  consecutivePattern?: string;
  continuousBlocks?: number[];
  blockId?: string;
  blockIndex?: number;
  blockPart?: number;
  blockSize?: number;
  coTeacherGroup?: string;
  pressure: number;
};

export type FixedCell = {
  id: string;
  classCode: string;
  day: DayKey;
  period: number;
  label: string;
  teacherName?: string;
  source: "fixed";
};

export type ScheduleCell = {
  id: string;
  classCode: string;
  className: string;
  day: DayKey;
  period: number;
  teacherCode?: string;
  teacherName?: string;
  subjectCode?: string;
  subjectName?: string;
  roomCode?: string;
  roomName?: string;
  syncGroup?: string;
  syncOccurrenceId?: string;
  blockId?: string;
  blockPart?: number;
  blockSize?: number;
  fixed?: boolean;
  label?: string;
};

export type NormalizedRecords = {
  config: {
    days: DayKey[];
    maxPeriod: number;
    lunchPeriod: number;
    lunchProtection: boolean;
    maxConsecutive: number;
    balanceStrength: "off" | "soft" | "hard";
    title?: string;
  };
  teachers: Record<string, Teacher>;
  classes: Record<string, ClassInfo>;
  subjects: Record<string, Subject>;
  rooms: Record<string, Room>;
  loads: LoadUnit[];
  fixed: FixedCell[];
  constraints: ConstraintRule[];
  issues: ImportIssue[];
  stats: Record<string, number>;
};

export type ConstraintRule = {
  targetType: string;
  targetName: string;
  conditionType: string;
  day?: string;
  periods: number[];
  strength: "hard" | "soft" | "wish";
  priority: number;
  description?: string;
};

export type ImportIssue = {
  severity: "error" | "warning";
  sheet: string;
  row: number;
  column: string;
  message: string;
  fix: string;
};

export type SolveOptions = {
  searchStrength?: "quick" | "strong";
  variationMode?: "quality-first" | "varied";
  allowRelaxForUnassigned?: "Y" | "N";
  maxConsecutive?: number;
  lunchProtection?: "Y" | "N";
  lunchProtectionLevel?: "off" | "normal" | "high" | "hard";
  balanceStrength?: "off" | "soft" | "hard";
  naturalLanguageConstraints?: string;
  softPriorityOrder?: SoftPriority[];
  reassignMode?: "full" | "keep-fixed" | "unassigned-first" | "unassigned-only";
  teacherDayMax?: Partial<Record<DayKey, number>>;
  teacherDayMaxStrict?: boolean;
  strictMaxConsecutive?: boolean;
  strictBalance?: boolean;
  strictLunch?: boolean;
  avoidTwoHourLunchCross?: boolean;
  sameSubjectSameDay?: boolean;
  subjectCategorySeparation?: boolean;
  roundRobin?: boolean;
  avoidConsecutiveDaysForMultiHourSubject?: boolean;
  placementLevel?: number;
  minAssignmentIterations?: number;
  consecutiveWarnThreshold?: number;
  consecutiveStrictMode?: "off" | "three-plus" | "over-max";
  manualChainDepth?: number;
  aiRepairApplyMode?: "approval";
};

export type Schedule = {
  days: DayKey[];
  periods: number[];
  classes: Record<string, { className: string; grid: Record<string, Record<string, ScheduleCell | null>> }>;
};

export type Candidate = {
  id: string;
  name: string;
  schedule: Schedule;
  unassigned: UnassignedItem[];
  validation: ValidationResult;
  teacherIssues: TeacherIssue[];
  summary: SolveSummary;
  relaxations: string[];
  signature: string;
};

export type UnassignedItem = {
  loadId: string;
  teacherName: string;
  subjectName: string;
  className: string;
  hours: number;
  reason: string;
};

export type ValidationResult = {
  hardErrors: number;
  lunchIssues: number;
  consecutiveIssues: number;
  balanceIssues: number;
  violations: Array<{ type: string; message: string; severity: "hard" | "soft"; teacherCode?: string; day?: DayKey; periods?: number[]; runLength?: number }>;
};

export type TeacherIssue = {
  teacherCode: string;
  teacherName: string;
  hours: number;
  issues: string[];
  detail: string;
};

export type SolveSummary = {
  unassigned: number;
  hardErrors: number;
  lunchIssues: number;
  consecutiveIssues: number;
  balanceIssues: number;
  signature?: string;
};

export type SolverProgress = {
  chunkCount: number;
  attemptCount: number;
  phase: "preprocess" | "bottleneck-csp" | "grade-csp" | "repair" | "ga-quality" | "tabu-post-optimize" | "accepted";
  phaseLabel?: string;
  bestChanged: boolean;
  bestChangedAt: string;
  bestSummary: SolveSummary;
  activeProfiles: string[];
  lastResultSummary?: SolveSummary;
  unassignedReasons?: string[];
  postOptimizeImprovementCount?: number;
  postOptimizeSoftPenalty?: number;
  postOptimizeSoftDelta?: number;
  targetReached?: boolean;
  targetRemaining?: {
    unassigned: number;
    hardErrors: number;
    lunchIssues: number;
    consecutiveIssues: number;
  };
};

export type ManualMoveStep = {
  from: { classCode: string; day: DayKey; period: number };
  to: { classCode?: string; day: DayKey; period: number };
};

export type ManualMove = ManualMoveStep & {
  mode?: "move" | "swap";
  steps?: ManualMoveStep[];
  chainLabel?: string;
};

export type MoveQuality = "good" | "warning" | "duplicate-subject" | "blocked";

export type ManualMoveCandidate = {
  move: ManualMove;
  steps?: ManualMoveStep[];
  depth?: number;
  affectedTeachers?: string[];
  chainLabel?: string;
  applies?: boolean;
  failureReason?: string;
  quality: MoveQuality;
  score: number;
  reasons: string[];
  preview: MovePreview;
  delta?: MoveDelta;
};

export type MoveSubject = {
  kind: "single" | "sync" | "continuous";
  id: string;
  label: string;
  cells: ScheduleCell[];
};

export type MoveDelta = {
  unassigned: number;
  hardErrors: number;
  lunchIssues: number;
  consecutiveIssues: number;
  balanceIssues: number;
  softPenalty: number;
};

export type MoveProposal = {
  proposalId: string;
  title: string;
  move: ManualMove;
  subject: MoveSubject;
  delta: MoveDelta;
  score: number;
  reasons: string[];
  preview: MovePreview;
  affectedTeachers?: string[];
  source: "local" | "ai-ranked";
};

export type AiRepairRecommendation = {
  provider: "local" | "ai";
  ranked: Array<{ proposalId: string; reason: string; priority?: number }>;
  message: string;
};

export type MovePreview = {
  ok: boolean;
  message: string;
  failureReason?: string;
  beforeCells: ScheduleCell[];
  afterCells: ScheduleCell[];
  affectedTeachers?: Array<{ teacherCode?: string; teacherName?: string; beforeCells: ScheduleCell[]; afterCells: ScheduleCell[] }>;
};

export type WorkerRequest =
  | { type: "init"; records: NormalizedRecords; solveOptions: SolveOptions; naturalLanguageConstraints?: string; candidate?: Candidate | null }
  | { type: "start" }
  | { type: "continue" }
  | { type: "acceptBest" }
  | { type: "stop" }
  | { type: "moveOptions"; from: ManualMove["from"] }
  | { type: "movePreview"; move: ManualMove }
  | { type: "moveApply"; move: ManualMove }
  | { type: "repairOptions" }
  | { type: "repairPreview"; proposal: MoveProposal }
  | { type: "repairApply"; proposal: MoveProposal }
  | { type: "reassign"; solveOptions: SolveOptions; candidate?: Candidate | null };

export type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; progress: SolverProgress }
  | { type: "bestChanged"; candidate: Candidate; progress: SolverProgress; diagnostics: Diagnostics }
  | { type: "diagnostics"; diagnostics: Diagnostics }
  | { type: "accepted"; candidate: Candidate; diagnostics: Diagnostics }
  | { type: "moveOptions"; options: ManualMoveCandidate[] }
  | { type: "movePreview"; preview: MovePreview }
  | { type: "moveApplied"; candidate: Candidate; diagnostics: Diagnostics }
  | { type: "repairOptions"; proposals: MoveProposal[] }
  | { type: "repairPreview"; preview: MovePreview }
  | { type: "repairApplied"; candidate: Candidate; diagnostics: Diagnostics }
  | { type: "stopped" }
  | { type: "error"; message: string };

export type Diagnostics = {
  unassigned: UnassignedItem[];
  teacherIssues: TeacherIssue[];
  syncGroups: Array<{ group: string; assigned: number; unassigned: number; method: string }>;
  syncCohorts?: Array<{ cohort: string; groups: string; classCount: number; assigned: number; unassigned: number; possibleSlots: number; reason: string }>;
  neis: Array<{ type: string; message: string }>;
  summary: SolveSummary;
};
