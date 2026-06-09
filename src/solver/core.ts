import type {
  Candidate,
  DayKey,
  Diagnostics,
  FixedCell,
  LoadUnit,
  ManualMove,
  ManualMoveStep,
  ManualMoveCandidate,
  MoveDelta,
  MovePreview,
  MoveProposal,
  MoveSubject,
  NormalizedRecords,
  Schedule,
  ScheduleCell,
  SolveOptions,
  SolveSummary,
  SolverProgress,
  SoftPriority,
  TeacherIssue,
  UnassignedItem,
  ValidationResult,
} from "@/solver/types";

type Runtime = {
  records: NormalizedRecords;
  options: Required<SolveOptions>;
  best: Candidate | null;
  lastResult: Candidate | null;
  chunkCount: number;
  attemptCount: number;
  bestChangedAt: string;
  stopped: boolean;
  lastReasons: string[];
  postOptimizeImprovementCount: number;
  postOptimizeSoftPenalty: number;
  postOptimizeSoftDelta: number;
  softStagnation: number;
  lastTargetDebt: number;
};

function nowKst() {
  return new Date().toISOString();
}

type Slot = { day: DayKey; period: number; score?: number };
type SubjectDayEntry = { key: string; scope: string; subjectCode?: string; blockId?: string };
type UnitKind = "sync" | "continuous" | "bottleneck" | "grade" | "normal";
type WorkUnit = {
  id: string;
  kind: UnitKind;
  loads: LoadUnit[];
  pressure: number;
  possibleSlots: number;
  domainSize: number;
  degree: number;
  teacherGradeSpan: number;
  roomScarcity: number;
  hardBanCount: number;
  syncSize: number;
  syncGroup?: string;
  syncOccurrenceId?: string;
  syncCohortKey?: string;
  syncCohortSize?: number;
  syncCohortStage?: "cohort" | "single";
  placementStage: "sync-first" | "bottleneck" | "grade" | "normal" | "continuous";
  grade: string;
};

type ChainSearchBudget = {
  deadline: number;
  nodes: number;
  maxNodes: number;
};

type ScheduleCache = {
  cells: ScheduleCell[];
  teacherCells: Map<string, ScheduleCell[]>;
  teacherBusy: Set<string>;
  roomBusy: Set<string>;
};

type CachedSchedule = Schedule & { __cache?: ScheduleCache };

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

const DEFAULT_PRIORITY_ORDER: SoftPriority[] = ["consecutive", "lunch", "balance"];

function normalizePriorityOrder(order?: SoftPriority[]) {
  const result: SoftPriority[] = [];
  for (const item of order || DEFAULT_PRIORITY_ORDER) {
    if ((item === "consecutive" || item === "balance" || item === "lunch") && !result.includes(item)) result.push(item);
  }
  for (const item of DEFAULT_PRIORITY_ORDER) if (!result.includes(item)) result.push(item);
  return result;
}

function softWeight(options: Required<SolveOptions>, key: SoftPriority) {
  const index = options.softPriorityOrder.indexOf(key);
  if (index === 0) return 3.2;
  if (index === 1) return 2.1;
  return 1.25;
}

function requiredOptions(options: SolveOptions): Required<SolveOptions> {
  return {
    searchStrength: options.searchStrength || "strong",
    variationMode: options.variationMode || "quality-first",
    allowRelaxForUnassigned: options.allowRelaxForUnassigned || "N",
    maxConsecutive: options.maxConsecutive || 3,
    lunchProtection: options.lunchProtection || "Y",
    lunchProtectionLevel: options.lunchProtectionLevel || (options.lunchProtection === "N" ? "off" : options.strictLunch ? "high" : "normal"),
    balanceStrength: options.balanceStrength || "soft",
    naturalLanguageConstraints: options.naturalLanguageConstraints || "",
    softPriorityOrder: normalizePriorityOrder(options.softPriorityOrder),
    reassignMode: options.reassignMode || "full",
    teacherDayMax: options.teacherDayMax || {},
    teacherDayMaxStrict: Boolean(options.teacherDayMaxStrict),
    strictMaxConsecutive: options.strictMaxConsecutive !== false,
    strictBalance: Boolean(options.strictBalance),
    strictLunch: Boolean(options.strictLunch),
    avoidTwoHourLunchCross: Boolean(options.avoidTwoHourLunchCross),
    sameSubjectSameDay: Boolean(options.sameSubjectSameDay),
    subjectCategorySeparation: Boolean(options.subjectCategorySeparation),
    roundRobin: Boolean(options.roundRobin),
    avoidConsecutiveDaysForMultiHourSubject: Boolean(options.avoidConsecutiveDaysForMultiHourSubject),
    placementLevel: options.placementLevel || 2,
    minAssignmentIterations: options.minAssignmentIterations || 20,
    consecutiveWarnThreshold: options.consecutiveWarnThreshold || 3,
    consecutiveStrictMode: options.consecutiveStrictMode || (options.strictMaxConsecutive ? "over-max" : "off"),
    manualChainDepth: options.manualChainDepth || 4,
    aiRepairApplyMode: "approval",
  };
}

export function createRuntime(records: NormalizedRecords, options: SolveOptions): Runtime {
  return {
    records,
    options: requiredOptions(options),
    best: null,
    lastResult: null,
    chunkCount: 0,
    attemptCount: 0,
    bestChangedAt: "",
    stopped: false,
    lastReasons: [],
    postOptimizeImprovementCount: 0,
    postOptimizeSoftPenalty: 0,
    postOptimizeSoftDelta: 0,
    softStagnation: 0,
    lastTargetDebt: Number.POSITIVE_INFINITY,
  };
}

function emptySchedule(records: NormalizedRecords): Schedule {
  const periods = Array.from({ length: records.config.maxPeriod }, (_, index) => index + 1);
  const classes: Schedule["classes"] = {};
  for (const cls of Object.values(records.classes)) {
    const grid: Record<string, Record<string, ScheduleCell | null>> = {};
    for (const day of records.config.days) {
      grid[day] = {};
      for (const period of periods) grid[day][String(period)] = null;
    }
    classes[cls.code] = { className: cls.name, grid };
  }
  return { days: records.config.days, periods, classes };
}

export function classMaxPeriodForDay(records: NormalizedRecords, classCode: string, day: DayKey) {
  const cls = records.classes[classCode];
  return cls?.dayLimits?.[day] || records.config.maxPeriod;
}

function isBeyondClassDayLimit(records: NormalizedRecords, classCode: string, day: DayKey, period: number) {
  return period > classMaxPeriodForDay(records, classCode, day);
}

function fixedCountForClassDay(records: NormalizedRecords, classCode: string, day: DayKey) {
  const limit = classMaxPeriodForDay(records, classCode, day);
  return records.fixed.filter((cell) => cell.classCode === classCode && cell.day === day && cell.period <= limit).length;
}

function teacherClassCodes(records: NormalizedRecords, teacherCode: string) {
  return [...new Set(records.loads.filter((load) => load.teacherCode === teacherCode).map((load) => load.classCode))];
}

function teacherAvailableCapacityForDay(records: NormalizedRecords, teacherCode: string, day: DayKey) {
  const classes = teacherClassCodes(records, teacherCode);
  if (!classes.length) return records.config.maxPeriod;
  const total = classes.reduce((sum, classCode) => {
    const available = classMaxPeriodForDay(records, classCode, day) - fixedCountForClassDay(records, classCode, day);
    return sum + Math.max(1, available);
  }, 0);
  return Math.max(1, total / classes.length);
}

function lunchBoundaryPair(records: NormalizedRecords): [number, number] {
  const beforeLunch = Math.max(1, records.config.lunchPeriod || 4);
  return [beforeLunch, beforeLunch + 1];
}

function hasLunchBoundaryIssue(records: NormalizedRecords, periods: number[]) {
  const [beforeLunch, afterLunch] = lunchBoundaryPair(records);
  return periods.includes(beforeLunch) && periods.includes(afterLunch);
}

function lunchProtectionActive(options: Required<SolveOptions>) {
  return options.lunchProtection === "Y" && options.lunchProtectionLevel !== "off";
}

function lunchWeightMultiplier(options: Required<SolveOptions>) {
  if (options.lunchProtectionLevel === "hard") return 120;
  if (options.lunchProtectionLevel === "high") return 90;
  if (options.lunchProtectionLevel === "normal") return 35;
  return 0;
}

function addedPeriodsByTeacher(loads: LoadUnit[], basePeriod: number) {
  const continuous = isContinuousLoads(loads);
  const additions = new Map<string, number[]>();
  loads.forEach((load, index) => {
    const period = continuous ? basePeriod + index : basePeriod;
    const periods = additions.get(load.teacherCode) || [];
    periods.push(period);
    additions.set(load.teacherCode, periods);
  });
  return additions;
}

function wouldCreateHardConsecutive(records: NormalizedRecords, schedule: Schedule, options: Required<SolveOptions>, loads: LoadUnit[], day: DayKey, basePeriod: number) {
  void records;
  return [...addedPeriodsByTeacher(loads, basePeriod).entries()].some(([teacherCode, periods]) => {
    const projectedRun = longestRun([...teacherPeriodsForDay(schedule, teacherCode, day), ...periods]);
    if (options.consecutiveStrictMode === "three-plus") return projectedRun >= Math.max(3, options.consecutiveWarnThreshold || 3);
    if (options.consecutiveStrictMode === "over-max") return projectedRun > options.maxConsecutive;
    return false;
  });
}

function wouldCreateHardLunch(records: NormalizedRecords, schedule: Schedule, options: Required<SolveOptions>, loads: LoadUnit[], day: DayKey, basePeriod: number) {
  if (!lunchProtectionActive(options) || options.lunchProtectionLevel !== "hard") return false;
  return [...addedPeriodsByTeacher(loads, basePeriod).entries()].some(([teacherCode, periods]) => {
    return hasLunchBoundaryIssue(records, [...teacherPeriodsForDay(schedule, teacherCode, day), ...periods]);
  });
}

function teacherDayMaxFor(options: Required<SolveOptions>, day: DayKey) {
  const value = options.teacherDayMax?.[day];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function teacherDayAddedCounts(loads: LoadUnit[]) {
  const counts = new Map<string, number>();
  for (const load of loads) counts.set(load.teacherCode, (counts.get(load.teacherCode) || 0) + 1);
  return counts;
}

function wouldExceedTeacherDayMax(schedule: Schedule, options: Required<SolveOptions>, loads: LoadUnit[], day: DayKey) {
  const max = teacherDayMaxFor(options, day);
  if (!max) return false;
  for (const [teacherCode, added] of teacherDayAddedCounts(loads)) {
    if (teacherGeneralDailyCount(schedule, teacherCode, day) + added > max) return true;
  }
  return false;
}

export function subjectSimilarKey(records: NormalizedRecords, subjectCode?: string) {
  if (!subjectCode) return "";
  return records.subjects[subjectCode]?.similarGroup || subjectCode;
}

function subjectSameDayScope(syncGroup?: string) {
  return syncGroup ? `sync:${syncGroup}` : "single";
}

function subjectDayUsageKeys(records: NormalizedRecords, options: Required<SolveOptions>, load: Pick<LoadUnit, "classCode" | "subjectCode" | "syncGroup">, day: DayKey) {
  const scope = subjectSameDayScope(load.syncGroup);
  const keys = [`exact:${load.classCode}:${day}:${scope}:${load.subjectCode}`];
  if (options.sameSubjectSameDay) keys.push(`similar:${load.classCode}:${day}:${scope}:${subjectSimilarKey(records, load.subjectCode)}`);
  return keys;
}

function sameContinuousSubjectBlock(a?: string, b?: string) {
  return Boolean(a && b && a === b);
}

function wouldCreateSubjectSameDay(records: NormalizedRecords, schedule: Schedule, loads: LoadUnit[], day: DayKey, includeSimilar: boolean) {
  const byClass = new Map<string, SubjectDayEntry[]>();
  for (const load of loads) {
    const key = includeSimilar ? subjectSimilarKey(records, load.subjectCode) : load.subjectCode;
    if (!key) continue;
    const list = byClass.get(load.classCode) || [];
    list.push({ key, scope: subjectSameDayScope(load.syncGroup), subjectCode: load.subjectCode, blockId: load.blockId });
    byClass.set(load.classCode, list);
  }

  for (const [classCode, additions] of byClass) {
    const existing: SubjectDayEntry[] = Object.values(schedule.classes[classCode]?.grid[day] || {})
      .filter((cell): cell is ScheduleCell => Boolean(cell?.subjectCode))
      .map((cell) => ({ key: includeSimilar ? subjectSimilarKey(records, cell.subjectCode) : cell.subjectCode || "", scope: subjectSameDayScope(cell.syncGroup), subjectCode: cell.subjectCode || "", blockId: cell.blockId }));
    const combined: SubjectDayEntry[] = [...existing, ...additions];
    for (let i = 0; i < combined.length; i += 1) {
      for (let j = i + 1; j < combined.length; j += 1) {
        if (!combined[i].key || combined[i].key !== combined[j].key) continue;
        if (combined[i].scope !== combined[j].scope) continue;
        if (sameContinuousSubjectBlock(combined[i].blockId, combined[j].blockId)) continue;
        return true;
      }
    }
  }
  return false;
}

function wouldCreateForbiddenSubjectSameDay(records: NormalizedRecords, schedule: Schedule, loads: LoadUnit[], day: DayKey, options: Required<SolveOptions>) {
  if (wouldCreateSubjectSameDay(records, schedule, loads, day, false)) return true;
  return options.sameSubjectSameDay && wouldCreateSubjectSameDay(records, schedule, loads, day, true);
}

function similarSubjectSameDayViolations(records: NormalizedRecords, schedule: Schedule, includeSimilar: boolean) {
  const violations: Array<{ className: string; day: DayKey; subjectName: string; similar: boolean }> = [];
  for (const [classCode, table] of Object.entries(schedule.classes)) {
    for (const day of schedule.days) {
      const cells = Object.values(table.grid[day] || {}).filter((cell): cell is ScheduleCell => Boolean(cell?.subjectCode));
      for (let i = 0; i < cells.length; i += 1) {
        for (let j = i + 1; j < cells.length; j += 1) {
          const firstKey = includeSimilar ? subjectSimilarKey(records, cells[i].subjectCode) : cells[i].subjectCode || "";
          const secondKey = includeSimilar ? subjectSimilarKey(records, cells[j].subjectCode) : cells[j].subjectCode || "";
          if (!firstKey || firstKey !== secondKey) continue;
          if (subjectSameDayScope(cells[i].syncGroup) !== subjectSameDayScope(cells[j].syncGroup)) continue;
          if (sameContinuousSubjectBlock(cells[i].blockId, cells[j].blockId)) continue;
          violations.push({
            className: records.classes[classCode]?.name || table.className || classCode,
            day,
            subjectName: cells[i].subjectName || cells[i].subjectCode || firstKey,
            similar: cells[i].subjectCode !== cells[j].subjectCode,
          });
        }
      }
    }
  }
  return violations;
}

function placeFixed(schedule: Schedule, records: NormalizedRecords) {
  for (const fixed of records.fixed) {
    const cls = records.classes[fixed.classCode];
    const grid = schedule.classes[fixed.classCode]?.grid;
    if (!cls || !grid || !grid[fixed.day]) continue;
    grid[fixed.day][String(fixed.period)] = {
      id: fixed.id,
      classCode: fixed.classCode,
      className: cls.name,
      day: fixed.day,
      period: fixed.period,
      fixed: true,
      label: fixed.label,
      teacherName: fixed.teacherName,
    };
  }
  invalidateScheduleCache(schedule);
}

function cloneSchedule(schedule: Schedule): Schedule {
  return JSON.parse(JSON.stringify(schedule)) as Schedule;
}

function invalidateScheduleCache(schedule: Schedule) {
  delete (schedule as CachedSchedule).__cache;
}

function scheduleCache(schedule: Schedule): ScheduleCache {
  const cached = (schedule as CachedSchedule).__cache;
  if (cached) return cached;
  const cells: ScheduleCell[] = [];
  const teacherCells = new Map<string, ScheduleCell[]>();
  const teacherBusySet = new Set<string>();
  const roomBusySet = new Set<string>();
  for (const cls of Object.values(schedule.classes)) {
    for (const day of schedule.days) {
      for (const cell of Object.values(cls.grid[day] || {})) {
        if (!cell) continue;
        cells.push(cell);
        if (cell.teacherCode) {
          const list = teacherCells.get(cell.teacherCode) || [];
          list.push(cell);
          teacherCells.set(cell.teacherCode, list);
          teacherBusySet.add(`${cell.teacherCode}:${cell.day}:${cell.period}`);
        }
        if (cell.roomCode) roomBusySet.add(`${cell.roomCode}:${cell.day}:${cell.period}`);
      }
    }
  }
  const next = { cells, teacherCells, teacherBusy: teacherBusySet, roomBusy: roomBusySet };
  Object.defineProperty(schedule, "__cache", { value: next, writable: true, configurable: true, enumerable: false });
  return next;
}

function makeCell(load: LoadUnit, day: DayKey, period: number, occurrence?: string): ScheduleCell {
  return {
    id: `${load.id}_${day}_${period}_${occurrence || ""}`,
    classCode: load.classCode,
    className: load.className,
    day,
    period,
    teacherCode: load.teacherCode,
    teacherName: load.teacherName,
    subjectCode: load.subjectCode,
    subjectName: load.subjectName,
    roomCode: load.roomCode,
    roomName: load.roomName,
    syncGroup: load.syncGroup,
    syncOccurrenceId: occurrence,
    blockId: load.blockId,
    blockPart: load.blockPart,
    blockSize: load.blockSize,
  };
}

function teacherBusy(schedule: Schedule, teacherCode: string, day: DayKey, period: number) {
  return scheduleCache(schedule).teacherBusy.has(`${teacherCode}:${day}:${period}`);
}

function roomBusy(schedule: Schedule, roomCode: string | undefined, day: DayKey, period: number) {
  if (!roomCode) return false;
  return scheduleCache(schedule).roomBusy.has(`${roomCode}:${day}:${period}`);
}

function violatesHardConstraint(records: NormalizedRecords, load: LoadUnit, day: DayKey, period: number) {
  return records.constraints.some((constraint) => {
    if (constraint.strength !== "hard") return false;
    if (constraint.day && constraint.day !== day) return false;
    if (constraint.periods.length && !constraint.periods.includes(period)) return false;
    if (!constraint.conditionType.includes("금지")) return false;
    if (constraint.targetType.includes("교사") && constraint.targetName === load.teacherName) return true;
    if (constraint.targetType.includes("학급") && constraint.targetName === load.className) return true;
    if (constraint.targetType.includes("과목") && constraint.targetName === load.subjectName) return true;
    if (constraint.targetType.includes("특별실") && constraint.targetName === load.roomName) return true;
    return false;
  });
}

function canPlace(schedule: Schedule, records: NormalizedRecords, load: LoadUnit, day: DayKey, period: number) {
  const cls = records.classes[load.classCode];
  if (!cls) return false;
  if (isBeyondClassDayLimit(records, load.classCode, day, period)) return false;
  if (schedule.classes[load.classCode]?.grid[day]?.[String(period)]) return false;
  if (teacherBusy(schedule, load.teacherCode, day, period)) return false;
  if (roomBusy(schedule, load.roomCode, day, period)) return false;
  if (violatesHardConstraint(records, load, day, period)) return false;
  return true;
}

function teacherDailyCount(schedule: Schedule, teacherCode: string, day: DayKey) {
  return cellsByTeacher(schedule, teacherCode).filter((cell) => cell.day === day).length;
}

function classDailyCount(schedule: Schedule, classCode: string, day: DayKey) {
  return Object.values(schedule.classes[classCode]?.grid[day] || {}).filter(Boolean).length;
}

function teacherGeneralDailyCount(schedule: Schedule, teacherCode: string, day: DayKey) {
  return cellsByTeacher(schedule, teacherCode).filter((cell) => cell.day === day && !cell.fixed).length;
}

function teacherDailyLoadRatio(records: NormalizedRecords, schedule: Schedule, teacherCode: string, day: DayKey) {
  return teacherGeneralDailyCount(schedule, teacherCode, day) / teacherAvailableCapacityForDay(records, teacherCode, day);
}

function teacherPeriodsForDay(schedule: Schedule, teacherCode: string, day: DayKey) {
  return cellsByTeacher(schedule, teacherCode).filter((cell) => cell.day === day && !cell.fixed).map((cell) => cell.period).sort((a, b) => a - b);
}

function longestRun(periods: number[]) {
  if (!periods.length) return 0;
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  let best = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}

function consecutiveRuns(periods: number[], threshold = 3) {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  const runs: number[][] = [];
  let current: number[] = [];
  for (const period of sorted) {
    if (!current.length || period === current[current.length - 1] + 1) current.push(period);
    else {
      if (current.length >= threshold) runs.push(current);
      current = [period];
    }
  }
  if (current.length >= threshold) runs.push(current);
  return runs;
}

function cellToLoad(cell: ScheduleCell): LoadUnit | null {
  if (!cell.teacherCode || !cell.teacherName || !cell.subjectCode || !cell.subjectName) return null;
  return {
    id: cell.id,
    teacherCode: cell.teacherCode,
    teacherName: cell.teacherName,
    subjectCode: cell.subjectCode,
    subjectName: cell.subjectName,
    classCode: cell.classCode,
    className: cell.className,
    hours: 1,
    roomCode: cell.roomCode,
    roomName: cell.roomName,
    syncGroup: cell.syncGroup,
    blockId: cell.blockId,
    blockPart: cell.blockPart,
    blockSize: cell.blockSize,
    pressure: 0,
  };
}

function hardBanCount(records: NormalizedRecords, loads: LoadUnit[]) {
  let count = 0;
  for (const load of loads) {
    count += records.constraints.filter((constraint) => {
      if (constraint.strength !== "hard") return false;
      if (!constraint.conditionType.includes("금지")) return false;
      if (constraint.targetType.includes("교사") && constraint.targetName === load.teacherName) return true;
      if (constraint.targetType.includes("학급") && constraint.targetName === load.className) return true;
      if (constraint.targetType.includes("과목") && constraint.targetName === load.subjectName) return true;
      if (constraint.targetType.includes("특별실") && constraint.targetName === load.roomName) return true;
      return false;
    }).length;
  }
  return count;
}

function teacherGradeSpan(records: NormalizedRecords, loads: LoadUnit[]) {
  const grades = new Set<string>();
  for (const load of loads) {
    for (const item of records.loads.filter((candidate) => candidate.teacherCode === load.teacherCode)) {
      const grade = records.classes[item.classCode]?.grade;
      if (grade) grades.add(grade);
    }
  }
  return Math.max(1, grades.size);
}

function roomScarcity(records: NormalizedRecords, loads: LoadUnit[]) {
  return loads.reduce((score, load) => score + (load.roomCode ? Math.max(1, records.loads.filter((item) => item.roomCode === load.roomCode).length) : 0), 0);
}

function conflictDegree(records: NormalizedRecords, loads: LoadUnit[]) {
  const teachers = new Set(loads.map((load) => load.teacherCode));
  const classes = new Set(loads.map((load) => load.classCode));
  const rooms = new Set(loads.map((load) => load.roomCode).filter(Boolean));
  const syncs = new Set(loads.map((load) => load.syncGroup).filter(Boolean));
  return records.loads.filter((load) => (
    teachers.has(load.teacherCode) ||
    classes.has(load.classCode) ||
    Boolean(load.roomCode && rooms.has(load.roomCode)) ||
    Boolean(load.syncGroup && syncs.has(load.syncGroup))
  )).length;
}

function classGeneralCapacity(records: NormalizedRecords, classCode: string) {
  const byDay = records.config.days.reduce((sum, day) => sum + classMaxPeriodForDay(records, classCode, day), 0);
  const fixedCount = records.fixed.filter((item) => item.classCode === classCode).length;
  return Math.max(0, byDay - fixedCount);
}

function classGeneralLoadHours(records: NormalizedRecords, classCode: string) {
  return records.loads.filter((load) => load.classCode === classCode).reduce((sum, load) => sum + load.hours, 0);
}

function teacherGeneralLoadHours(records: NormalizedRecords, teacherCode: string) {
  return records.loads.filter((load) => load.teacherCode === teacherCode).reduce((sum, load) => sum + load.hours, 0);
}

function classSyncLoadHours(records: NormalizedRecords, classCode: string) {
  return records.loads.filter((load) => load.classCode === classCode && load.syncGroup).reduce((sum, load) => sum + load.hours, 0);
}

function slotScore(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, loads: LoadUnit[], day: DayKey, period: number, random: () => number) {
  let score = random() * 0.05;
  for (const load of loads) {
    const teacherPeriods = teacherPeriodsForDay(schedule, load.teacherCode, day);
    const projectedRun = longestRun([...teacherPeriods, period]);
    const lunchPair = lunchBoundaryPair(records);
    const wouldCrossLunch = lunchProtectionActive(options) && lunchPair.includes(period) && lunchPair.some((p) => p !== period && teacherPeriods.includes(p));
    const byDay = records.config.days.map((item) => teacherDailyLoadRatio(records, schedule, load.teacherCode, item));
    const dayIndex = records.config.days.indexOf(day);
    if (dayIndex >= 0) byDay[dayIndex] += 1 / teacherAvailableCapacityForDay(records, load.teacherCode, day);
    const spread = Math.max(...byDay, 0) - Math.min(...byDay, 0);

    const teacherDayCount = teacherGeneralDailyCount(schedule, load.teacherCode, day);
    score += teacherDayCount * (options.balanceStrength !== "off" ? softWeight(options, "balance") * 3.4 : 0.5);
    if (teacherDayCount >= 3) score += (teacherDayCount - 2) * softWeight(options, "consecutive") * 18;
    score += classDailyCount(schedule, load.classCode, day) * 0.08;
    const consecutiveMultiplier = options.strictMaxConsecutive ? 2.4 : 1;
    if (projectedRun >= options.maxConsecutive) score += softWeight(options, "consecutive") * consecutiveMultiplier * (projectedRun === options.maxConsecutive ? 70 : 150);
    if (projectedRun >= Math.max(3, options.consecutiveWarnThreshold || 3)) score += softWeight(options, "consecutive") * 260;
    if (teacherPeriods.includes(period - 1) || teacherPeriods.includes(period + 1)) score += softWeight(options, "consecutive") * 22;
    if (wouldCrossLunch) score += softWeight(options, "lunch") * lunchWeightMultiplier(options) * 240;
    if (options.avoidTwoHourLunchCross && load.blockSize && load.blockSize >= 2 && lunchPair.includes(period) && lunchPair.includes(period + (load.blockPart || 1) - 1)) score += softWeight(options, "lunch") * 10;
    if (lunchProtectionActive(options) && lunchPair.includes(period)) score += softWeight(options, "lunch") * 1.2;
    if (options.balanceStrength !== "off") score += softWeight(options, "balance") * Math.max(0, spread - 0.32) * (options.strictBalance ? 14 : 8);
    const dayMax = teacherDayMaxFor(options, day);
    if (dayMax && teacherGeneralDailyCount(schedule, load.teacherCode, day) + 1 > dayMax) score += options.teacherDayMaxStrict ? 999 : 8;
    if (wouldCreateForbiddenSubjectSameDay(records, schedule, [load], day, options)) score += 999;
    if (records.config.days.indexOf(day) === records.config.days.length - 1 && period >= records.config.maxPeriod - 1) score += 0.2;
  }
  return score;
}

function isContinuousLoads(loads: LoadUnit[]) {
  return loads.length > 1 && Boolean(loads[0]?.blockId) && loads.every((load) => load.blockId === loads[0].blockId && !load.syncGroup);
}

function canPlaceContinuous(schedule: Schedule, records: NormalizedRecords, loads: LoadUnit[], day: DayKey, period: number) {
  const sorted = [...loads].sort((a, b) => (a.blockPart || 0) - (b.blockPart || 0));
  for (let index = 0; index < sorted.length; index += 1) {
    if (!canPlace(schedule, records, sorted[index], day, period + index)) return false;
  }
  return true;
}

function continuousSlotScore(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, loads: LoadUnit[], day: DayKey, period: number, random: () => number) {
  const sorted = [...loads].sort((a, b) => (a.blockPart || 0) - (b.blockPart || 0));
  let score = sorted.reduce((sum, load, index) => sum + slotScore(schedule, records, options, [load], day, period + index, random), 0) / Math.max(1, sorted.length);
  const blockPeriods = sorted.map((_, index) => period + index);
  if (lunchProtectionActive(options) && hasLunchBoundaryIssue(records, blockPeriods)) score += softWeight(options, "lunch") * lunchWeightMultiplier(options);
  return score;
}

function availableSlots(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, loads: LoadUnit[], random: () => number): Slot[] {
  const slots: Slot[] = [];
  for (const day of records.config.days) {
    for (let period = 1; period <= records.config.maxPeriod; period += 1) {
      const continuous = isContinuousLoads(loads);
      const ok = continuous ? canPlaceContinuous(schedule, records, loads, day, period) : loads.length > 1 ? canPlaceSync(schedule, records, loads, day, period) : canPlace(schedule, records, loads[0], day, period);
      if (!ok) continue;
      if (options.teacherDayMaxStrict && wouldExceedTeacherDayMax(schedule, options, loads, day)) continue;
      if (wouldCreateHardConsecutive(records, schedule, options, loads, day, period)) continue;
      if (wouldCreateHardLunch(records, schedule, options, loads, day, period)) continue;
      if (wouldCreateForbiddenSubjectSameDay(records, schedule, loads, day, options)) continue;
      slots.push({ day, period, score: continuous ? continuousSlotScore(schedule, records, options, loads, day, period, random) : slotScore(schedule, records, options, loads, day, period, random) });
    }
  }
  slots.sort((a, b) => (a.score || 0) - (b.score || 0));
  return slots;
}

type SyncLane = { classCode: string; items: LoadUnit[] };
type SyncPick = { laneIndex: number; itemIndex: number; load: LoadUnit };

function duplicateTeacherCount(loads: LoadUnit[]) {
  const teachers = new Map<string, number>();
  for (const load of loads) teachers.set(load.teacherCode, (teachers.get(load.teacherCode) || 0) + 1);
  return [...teachers.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function duplicateRoomCount(loads: LoadUnit[]) {
  const rooms = new Map<string, number>();
  for (const load of loads) {
    if (!load.roomCode) continue;
    rooms.set(load.roomCode, (rooms.get(load.roomCode) || 0) + 1);
  }
  return [...rooms.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function pickSyncOccurrence(lanes: SyncLane[], random: () => number, maxNodes = 6000): SyncPick[] | null {
  let nodes = 0;
  const chosen: SyncPick[] = [];
  const usedLanes = new Set<number>();
  const seenTeachers = new Set<string>();
  const seenRooms = new Set<string>();

  const search = (): SyncPick[] | null => {
    nodes += 1;
    if (nodes > maxNodes) return null;
    if (chosen.length === lanes.length) return [...chosen];

    let bestLaneIndex = -1;
    let bestCandidates: Array<{ itemIndex: number; load: LoadUnit; scarcity: number }> = [];
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (usedLanes.has(laneIndex)) continue;
      const lane = lanes[laneIndex];
      const candidates = lane.items
        .map((load, itemIndex) => ({ itemIndex, load }))
        .filter(({ load }) => !seenTeachers.has(load.teacherCode) && !(load.roomCode && seenRooms.has(load.roomCode)))
        .map(({ itemIndex, load }) => ({
          itemIndex,
          load,
          scarcity: lanes.reduce((sum, other, otherIndex) => {
            if (otherIndex === laneIndex || usedLanes.has(otherIndex)) return sum;
            return sum + other.items.filter((item) => item.teacherCode === load.teacherCode || (item.roomCode && item.roomCode === load.roomCode)).length;
          }, 0),
        }))
        .sort((a, b) => a.scarcity - b.scarcity || a.load.teacherCode.localeCompare(b.load.teacherCode, "ko") || random() - 0.5);
      if (!candidates.length) return null;
      if (bestLaneIndex < 0 || candidates.length < bestCandidates.length) {
        bestLaneIndex = laneIndex;
        bestCandidates = candidates;
      }
    }

    for (const candidate of bestCandidates) {
      usedLanes.add(bestLaneIndex);
      seenTeachers.add(candidate.load.teacherCode);
      if (candidate.load.roomCode) seenRooms.add(candidate.load.roomCode);
      chosen.push({ laneIndex: bestLaneIndex, itemIndex: candidate.itemIndex, load: candidate.load });
      const result = search();
      if (result) return result;
      chosen.pop();
      seenTeachers.delete(candidate.load.teacherCode);
      if (candidate.load.roomCode) seenRooms.delete(candidate.load.roomCode);
      usedLanes.delete(bestLaneIndex);
    }
    return null;
  };

  return search();
}

function pickSyncOccurrenceVariants(lanes: SyncLane[], random: () => number, maxVariants = 24, maxNodes = 20000) {
  let nodes = 0;
  const results: SyncPick[][] = [];
  const chosen: SyncPick[] = [];
  const usedLanes = new Set<number>();
  const seenTeachers = new Set<string>();
  const seenRooms = new Set<string>();

  const search = () => {
    nodes += 1;
    if (nodes > maxNodes || results.length >= maxVariants) return;
    if (chosen.length === lanes.length) {
      results.push([...chosen]);
      return;
    }

    let bestLaneIndex = -1;
    let bestCandidates: Array<{ itemIndex: number; load: LoadUnit; scarcity: number }> = [];
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      if (usedLanes.has(laneIndex)) continue;
      const lane = lanes[laneIndex];
      const candidates = lane.items
        .map((load, itemIndex) => ({ itemIndex, load }))
        .filter(({ load }) => !seenTeachers.has(load.teacherCode) && !(load.roomCode && seenRooms.has(load.roomCode)))
        .map(({ itemIndex, load }) => ({
          itemIndex,
          load,
          scarcity: lanes.reduce((sum, other, otherIndex) => {
            if (otherIndex === laneIndex || usedLanes.has(otherIndex)) return sum;
            return sum + other.items.filter((item) => item.teacherCode === load.teacherCode || (item.roomCode && item.roomCode === load.roomCode)).length;
          }, 0),
        }))
        .sort((a, b) => b.scarcity - a.scarcity || a.load.teacherCode.localeCompare(b.load.teacherCode, "ko") || random() - 0.5);
      if (!candidates.length) return;
      if (bestLaneIndex < 0 || candidates.length < bestCandidates.length) {
        bestLaneIndex = laneIndex;
        bestCandidates = candidates;
      }
    }

    for (const candidate of bestCandidates) {
      usedLanes.add(bestLaneIndex);
      seenTeachers.add(candidate.load.teacherCode);
      if (candidate.load.roomCode) seenRooms.add(candidate.load.roomCode);
      chosen.push({ laneIndex: bestLaneIndex, itemIndex: candidate.itemIndex, load: candidate.load });
      search();
      chosen.pop();
      seenTeachers.delete(candidate.load.teacherCode);
      if (candidate.load.roomCode) seenRooms.delete(candidate.load.roomCode);
      usedLanes.delete(bestLaneIndex);
      if (results.length >= maxVariants || nodes > maxNodes) break;
    }
  };

  search();
  return results;
}

function greedySyncOccurrence(lanes: SyncLane[], random: () => number): SyncPick[] {
  const picks: SyncPick[] = [];
  const seenTeachers = new Set<string>();
  const seenRooms = new Set<string>();
  lanes.forEach((lane, laneIndex) => {
    const candidates = lane.items
      .map((load, itemIndex) => ({
        itemIndex,
        load,
        conflict: (seenTeachers.has(load.teacherCode) ? 100 : 0) + (load.roomCode && seenRooms.has(load.roomCode) ? 50 : 0) + random(),
      }))
      .sort((a, b) => a.conflict - b.conflict);
    const picked = candidates[0];
    if (!picked) return;
    picks.push({ laneIndex, itemIndex: picked.itemIndex, load: picked.load });
    seenTeachers.add(picked.load.teacherCode);
    if (picked.load.roomCode) seenRooms.add(picked.load.roomCode);
  });
  return picks;
}

function solveSyncGroupOccurrences(byClass: Map<string, LoadUnit[]>, random: () => number) {
  const hourCount = Math.max(...[...byClass.values()].map((list) => list.length), 0);
  const initialLanes: SyncLane[] = [...byClass.entries()]
    .filter(([, list]) => list.length)
    .map(([classCode, items]) => ({ classCode, items: [...items] }))
    .sort((a, b) => a.items.length - b.items.length || a.classCode.localeCompare(b.classCode, "ko"));
  let nodes = 0;

  const search = (remaining: SyncLane[], rowIndex: number): LoadUnit[][] | null => {
    nodes += 1;
    if (nodes > 120000) return null;
    if (rowIndex >= hourCount) return [];
    const active = remaining
      .filter((lane) => lane.items.length)
      .sort((a, b) => a.items.length - b.items.length || a.classCode.localeCompare(b.classCode, "ko"));
    if (!active.length) return [];

    const variants = pickSyncOccurrenceVariants(active, random, 36, 25000);
    for (const picks of variants) {
      const next = remaining.map((lane) => ({ classCode: lane.classCode, items: [...lane.items] }));
      for (const pick of picks) {
        const activeLane = active[pick.laneIndex];
        const nextLane = next.find((lane) => lane.classCode === activeLane.classCode);
        nextLane?.items.splice(pick.itemIndex, 1);
      }
      const rest = search(next, rowIndex + 1);
      if (rest) return [picks.map((pick) => pick.load), ...rest];
    }
    return null;
  };

  return search(initialLanes, 0);
}

function buildSyncOccurrences(records: NormalizedRecords, random: () => number) {
  const groups = new Map<string, LoadUnit[]>();
  for (const load of records.loads.filter((item) => item.syncGroup)) {
    const list = groups.get(load.syncGroup!) || [];
    list.push(load);
    groups.set(load.syncGroup!, list);
  }
  const occurrences: LoadUnit[][] = [];
  for (const [group, loads] of groups) {
    const byClass = new Map<string, LoadUnit[]>();
    for (const load of loads) {
      const list = byClass.get(load.classCode) || [];
      for (let i = 0; i < load.hours; i += 1) list.push({ ...load, id: `${load.id}:${i + 1}` });
      byClass.set(load.classCode, list);
    }
    const hourCount = Math.max(...[...byClass.values()].map((list) => list.length), 0);
    const solvedOccurrences = solveSyncGroupOccurrences(byClass, random);
    if (solvedOccurrences) {
      solvedOccurrences.forEach((occurrence, index) => {
        for (const load of occurrence) load.id = `${load.id}:sync:${group}:${index + 1}`;
        occurrences.push(occurrence);
      });
      continue;
    }
    for (let i = 0; i < hourCount; i += 1) {
      const lanes: SyncLane[] = [...byClass.entries()]
        .filter(([, list]) => list.length)
        .map(([classCode, items]) => ({ classCode, items }))
        .sort((a, b) => a.items.length - b.items.length || a.classCode.localeCompare(b.classCode, "ko"));
      const picks = pickSyncOccurrence(lanes, random) || greedySyncOccurrence(lanes, random);
      const occurrence = picks.map((pick) => pick.load);
      for (const pick of [...picks].sort((a, b) => b.itemIndex - a.itemIndex)) lanes[pick.laneIndex].items.splice(pick.itemIndex, 1);
      for (const load of occurrence) load.id = `${load.id}:sync:${group}:${i + 1}`;
      occurrences.push(occurrence);
    }
  }
  occurrences.sort((a, b) => (
    duplicateTeacherCount(a) - duplicateTeacherCount(b) ||
    duplicateRoomCount(a) - duplicateRoomCount(b) ||
    b.reduce((sum, item) => sum + item.pressure, 0) - a.reduce((sum, item) => sum + item.pressure, 0)
  ));
  return occurrences;
}

function expandedNormalLoadGroups(records: NormalizedRecords) {
  const units: LoadUnit[][] = [];
  for (const load of records.loads.filter((item) => !item.syncGroup)) {
    const blocks = load.continuousBlocks?.length ? load.continuousBlocks : Array.from({ length: load.hours }, () => 1);
    let hourCursor = 0;
    blocks.forEach((blockSize, blockIndex) => {
      const blockId = `${load.id}:block:${blockIndex + 1}`;
      const group: LoadUnit[] = [];
      for (let part = 0; part < blockSize; part += 1) {
        hourCursor += 1;
        group.push({
          ...load,
          id: `${load.id}:${hourCursor}`,
          hours: 1,
          blockId,
          blockIndex: blockIndex + 1,
          blockPart: part + 1,
          blockSize,
        });
      }
      units.push(group);
    });
  }
  return units;
}

function makeWorkUnit(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, loads: LoadUnit[], random: () => number, kind: UnitKind = "normal"): WorkUnit {
  const slots = availableSlots(schedule, records, options, loads, random);
  const span = teacherGradeSpan(records, loads);
  const scarcity = roomScarcity(records, loads);
  const bans = hardBanCount(records, loads);
  const degree = conflictDegree(records, loads);
  const grade = records.classes[loads[0]?.classCode || ""]?.grade || "";
  const syncSize = loads.length > 1 ? loads.length : 0;
  const possibleSlots = slots.length;
  const syncGroup = kind === "sync" ? loads[0]?.syncGroup : undefined;
  const syncCohortKey = kind === "sync" ? [...new Set(loads.map((load) => load.classCode))].sort((a, b) => a.localeCompare(b, "ko")).join("|") : undefined;
  const unitId = loads.map((load) => load.id).join("+");
  const syncOccurrenceId = syncGroup ? `${syncGroup}:${unitId}` : undefined;
  const teacherLoadPressure = Math.max(...loads.map((load) => teacherGeneralLoadHours(records, load.teacherCode)), 0) * 4;
  const classSlackPressure = loads.reduce((sum, load) => {
    const slack = classGeneralCapacity(records, load.classCode) - classGeneralLoadHours(records, load.classCode);
    return sum + Math.max(0, 2 - slack) * 70;
  }, 0);
  const syncHeavyClassPressure = loads.reduce((sum, load) => (
    sum + (!load.syncGroup ? Math.max(0, classSyncLoadHours(records, load.classCode) - 12) * 18 : 0)
  ), 0);
  const pressure = (
    Math.max(0, 60 - possibleSlots) * 20 +
    syncSize * 160 +
    scarcity * 30 +
    Math.max(0, span - 1) * 120 +
    bans * 80 +
    degree * 3 +
    teacherLoadPressure +
    classSlackPressure +
    syncHeavyClassPressure +
    loads.reduce((sum, load) => sum + load.pressure, 0)
  );
  const derivedKind: UnitKind = kind === "sync" || kind === "continuous" ? kind : (syncSize || scarcity || span > 1 || possibleSlots <= 8 || bans ? "bottleneck" : grade ? "grade" : "normal");
  return {
    id: unitId,
    kind: derivedKind,
    loads,
    pressure,
    possibleSlots,
    domainSize: possibleSlots,
    degree,
    teacherGradeSpan: span,
    roomScarcity: scarcity,
    hardBanCount: bans,
    syncSize,
    syncGroup,
    syncOccurrenceId,
    syncCohortKey,
    syncCohortSize: syncCohortKey ? syncCohortKey.split("|").filter(Boolean).length : undefined,
    syncCohortStage: kind === "sync" ? "single" : undefined,
    placementStage: kind === "sync" ? "sync-first" : kind === "continuous" ? "continuous" : derivedKind === "bottleneck" ? "bottleneck" : derivedKind === "grade" ? "grade" : "normal",
    grade,
  };
}

function buildWorkUnits(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, random: () => number) {
  const units = [
    ...buildSyncOccurrences(records, random).map((loads) => makeWorkUnit(schedule, records, options, loads, random, "sync")),
    ...expandedNormalLoadGroups(records).map((loads) => makeWorkUnit(schedule, records, options, loads, random, loads.length > 1 ? "continuous" : "normal")),
  ];
  units.sort((a, b) => b.pressure - a.pressure);
  return units;
}

function orderedUnits(units: WorkUnit[], random: () => number, profile: string) {
  const groupWeight = (unit: WorkUnit) => {
    if (unit.kind === "sync") return 5;
    if (unit.kind === "continuous") return 4.5;
    if (unit.kind === "bottleneck") return 4;
    if (unit.teacherGradeSpan > 1) return 3;
    if (unit.kind === "grade") return 2;
    return 1;
  };
  return [...units].sort((a, b) => {
    const pressureA = a.pressure + (profile === "varied" ? random() * 60 : 0);
    const pressureB = b.pressure + (profile === "varied" ? random() * 60 : 0);
    if (groupWeight(a) !== groupWeight(b)) return groupWeight(b) - groupWeight(a);
    if (a.possibleSlots !== b.possibleSlots) return a.possibleSlots - b.possibleSlots;
    return pressureB - pressureA;
  });
}

function canPlaceSync(schedule: Schedule, records: NormalizedRecords, loads: LoadUnit[], day: DayKey, period: number) {
  const seenTeachers = new Set<string>();
  const seenRooms = new Set<string>();
  for (const load of loads) {
    if (seenTeachers.has(load.teacherCode)) return false;
    seenTeachers.add(load.teacherCode);
    if (load.roomCode) {
      if (seenRooms.has(load.roomCode)) return false;
      seenRooms.add(load.roomCode);
    }
    if (!canPlace(schedule, records, load, day, period)) return false;
  }
  return true;
}

function placeAt(schedule: Schedule, unit: WorkUnit, slot: Slot) {
  const occurrence = unit.kind === "sync" ? unit.syncOccurrenceId || `${unit.loads[0]?.syncGroup || "sync"}:${unit.id}` : undefined;
  const loads = unit.kind === "continuous" ? [...unit.loads].sort((a, b) => (a.blockPart || 0) - (b.blockPart || 0)) : unit.loads;
  for (let index = 0; index < loads.length; index += 1) {
    const load = loads[index];
    const period = unit.kind === "continuous" ? slot.period + index : slot.period;
    schedule.classes[load.classCode].grid[slot.day][String(period)] = makeCell(load, slot.day, period, occurrence);
  }
  invalidateScheduleCache(schedule);
}

function clearCell(schedule: Schedule, cell: ScheduleCell) {
  schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = null;
  invalidateScheduleCache(schedule);
}

function restoreCell(schedule: Schedule, cell: ScheduleCell) {
  schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = cell;
  invalidateScheduleCache(schedule);
}

function firstSlotForLoad(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, load: LoadUnit, random: () => number, exclude?: { day: DayKey; period: number }) {
  return availableSlots(schedule, records, options, [load], random)
    .filter((slot) => !(exclude && slot.day === exclude.day && slot.period === exclude.period))[0] || null;
}

function tryDisplaceClassCell(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number) {
  if (unit.loads.length !== 1) return false;
  const load = unit.loads[0];
  const classGrid = schedule.classes[load.classCode]?.grid;
  if (!classGrid) return false;
  const occupied = records.config.days.flatMap((day) => Object.values(classGrid[day] || {}).filter(Boolean) as ScheduleCell[])
    .filter((cell) => !cell.fixed && !cell.syncOccurrenceId && !(cell.blockId && (cell.blockSize || 1) > 1))
    .sort(() => random() - 0.5);
  for (const targetCell of occupied) {
    const displaced = cellToLoad(targetCell);
    if (!displaced) continue;
    const branch = cloneSchedule(schedule);
    const branchTarget = branch.classes[targetCell.classCode]?.grid[targetCell.day]?.[String(targetCell.period)] || null;
    if (!branchTarget) continue;
    clearCell(branch, branchTarget);
    if (!canPlaceSingleWithOptions(branch, records, options, load, targetCell.day, targetCell.period)) continue;
    const alternative = firstSlotForLoad(branch, records, options, displaced, random, { day: targetCell.day, period: targetCell.period });
    if (!alternative) continue;
    branch.classes[displaced.classCode].grid[alternative.day][String(alternative.period)] = makeCell(displaced, alternative.day, alternative.period);
    invalidateScheduleCache(branch);
    if (!canPlaceSingleWithOptions(branch, records, options, load, targetCell.day, targetCell.period)) continue;
    branch.classes[load.classCode].grid[targetCell.day][String(targetCell.period)] = makeCell(load, targetCell.day, targetCell.period);
    invalidateScheduleCache(branch);
    schedule.classes = branch.classes;
    invalidateScheduleCache(schedule);
    return true;
  }
  return false;
}

function tryDisplaceTeacherCell(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number) {
  if (unit.loads.length !== 1) return false;
  const load = unit.loads[0];
  const occupied = cellsByTeacher(schedule, load.teacherCode)
    .filter((cell) => !cell.fixed && !cell.syncOccurrenceId && !(cell.blockId && (cell.blockSize || 1) > 1))
    .sort(() => random() - 0.5);
  for (const targetCell of occupied) {
    const displaced = cellToLoad(targetCell);
    if (!displaced) continue;
    const branch = cloneSchedule(schedule);
    const branchTarget = branch.classes[targetCell.classCode]?.grid[targetCell.day]?.[String(targetCell.period)] || null;
    if (!branchTarget) continue;
    clearCell(branch, branchTarget);
    if (!canPlaceSingleWithOptions(branch, records, options, load, targetCell.day, targetCell.period)) continue;
    const alternative = firstSlotForLoad(branch, records, options, displaced, random, { day: targetCell.day, period: targetCell.period });
    if (!alternative) continue;
    branch.classes[displaced.classCode].grid[alternative.day][String(alternative.period)] = makeCell(displaced, alternative.day, alternative.period);
    invalidateScheduleCache(branch);
    if (!canPlaceSingleWithOptions(branch, records, options, load, targetCell.day, targetCell.period)) continue;
    branch.classes[load.classCode].grid[targetCell.day][String(targetCell.period)] = makeCell(load, targetCell.day, targetCell.period);
    invalidateScheduleCache(branch);
    schedule.classes = branch.classes;
    invalidateScheduleCache(schedule);
    return true;
  }
  return false;
}

function placeWithRepair(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number, profile: string) {
  const slots = availableSlots(schedule, records, options, unit.loads, random);
  if (slots[0]) {
    placeAt(schedule, unit, slots[0]);
    return true;
  }
  if (profile === "constraint") return false;
  if (tryDisplaceClassCell(schedule, records, options, unit, random)) return true;
  if (tryDisplaceTeacherCell(schedule, records, options, unit, random)) return true;
  if (tryChainPlaceUnit(schedule, records, options, unit, random)) return true;
  return false;
}

function canPlaceSingleWithOptions(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, load: LoadUnit, day: DayKey, period: number) {
  if (!canPlace(schedule, records, load, day, period)) return false;
  if (options.teacherDayMaxStrict && wouldExceedTeacherDayMax(schedule, options, [load], day)) return false;
  if (wouldCreateHardConsecutive(records, schedule, options, [load], day, period)) return false;
  if (wouldCreateHardLunch(records, schedule, options, [load], day, period)) return false;
  if (wouldCreateForbiddenSubjectSameDay(records, schedule, [load], day, options)) return false;
  return true;
}

function sameCellPosition(a: ScheduleCell | null | undefined, b: ScheduleCell | null | undefined) {
  return Boolean(a && b && a.classCode === b.classCode && a.day === b.day && a.period === b.period && a.id === b.id);
}

function teacherPeriodsForDayExcept(schedule: Schedule, teacherCode: string, day: DayKey, except?: ScheduleCell | null) {
  return cellsByTeacher(schedule, teacherCode)
    .filter((cell) => cell.day === day && !cell.fixed && !sameCellPosition(cell, except))
    .map((cell) => cell.period)
    .sort((a, b) => a - b);
}

function canPlaceSingleWithOptionsAfterClearing(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, load: LoadUnit, day: DayKey, period: number, except: ScheduleCell) {
  if (isBeyondClassDayLimit(records, load.classCode, day, period)) return false;
  const existingClassCell = schedule.classes[load.classCode]?.grid[day]?.[String(period)] || null;
  if (existingClassCell && !sameCellPosition(existingClassCell, except)) return false;
  if (cellsByTeacher(schedule, load.teacherCode).some((cell) => cell.day === day && cell.period === period && !sameCellPosition(cell, except))) return false;
  if (load.roomCode && allCells(schedule).some((cell) => cell.roomCode === load.roomCode && cell.day === day && cell.period === period && !sameCellPosition(cell, except))) return false;
  if (violatesHardConstraint(records, load, day, period)) return false;
  if (options.teacherDayMaxStrict && teacherGeneralDailyCount(schedule, load.teacherCode, day) + (except.teacherCode === load.teacherCode && except.day === day ? 0 : 1) > (teacherDayMaxFor(options, day) || Number.POSITIVE_INFINITY)) return false;
  const projectedPeriods = [...teacherPeriodsForDayExcept(schedule, load.teacherCode, day, except), period];
  const projectedRun = longestRun(projectedPeriods);
  if (options.consecutiveStrictMode === "three-plus" && projectedRun >= Math.max(3, options.consecutiveWarnThreshold || 3)) return false;
  if (options.consecutiveStrictMode === "over-max" && projectedRun > options.maxConsecutive) return false;
  if (options.lunchProtectionLevel === "hard" && hasLunchBoundaryIssue(records, projectedPeriods)) return false;
  const next = afterCleared(schedule, except);
  if (wouldCreateForbiddenSubjectSameDay(records, next, [load], day, options)) return false;
  return true;
}

function tryChainPlaceUnit(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number) {
  if (unit.loads.length !== 1) return false;
  const depth = Math.max(0, Math.min(5, Math.max(options.manualChainDepth || 4, options.searchStrength === "strong" ? 5 : 4)));
  if (depth < 2) return false;
  const next = cloneSchedule(schedule);
  const budget: ChainSearchBudget = {
    deadline: Date.now() + (options.searchStrength === "strong" ? 45 : 25),
    nodes: 0,
    maxNodes: options.searchStrength === "strong" ? 1800 : 800,
  };
  if (!tryChainPlaceLoad(next, records, options, unit.loads[0], random, depth, new Set(), budget)) return false;
  schedule.classes = next.classes;
  invalidateScheduleCache(schedule);
  return true;
}

function tryDeepChainPlaceUnit(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number, maxMs = 90, maxNodes = 5000) {
  if (unit.loads.length !== 1) return false;
  const next = cloneSchedule(schedule);
  const budget: ChainSearchBudget = {
    deadline: Date.now() + (options.searchStrength === "strong" ? maxMs : Math.min(maxMs, 50)),
    nodes: 0,
    maxNodes: options.searchStrength === "strong" ? maxNodes : Math.min(maxNodes, 2200),
  };
  if (!tryChainPlaceLoad(next, records, options, unit.loads[0], random, 6, new Set(), budget)) return false;
  schedule.classes = next.classes;
  invalidateScheduleCache(schedule);
  return true;
}

function tryChainPlaceLoad(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, load: LoadUnit, random: () => number, depth: number, visited: Set<string>, budget: ChainSearchBudget): boolean {
  budget.nodes += 1;
  if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) return false;
  const direct = availableSlots(schedule, records, options, [load], random)[0];
  if (direct) {
    schedule.classes[load.classCode].grid[direct.day][String(direct.period)] = makeCell(load, direct.day, direct.period);
    invalidateScheduleCache(schedule);
    return true;
  }
  if (depth <= 0) return false;
  const classGrid = schedule.classes[load.classCode]?.grid;
  if (!classGrid) return false;
  const teacherConflictTargets = records.config.days
    .flatMap((day) => schedule.periods.map((period) => ({ day, period })))
    .filter(({ day, period }) => !schedule.classes[load.classCode]?.grid[day]?.[String(period)])
    .filter(({ day, period }) => !isBeyondClassDayLimit(records, load.classCode, day, period) && !violatesHardConstraint(records, load, day, period))
    .map(({ day, period }) => {
      const teacherCell = cellsByTeacher(schedule, load.teacherCode).find((cell) => cell.day === day && cell.period === period);
      if (!teacherCell || teacherCell.fixed || teacherCell.syncOccurrenceId || (teacherCell.blockId && (teacherCell.blockSize || 1) > 1)) return null;
      return {
        cell: teacherCell,
        target: { day, period },
        score: canPlaceSingleWithOptionsAfterClearing(schedule, records, options, load, day, period, teacherCell)
          ? slotScore(schedule, records, options, [load], day, period, random)
          : Number.POSITIVE_INFINITY,
      };
    })
    .filter((item): item is { cell: ScheduleCell; target: { day: DayKey; period: number }; score: number } => Boolean(item && Number.isFinite(item.score)))
    .sort((a, b) => a.score - b.score)
    .slice(0, options.searchStrength === "strong" ? 12 : 10);

  for (const target of teacherConflictTargets) {
    if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) return false;
    const key = `${load.id}->teacher:${target.cell.classCode}:${target.cell.day}:${target.cell.period}`;
    if (visited.has(key)) continue;
    const displaced = cellToLoad(target.cell);
    if (!displaced) continue;
    const branch = cloneSchedule(schedule);
    const branchTarget = branch.classes[target.cell.classCode]?.grid[target.cell.day]?.[String(target.cell.period)];
    if (!branchTarget) continue;
    clearCell(branch, branchTarget);
    if (!canPlaceSingleWithOptions(branch, records, options, load, target.target.day, target.target.period)) continue;
    branch.classes[load.classCode].grid[target.target.day][String(target.target.period)] = makeCell(load, target.target.day, target.target.period);
    invalidateScheduleCache(branch);
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    if (tryChainPlaceLoad(branch, records, options, displaced, random, depth - 1, nextVisited, budget)) {
      schedule.classes = branch.classes;
      invalidateScheduleCache(schedule);
      return true;
    }
  }

  const groupedTeacherConflictTargets = records.config.days
    .flatMap((day) => schedule.periods.map((period) => ({ day, period })))
    .filter(({ day, period }) => !schedule.classes[load.classCode]?.grid[day]?.[String(period)])
    .filter(({ day, period }) => !isBeyondClassDayLimit(records, load.classCode, day, period) && !violatesHardConstraint(records, load, day, period))
    .map(({ day, period }) => {
      const teacherCell = cellsByTeacher(schedule, load.teacherCode).find((cell) => cell.day === day && cell.period === period);
      if (!teacherCell || teacherCell.fixed || (!teacherCell.syncOccurrenceId && !(teacherCell.blockId && (teacherCell.blockSize || 1) > 1))) return null;
      return {
        cell: teacherCell,
        target: { day, period },
        score: slotScore(schedule, records, options, [load], day, period, random),
      };
    })
    .filter((item): item is { cell: ScheduleCell; target: { day: DayKey; period: number }; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score)
    .slice(0, options.searchStrength === "strong" ? 8 : 4);

  for (const target of groupedTeacherConflictTargets) {
    if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) return false;
    const group = blockCells(schedule, target.cell);
    if (!group.length || group.length > 16 || group.some((cell) => cell.fixed)) continue;
    const key = `${load.id}->teacher-group:${group.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`).join("|")}`;
    if (visited.has(key)) continue;
    const branch = cloneSchedule(schedule);
    const branchGroup = group
      .map((cell) => branch.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell));
    if (branchGroup.length !== group.length) continue;
    for (const cell of branchGroup) clearCell(branch, cell);
    if (!canPlaceSingleWithOptions(branch, records, options, load, target.target.day, target.target.period)) continue;
    branch.classes[load.classCode].grid[target.target.day][String(target.target.period)] = makeCell(load, target.target.day, target.target.period);
    invalidateScheduleCache(branch);
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    if (tryRelocateCellGroup(branch, records, options, branchGroup, random)) {
      schedule.classes = branch.classes;
      invalidateScheduleCache(schedule);
      return true;
    }
  }

  const groupedClassTargets = records.config.days
    .flatMap((day) => Object.values(classGrid[day] || {}).filter(Boolean) as ScheduleCell[])
    .filter((cell) => !cell.fixed && Boolean(cell.syncOccurrenceId || (cell.blockId && (cell.blockSize || 1) > 1)))
    .map((cell) => ({
      cell,
      score: slotScore(schedule, records, options, [load], cell.day, cell.period, random),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, options.searchStrength === "strong" ? 8 : 4);

  for (const target of groupedClassTargets) {
    if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) return false;
    const group = blockCells(schedule, target.cell);
    if (!group.length || group.length > 16 || group.some((cell) => cell.fixed)) continue;
    const key = `${load.id}->class-group:${group.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`).join("|")}`;
    if (visited.has(key)) continue;
    const branch = cloneSchedule(schedule);
    const branchGroup = group
      .map((cell) => branch.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell));
    if (branchGroup.length !== group.length) continue;
    for (const cell of branchGroup) clearCell(branch, cell);
    if (!canPlaceSingleWithOptions(branch, records, options, load, target.cell.day, target.cell.period)) continue;
    branch.classes[load.classCode].grid[target.cell.day][String(target.cell.period)] = makeCell(load, target.cell.day, target.cell.period);
    invalidateScheduleCache(branch);
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    if (tryRelocateCellGroup(branch, records, options, branchGroup, random)) {
      schedule.classes = branch.classes;
      invalidateScheduleCache(schedule);
      return true;
    }
  }

  const occupied = records.config.days
    .flatMap((day) => Object.values(classGrid[day] || {}).filter(Boolean) as ScheduleCell[])
    .filter((cell) => !cell.fixed && !cell.syncOccurrenceId && !(cell.blockId && (cell.blockSize || 1) > 1))
    .map((cell) => {
      return {
        cell,
        score: canPlaceSingleWithOptionsAfterClearing(schedule, records, options, load, cell.day, cell.period, cell)
          ? slotScore(schedule, records, options, [load], cell.day, cell.period, random)
          : Number.POSITIVE_INFINITY,
      };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, options.searchStrength === "strong" ? 12 : 10)
    .map((item) => item.cell);

  for (const target of occupied) {
    if (budget.nodes > budget.maxNodes || Date.now() > budget.deadline) return false;
    const key = `${load.id}->${target.classCode}:${target.day}:${target.period}`;
    if (visited.has(key)) continue;
    const displaced = cellToLoad(target);
    if (!displaced) continue;
    const branch = cloneSchedule(schedule);
    const branchTarget = branch.classes[target.classCode]?.grid[target.day]?.[String(target.period)];
    if (!branchTarget) continue;
    clearCell(branch, branchTarget);
    if (!canPlaceSingleWithOptions(branch, records, options, load, target.day, target.period)) continue;
    branch.classes[load.classCode].grid[target.day][String(target.period)] = makeCell(load, target.day, target.period);
    invalidateScheduleCache(branch);
    const nextVisited = new Set(visited);
    nextVisited.add(key);
    if (tryChainPlaceLoad(branch, records, options, displaced, random, depth - 1, nextVisited, budget)) {
      schedule.classes = branch.classes;
      invalidateScheduleCache(schedule);
      return true;
    }
  }
  return false;
}

function afterCleared(schedule: Schedule, cell: ScheduleCell) {
  const next = cloneSchedule(schedule);
  const target = next.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)];
  if (target) clearCell(next, target);
  return next;
}

function syncBeamWidth(options: Required<SolveOptions>) {
  return options.searchStrength === "strong" ? 4 : 2;
}

function syncSlotLimit(options: Required<SolveOptions>) {
  return options.searchStrength === "strong" ? 6 : 4;
}

function syncUnitOrder(units: WorkUnit[]) {
  return [...units].sort((a, b) => (
    duplicateTeacherCount(b.loads) - duplicateTeacherCount(a.loads) ||
    a.domainSize - b.domainSize ||
    b.syncSize - a.syncSize ||
    b.pressure - a.pressure ||
    (a.syncOccurrenceId || a.id).localeCompare(b.syncOccurrenceId || b.id, "ko")
  ));
}

function syncCohortGroups(units: WorkUnit[]) {
  const groups = new Map<string, WorkUnit[]>();
  for (const unit of units) {
    if (!unit.syncCohortKey) continue;
    const list = groups.get(unit.syncCohortKey) || [];
    list.push({ ...unit, syncCohortStage: "cohort" });
    groups.set(unit.syncCohortKey, list);
  }
  return [...groups.entries()]
    .map(([key, list]) => ({ key, units: list, groupNames: [...new Set(list.map((unit) => unit.syncGroup || ""))].filter(Boolean) }))
    .filter((item) => item.units.length >= 4 && item.groupNames.length >= 2)
    .sort((a, b) => b.units.length - a.units.length || a.key.localeCompare(b.key, "ko"));
}

function syncSlotKey(slot: Slot) {
  return `${slot.day}:${slot.period}`;
}

function cohortCommonSlotCount(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, units: WorkUnit[], random: () => number) {
  const slots = new Set<string>();
  for (const unit of units) {
    for (const slot of availableSlots(schedule, records, options, unit.loads, random)) slots.add(syncSlotKey(slot));
  }
  return slots.size;
}

function syncCohortBeamWidth(options: Required<SolveOptions>) {
  return options.searchStrength === "strong" ? 6 : 3;
}

function syncCohortSlotLimit(options: Required<SolveOptions>) {
  return options.searchStrength === "strong" ? 8 : 5;
}

function placeSyncCohort(initialSchedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, units: WorkUnit[], random: () => number) {
  const startedAt = Date.now();
  const ordered = syncUnitOrder(units);
  const slotLimit = syncCohortSlotLimit(options);
  const domains = new Map<string, Slot[]>();
  for (const unit of ordered) domains.set(unit.id, availableSlots(initialSchedule, records, options, unit.loads, random).slice(0, slotLimit));

  const teacherPeriods = new Map<string, Map<DayKey, Set<number>>>();
  const subjectDayUsage = new Map<string, Map<string, number>>();
  const addSubjectUsage = (key: string, token: string) => {
    const tokens = subjectDayUsage.get(key) || new Map<string, number>();
    tokens.set(token, (tokens.get(token) || 0) + 1);
    subjectDayUsage.set(key, tokens);
  };
  const removeSubjectUsage = (key: string, token: string) => {
    const tokens = subjectDayUsage.get(key);
    if (!tokens) return;
    const next = (tokens.get(token) || 0) - 1;
    if (next > 0) tokens.set(token, next);
    else tokens.delete(token);
    if (!tokens.size) subjectDayUsage.delete(key);
  };
  const usageToken = (item: Pick<LoadUnit, "id" | "blockId"> | Pick<ScheduleCell, "id" | "blockId">) => item.blockId ? `block:${item.blockId}` : `item:${item.id}`;
  for (const cell of allCells(initialSchedule)) {
    if (cell.teacherCode && !cell.fixed) {
      const byDay = teacherPeriods.get(cell.teacherCode) || new Map<DayKey, Set<number>>();
      const periods = byDay.get(cell.day) || new Set<number>();
      periods.add(cell.period);
      byDay.set(cell.day, periods);
      teacherPeriods.set(cell.teacherCode, byDay);
    }
    if (cell.subjectCode) {
      const load = { classCode: cell.classCode, subjectCode: cell.subjectCode, syncGroup: cell.syncGroup };
      for (const key of subjectDayUsageKeys(records, options, load, cell.day)) addSubjectUsage(key, usageToken(cell));
    }
  }

  const usedSlots = new Set<string>();
  const assigned = new Map<string, Slot>();
  let bestAssigned = new Map<string, Slot>();
  let bestScore = Number.POSITIVE_INFINITY;
  let nodes = 0;
  const nodeLimit = options.searchStrength === "strong" ? 2400 : 900;
  const timeLimitMs = options.searchStrength === "strong" ? 90 : 55;

  const slotAllowed = (unit: WorkUnit, slot: Slot) => {
    if (usedSlots.has(syncSlotKey(slot))) return false;
    const pendingSubjectUsage = new Map<string, string>();
    for (const load of unit.loads) {
      const byDay = teacherPeriods.get(load.teacherCode);
      const periods = [...(byDay?.get(slot.day) || new Set<number>())];
      const projected = [...periods, slot.period];
      const run = longestRun(projected);
      if (options.consecutiveStrictMode === "three-plus" && run >= Math.max(3, options.consecutiveWarnThreshold || 3)) return false;
      if (options.consecutiveStrictMode === "over-max" && run > options.maxConsecutive) return false;
      if (options.lunchProtectionLevel === "hard" && hasLunchBoundaryIssue(records, projected)) return false;
      const token = usageToken(load);
      for (const key of subjectDayUsageKeys(records, options, load, slot.day)) {
        const existing = subjectDayUsage.get(key);
        if (existing?.size && !(load.blockId && existing.size === 1 && existing.has(token))) return false;
        const pendingToken = pendingSubjectUsage.get(key);
        if (pendingToken && pendingToken !== token) return false;
        pendingSubjectUsage.set(key, token);
      }
    }
    return true;
  };

  const applyUsage = (unit: WorkUnit, slot: Slot) => {
    for (const load of unit.loads) {
      const byDay = teacherPeriods.get(load.teacherCode) || new Map<DayKey, Set<number>>();
      const periods = byDay.get(slot.day) || new Set<number>();
      periods.add(slot.period);
      byDay.set(slot.day, periods);
      teacherPeriods.set(load.teacherCode, byDay);
      for (const key of subjectDayUsageKeys(records, options, load, slot.day)) addSubjectUsage(key, usageToken(load));
    }
  };

  const removeUsage = (unit: WorkUnit, slot: Slot) => {
    for (const load of unit.loads) {
      const periods = teacherPeriods.get(load.teacherCode)?.get(slot.day);
      periods?.delete(slot.period);
      for (const key of subjectDayUsageKeys(records, options, load, slot.day)) removeSubjectUsage(key, usageToken(load));
    }
  };

  const maybeBest = (score: number) => {
    if (assigned.size > bestAssigned.size || (assigned.size === bestAssigned.size && score < bestScore)) {
      bestAssigned = new Map(assigned);
      bestScore = score;
    }
  };

  const dfs = (remaining: WorkUnit[], score: number) => {
    nodes += 1;
    maybeBest(score);
    if (!remaining.length || nodes > nodeLimit || Date.now() - startedAt > timeLimitMs) return;
    const ranked = remaining
      .map((unit) => {
        const slots = (domains.get(unit.id) || []).filter((slot) => slotAllowed(unit, slot));
        return { unit, slots };
      })
      .sort((a, b) => a.slots.length - b.slots.length || b.unit.syncSize - a.unit.syncSize || b.unit.pressure - a.unit.pressure);
    const chosen = ranked[0];
    const rest = remaining.filter((unit) => unit.id !== chosen.unit.id);
    const slots = chosen.slots.slice(0, slotLimit);
    for (const slot of slots) {
      if (nodes > nodeLimit || Date.now() - startedAt > timeLimitMs) break;
      usedSlots.add(syncSlotKey(slot));
      assigned.set(chosen.unit.id, slot);
      applyUsage(chosen.unit, slot);
      dfs(rest, score + (slot.score || 0));
      removeUsage(chosen.unit, slot);
      assigned.delete(chosen.unit.id);
      usedSlots.delete(syncSlotKey(slot));
    }
    if (!slots.length) dfs(rest, score + 100000 + chosen.unit.pressure);
  };

  dfs(ordered, 0);
  const schedule = cloneSchedule(initialSchedule);
  for (const unit of ordered) {
    const slot = bestAssigned.get(unit.id);
    if (slot) placeAt(schedule, unit, slot);
  }
  return { schedule, placedIds: new Set(bestAssigned.keys()), score: bestScore };
}

function placeSyncCohorts(initialSchedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, syncUnits: WorkUnit[], random: () => number) {
  let schedule = initialSchedule;
  const placedIds = new Set<string>();
  const cohorts = syncCohortGroups(syncUnits);
  const diagnostics: Array<{ cohort: string; groups: string; classCount: number; assigned: number; unassigned: number; possibleSlots: number; reason: string }> = [];
  for (const cohort of cohorts) {
    const pending = cohort.units.filter((unit) => !placedIds.has(unit.id));
    const possibleSlots = cohortCommonSlotCount(schedule, records, options, pending, random);
    const result = placeSyncCohort(schedule, records, options, pending, random);
    schedule = result.schedule;
    for (const id of result.placedIds) placedIds.add(id);
    const unassigned = pending.length - result.placedIds.size;
    diagnostics.push({
      cohort: cohort.key,
      groups: cohort.groupNames.join(", "),
      classCount: cohort.key.split("|").filter(Boolean).length,
      assigned: result.placedIds.size,
      unassigned,
      possibleSlots,
      reason: unassigned
        ? options.sameSubjectSameDay ? "유사과목 금지로 슬롯 부족 또는 이전 코호트가 슬롯 소진" : "코호트 공통 슬롯 부족 또는 코호트 내 교사 충돌"
        : "cohort sync pack",
    });
  }
  return { schedule, placedIds, diagnostics };
}

function availableSlotCountFast(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, loads: LoadUnit[], limit = 5) {
  let count = 0;
  const continuous = isContinuousLoads(loads);
  for (const day of records.config.days) {
    for (const period of schedule.periods) {
      const ok = continuous ? canPlaceContinuous(schedule, records, loads, day, period) : loads.length > 1 ? canPlaceSync(schedule, records, loads, day, period) : canPlace(schedule, records, loads[0], day, period);
      if (!ok) continue;
      if (options.teacherDayMaxStrict && wouldExceedTeacherDayMax(schedule, options, loads, day)) continue;
      if (wouldCreateHardConsecutive(records, schedule, options, loads, day, period)) continue;
      if (wouldCreateHardLunch(records, schedule, options, loads, day, period)) continue;
      if (wouldCreateForbiddenSubjectSameDay(records, schedule, loads, day, options)) continue;
      count += 1;
      if (count >= limit) return count;
    }
  }
  return count;
}

function syncForwardPenalty(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, upcoming: WorkUnit[], random: () => number) {
  void random;
  return upcoming.slice(0, 6).reduce((sum, unit) => {
    const count = availableSlotCountFast(schedule, records, options, unit.loads, 5);
    if (count === 0) return sum + 8000;
    return sum + Math.max(0, 4 - count) * 180;
  }, 0);
}

function syncBlockingCells(schedule: Schedule, unit: WorkUnit, day: DayKey, period: number) {
  const cells: ScheduleCell[] = [];
  for (const load of unit.loads) {
    const classCell = schedule.classes[load.classCode]?.grid[day]?.[String(period)] || null;
    if (classCell) cells.push(classCell);
    const teacherCell = cellsByTeacher(schedule, load.teacherCode).find((cell) => cell.day === day && cell.period === period);
    if (teacherCell) cells.push(teacherCell);
    if (load.roomCode) {
      const roomCell = allCells(schedule).find((cell) => cell.day === day && cell.period === period && cell.roomCode === load.roomCode);
      if (roomCell) cells.push(roomCell);
    }
  }
  return uniqueCells(cells);
}

function placeLoadGroup(schedule: Schedule, loads: LoadUnit[], slot: Slot) {
  const continuous = isContinuousLoads(loads);
  const ordered = continuous ? [...loads].sort((a, b) => (a.blockPart || 0) - (b.blockPart || 0)) : loads;
  for (let index = 0; index < ordered.length; index += 1) {
    const load = ordered[index];
    const period = continuous ? slot.period + index : slot.period;
    schedule.classes[load.classCode].grid[slot.day][String(period)] = makeCell(load, slot.day, period);
  }
  invalidateScheduleCache(schedule);
}

function tryRelocateCellGroup(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, cells: ScheduleCell[], random: () => number) {
  const loads = cells
    .sort((a, b) => (a.blockPart || 1) - (b.blockPart || 1))
    .map((cell) => cellToLoad(cell))
    .filter((load): load is LoadUnit => Boolean(load));
  if (!loads.length || loads.length !== cells.length) return false;
  const slots = availableSlots(schedule, records, options, loads, random).slice(0, 8);
  const slot = slots[0];
  if (!slot) return false;
  if (cells[0]?.syncOccurrenceId) {
    for (const cell of cells) {
      schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = null;
    }
    for (const cell of cells) {
      schedule.classes[cell.classCode].grid[slot.day][String(slot.period)] = { ...cell, day: slot.day, period: slot.period };
    }
    invalidateScheduleCache(schedule);
    return true;
  }
  placeLoadGroup(schedule, loads, slot);
  return true;
}

function tryRepairSyncUnit(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number) {
  if (duplicateTeacherCount(unit.loads) || duplicateRoomCount(unit.loads)) return null;
  const candidates = records.config.days.flatMap((day) => schedule.periods.map((period) => ({ day, period, score: slotScore(schedule, records, options, unit.loads, day, period, random) })))
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, 10);
  for (const slot of candidates) {
    if (unit.loads.some((load) => isBeyondClassDayLimit(records, load.classCode, slot.day, slot.period) || violatesHardConstraint(records, load, slot.day, slot.period))) continue;
    const blockers = syncBlockingCells(schedule, unit, slot.day, slot.period);
    if (!blockers.length) continue;
    const blockerGroups: ScheduleCell[][] = [];
    const seen = new Set<string>();
    let blocked = false;
    for (const blocker of blockers) {
      const group = blockCells(schedule, blocker);
      if (group.some((cell) => cell.fixed)) {
        blocked = true;
        break;
      }
      const key = group.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      blockerGroups.push(group);
    }
    if (blocked || blockerGroups.length > 2) continue;
    const next = cloneSchedule(schedule);
    for (const group of blockerGroups) for (const cell of group) clearCell(next, cell);
    if (!canPlaceSync(next, records, unit.loads, slot.day, slot.period)) continue;
    if (wouldCreateForbiddenSubjectSameDay(records, next, unit.loads, slot.day, options)) continue;
    if (options.teacherDayMaxStrict && wouldExceedTeacherDayMax(next, options, unit.loads, slot.day)) continue;
    if (wouldCreateHardConsecutive(records, next, options, unit.loads, slot.day, slot.period)) continue;
    if (wouldCreateHardLunch(records, next, options, unit.loads, slot.day, slot.period)) continue;
    placeAt(next, unit, slot);
    let relocated = true;
    for (const group of blockerGroups.sort((a, b) => b.length - a.length)) {
      if (!tryRelocateCellGroup(next, records, options, group, random)) {
        relocated = false;
        break;
      }
    }
    if (relocated) return next;
  }
  return null;
}

function tryRepairSingleUnitByEjection(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number, maxMs = 180) {
  if (unit.loads.length !== 1) return false;
  const load = unit.loads[0];
  const startedAt = Date.now();
  const slots = records.config.days
    .flatMap((day) => schedule.periods.map((period) => ({ day, period, score: slotScore(schedule, records, options, [load], day, period, random) })))
    .filter((slot) => !isBeyondClassDayLimit(records, load.classCode, slot.day, slot.period) && !violatesHardConstraint(records, load, slot.day, slot.period))
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, options.searchStrength === "strong" ? 24 : 14);

  for (const slot of slots) {
    if (Date.now() - startedAt > maxMs) break;
    const blockers = syncBlockingCells(schedule, unit, slot.day, slot.period);
    if (!blockers.length) continue;
    const blockerGroups: ScheduleCell[][] = [];
    const seen = new Set<string>();
    let blocked = false;
    for (const blocker of blockers) {
      const group = blockCells(schedule, blocker);
      if (!group.length || group.some((cell) => cell.fixed)) {
        blocked = true;
        break;
      }
      const key = group.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      blockerGroups.push(group);
    }
    if (blocked || blockerGroups.length > 3 || blockerGroups.reduce((sum, group) => sum + group.length, 0) > 20) continue;

    const next = cloneSchedule(schedule);
    const nextGroups = blockerGroups.map((group) => group
      .map((cell) => next.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell)));
    if (nextGroups.some((group, index) => group.length !== blockerGroups[index].length)) continue;
    for (const group of nextGroups) for (const cell of group) clearCell(next, cell);
    if (!canPlaceSingleWithOptions(next, records, options, load, slot.day, slot.period)) continue;
    next.classes[load.classCode].grid[slot.day][String(slot.period)] = makeCell(load, slot.day, slot.period);
    invalidateScheduleCache(next);

    let relocated = true;
    for (const group of [...nextGroups].sort((a, b) => b.length - a.length)) {
      if (Date.now() - startedAt > maxMs) {
        relocated = false;
        break;
      }
      if (group.length === 1 && !isAtomicCell(group[0])) {
        const displaced = cellToLoad(group[0]);
        const budget: ChainSearchBudget = {
          deadline: startedAt + maxMs,
          nodes: 0,
          maxNodes: options.searchStrength === "strong" ? 9000 : 3500,
        };
        if (!displaced || !tryChainPlaceLoad(next, records, options, displaced, random, 5, new Set(), budget)) {
          relocated = false;
          break;
        }
      } else if (!tryRelocateCellGroup(next, records, options, group, random)) {
        relocated = false;
        break;
      }
    }
    if (!relocated) continue;
    const validation = validateSchedule(records, next, options);
    if (validation.hardErrors) continue;
    schedule.classes = next.classes;
    invalidateScheduleCache(schedule);
    return true;
  }
  return false;
}

function tryRepairContinuousUnitByEjection(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number, maxMs = 260) {
  if (!isContinuousLoads(unit.loads)) return false;
  const startedAt = Date.now();
  const orderedLoads = [...unit.loads].sort((a, b) => (a.blockPart || 0) - (b.blockPart || 0));
  const slots = records.config.days
    .flatMap((day) => schedule.periods.map((period) => ({ day, period, score: continuousSlotScore(schedule, records, options, orderedLoads, day, period, random) })))
    .filter((slot) => orderedLoads.every((load, index) => !isBeyondClassDayLimit(records, load.classCode, slot.day, slot.period + index) && !violatesHardConstraint(records, load, slot.day, slot.period + index)))
    .sort((a, b) => (a.score || 0) - (b.score || 0))
    .slice(0, options.searchStrength === "strong" ? 20 : 12);

  for (const slot of slots) {
    if (Date.now() - startedAt > maxMs) break;
    const blockers = uniqueCells(orderedLoads.flatMap((load, index) => syncBlockingCells(schedule, { ...unit, loads: [load] }, slot.day, slot.period + index)));
    if (!blockers.length) continue;
    const blockerGroups: ScheduleCell[][] = [];
    const seen = new Set<string>();
    let blocked = false;
    for (const blocker of blockers) {
      const group = blockCells(schedule, blocker);
      if (!group.length || group.some((cell) => cell.fixed)) {
        blocked = true;
        break;
      }
      const key = group.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`).sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      blockerGroups.push(group);
    }
    if (blocked || blockerGroups.length > 4 || blockerGroups.reduce((sum, group) => sum + group.length, 0) > 24) continue;
    const next = cloneSchedule(schedule);
    const nextGroups = blockerGroups.map((group) => group
      .map((cell) => next.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell)));
    if (nextGroups.some((group, index) => group.length !== blockerGroups[index].length)) continue;
    for (const group of nextGroups) for (const cell of group) clearCell(next, cell);
    const targetAvailable = availableSlots(next, records, options, orderedLoads, random)
      .some((candidateSlot) => candidateSlot.day === slot.day && candidateSlot.period === slot.period);
    if (!targetAvailable) continue;
    placeAt(next, unit, slot);
    let relocated = true;
    for (const group of [...nextGroups].sort((a, b) => b.length - a.length)) {
      if (Date.now() - startedAt > maxMs) {
        relocated = false;
        break;
      }
      if (group.length === 1 && !isAtomicCell(group[0])) {
        const displaced = cellToLoad(group[0]);
        const budget: ChainSearchBudget = {
          deadline: startedAt + maxMs,
          nodes: 0,
          maxNodes: options.searchStrength === "strong" ? 10000 : 4000,
        };
        if (!displaced || !tryChainPlaceLoad(next, records, options, displaced, random, 5, new Set(), budget)) {
          relocated = false;
          break;
        }
      } else if (!tryRelocateCellGroup(next, records, options, group, random)) {
        relocated = false;
        break;
      }
    }
    if (!relocated) continue;
    const validation = validateSchedule(records, next, options);
    if (validation.hardErrors) continue;
    schedule.classes = next.classes;
    invalidateScheduleCache(schedule);
    return true;
  }
  return false;
}

function tryRebuildTeacherForUnits(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, units: WorkUnit[], random: () => number, maxMs = 500) {
  if (!units.length || units.some((unit) => unit.loads.some((load) => load.syncGroup))) return false;
  const teacherCode = units[0].loads[0]?.teacherCode;
  if (!teacherCode || units.some((unit) => unit.loads.some((load) => load.teacherCode !== teacherCode))) return false;
  const teacherCells = cellsByTeacher(schedule, teacherCode)
    .filter((cell) => !cell.fixed && !cell.syncOccurrenceId);
  if (!teacherCells.length) return false;
  const groupedCells = new Map<string, ScheduleCell[]>();
  for (const cell of teacherCells) {
    const key = cell.blockId && (cell.blockSize || 1) > 1 ? `block:${cell.blockId}` : `cell:${cell.id}:${cell.classCode}:${cell.day}:${cell.period}`;
    const list = groupedCells.get(key) || [];
    list.push(cell);
    groupedCells.set(key, list);
  }
  const scheduledUnits = [...groupedCells.values()].map((cells) => {
    const loads = cells
      .sort((a, b) => (a.blockPart || 1) - (b.blockPart || 1))
      .map((cell) => cellToLoad(cell))
      .filter((load): load is LoadUnit => Boolean(load));
    if (loads.length !== cells.length) return null;
    return makeWorkUnit(schedule, records, options, loads, random, isContinuousLoads(loads) ? "continuous" : "normal");
  }).filter((unit): unit is WorkUnit => Boolean(unit));
  if (scheduledUnits.length !== groupedCells.size) return false;
  const pendingUnits = [...scheduledUnits, ...units];
  const pendingLoadIds = pendingUnits.flatMap((unit) => unit.loads.map((load) => load.id));
  if (new Set(pendingLoadIds).size !== pendingLoadIds.length) return false;
  const base = cloneSchedule(schedule);
  for (const cell of teacherCells) {
    const baseCell = base.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null;
    if (baseCell) clearCell(base, baseCell);
  }
  const startedAt = Date.now();
  let trial = 0;
  const trialLimit = options.searchStrength === "strong" ? 20 : 10;
  while (Date.now() - startedAt < maxMs && trial < trialLimit) {
    trial += 1;
    const branch = cloneSchedule(base);
    const remaining = [...pendingUnits];
    let failed = false;
    while (remaining.length) {
      if (Date.now() - startedAt >= maxMs) {
        failed = true;
        break;
      }
      const ranked = remaining
        .map((unit) => ({ unit, slots: availableSlots(branch, records, options, unit.loads, random) }))
        .sort((a, b) => a.slots.length - b.slots.length || b.unit.pressure - a.unit.pressure);
      const chosen = ranked[0];
      if (!chosen.slots.length) {
        failed = true;
        break;
      }
      const choiceWidth = Math.min(chosen.slots.length, trial <= 2 ? 1 : trial <= 5 ? 2 : 3);
      const slot = chosen.slots[Math.floor(random() * choiceWidth)];
      placeAt(branch, chosen.unit, slot);
      remaining.splice(remaining.indexOf(chosen.unit), 1);
    }
    if (failed) continue;
    const validation = validateSchedule(records, branch, options);
    if (validation.hardErrors) continue;
    schedule.classes = branch.classes;
    invalidateScheduleCache(schedule);
    return true;
  }
  return false;
}

function tryRebuildTeacherForUnit(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, unit: WorkUnit, random: () => number, maxMs = 500) {
  return tryRebuildTeacherForUnits(schedule, records, options, [unit], random, maxMs);
}

function placeSyncUnitsWithBeam(initialSchedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, syncUnits: WorkUnit[], random: () => number, profile: string) {
  type BeamState = { schedule: Schedule; score: number; unassignedUnits: WorkUnit[] };
  const startedAt = Date.now();
  const timeLimitMs = options.searchStrength === "strong" ? 120 : 75;
  const ordered = syncUnitOrder(syncUnits);
  const beamWidth = syncBeamWidth(options);
  const slotLimit = syncSlotLimit(options);
  const useForwardPenalty = options.searchStrength === "strong" && profile === "repair";
  const forwardPenalty = (schedule: Schedule, upcoming: WorkUnit[]) => useForwardPenalty ? syncForwardPenalty(schedule, records, options, upcoming, random) : 0;
  let beam: BeamState[] = [{ schedule: cloneSchedule(initialSchedule), score: 0, unassignedUnits: [] }];
  let processed = 0;
  for (let index = 0; index < ordered.length; index += 1) {
    const unit = ordered[index];
    if (Date.now() - startedAt > timeLimitMs) break;
    const nextBeam: BeamState[] = [];
    for (const state of beam) {
      if (Date.now() - startedAt > timeLimitMs) break;
      const slots = availableSlots(state.schedule, records, options, unit.loads, random).slice(0, slotLimit);
      for (const slot of slots) {
        if (Date.now() - startedAt > timeLimitMs) break;
        const nextSchedule = cloneSchedule(state.schedule);
        placeAt(nextSchedule, unit, slot);
        nextBeam.push({
          schedule: nextSchedule,
          unassignedUnits: state.unassignedUnits,
          score: state.score + (slot.score || 0) + forwardPenalty(nextSchedule, ordered.slice(index + 1)),
        });
      }
      if (!slots.length) {
        const repaired = profile !== "constraint" ? tryRepairSyncUnit(state.schedule, records, options, unit, random) : null;
        if (repaired) {
          nextBeam.push({
            schedule: repaired,
            unassignedUnits: state.unassignedUnits,
            score: state.score + 3000 + forwardPenalty(repaired, ordered.slice(index + 1)),
          });
        } else {
          nextBeam.push({
            schedule: cloneSchedule(state.schedule),
            unassignedUnits: [...state.unassignedUnits, unit],
            score: state.score + 100000 + unit.pressure,
          });
        }
      }
    }
    if (!nextBeam.length) break;
    beam = nextBeam.sort((a, b) => a.unassignedUnits.length - b.unassignedUnits.length || a.score - b.score).slice(0, beamWidth);
    processed = index + 1;
  }
  const unprocessed = ordered.slice(processed);
  if (unprocessed.length) {
    beam = beam.map((state) => ({ ...state, unassignedUnits: [...state.unassignedUnits, ...unprocessed] }));
  }
  return beam.sort((a, b) => a.unassignedUnits.length - b.unassignedUnits.length || a.score - b.score)[0] || { schedule: initialSchedule, score: 0, unassignedUnits: ordered };
}

function unassigned(load: LoadUnit, hours: number, reason: string): UnassignedItem {
  return {
    loadId: load.id,
    teacherName: load.teacherName,
    subjectName: load.subjectName,
    className: load.className,
    hours,
    reason,
  };
}

function unassignedReason(unit: WorkUnit) {
  if (unit.kind === "sync") {
    if (duplicateTeacherCount(unit.loads) || duplicateRoomCount(unit.loads)) return `동시그룹 ${unit.syncGroup || ""} 회차 내부 교사/특별실 중복`;
    if (unit.domainSize <= 0) return `동시그룹 ${unit.syncGroup || ""} 공통 슬롯 부족`;
    return `이전 배치가 동시그룹 ${unit.syncGroup || ""} 공통 슬롯을 소진`;
  }
  if (unit.possibleSlots <= 0) return "고정 일과, 교사/특별실 중복, 배정금지 때문에 가능한 교시가 없습니다.";
  if (unit.roomScarcity) return "특별실 또는 담당 교사의 빈 교시가 부족합니다.";
  if (unit.teacherGradeSpan > 1) return "여러 학년에 걸친 교사 시간 충돌 가능성이 큽니다.";
  return "배정 가능한 빈 교시를 찾지 못했습니다.";
}

function profileForChunk(chunkCount: number) {
  if (chunkCount <= 1) return "constraint";
  if (chunkCount <= 3) return "bottleneck";
  if (chunkCount <= 6) return "grade";
  if (chunkCount <= 10) return "repair";
  return "quality";
}

function softIssuePenalty(summary: SolveSummary, options: Required<SolveOptions>) {
  return (
    summary.consecutiveIssues * 60 * softWeight(options, "consecutive") +
    summary.lunchIssues * 60 * softWeight(options, "lunch") +
    summary.balanceIssues * 45 * softWeight(options, "balance")
  );
}

const SOFT_ISSUE_TEACHER_TARGET = 10;
const SOFT_ISSUE_COUNT_TARGET = 20;
const POST_OPTIMIZE_CHUNK_MS = 900;

function teacherIssueTypeCount(candidate: Candidate, issue: "3연강" | "식사" | "안배") {
  return candidate.teacherIssues.filter((item) => item.issues.includes(issue)).length;
}

function teacherIssueTargetPenalty(candidate: Candidate, options: Required<SolveOptions>) {
  const lunchOver = Math.max(0, teacherIssueTypeCount(candidate, "식사") - SOFT_ISSUE_TEACHER_TARGET);
  const consecutiveOver = Math.max(0, teacherIssueTypeCount(candidate, "3연강") - SOFT_ISSUE_TEACHER_TARGET);
  const balanceOver = Math.max(0, teacherIssueTypeCount(candidate, "안배") - Math.max(SOFT_ISSUE_TEACHER_TARGET, Math.ceil(Object.keys(candidate.schedule.classes).length * 0.7)));
  return (
    lunchOver * 4200 * softWeight(options, "lunch") +
    consecutiveOver * 4200 * softWeight(options, "consecutive") +
    balanceOver * 1200 * softWeight(options, "balance")
  );
}

function qualityPenalty(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate) {
  let sameSubjectPenalty = 0;
  let dislikedPenalty = 0;
  for (const table of Object.values(candidate.schedule.classes)) {
    for (const day of candidate.schedule.days) {
      const subjects = new Map<string, number>();
      for (const cell of Object.values(table.grid[day])) {
        if (!cell?.subjectCode) continue;
        if (options.sameSubjectSameDay && !cell.blockId) {
          const key = `${subjectSimilarKey(records, cell.subjectCode)}::${subjectSameDayScope(cell.syncGroup)}`;
          subjects.set(key, (subjects.get(key) || 0) + 1);
        }
        if (records.config.days.indexOf(day) === records.config.days.length - 1 && cell.period >= records.config.maxPeriod - 1) dislikedPenalty += 1;
      }
      for (const count of subjects.values()) if (count > 1) sameSubjectPenalty += count - 1;
    }
  }
  return (
    candidate.summary.unassigned * 10000 +
    candidate.summary.hardErrors * 5000 +
    softIssuePenalty(candidate.summary, options) +
    teacherIssueTargetPenalty(candidate, options) +
    sameSubjectPenalty * 20 +
    dislikedPenalty * 10
  );
}

function summaryQualityPenalty(candidate: Candidate, options: Required<SolveOptions>) {
  return (
    candidate.summary.unassigned * 10000 +
    candidate.summary.hardErrors * 5000 +
    softIssuePenalty(candidate.summary, options) +
    teacherIssueTargetPenalty(candidate, options)
  );
}

function teacherDayCounts(records: NormalizedRecords, schedule: Schedule, teacherCode: string) {
  return records.config.days.map((day) => teacherGeneralDailyCount(schedule, teacherCode, day));
}

function teacherDayRatios(records: NormalizedRecords, schedule: Schedule, teacherCode: string) {
  return records.config.days.map((day) => teacherDailyLoadRatio(records, schedule, teacherCode, day));
}

function runPenaltyForPeriods(periods: number[]) {
  const sorted = [...new Set(periods)].sort((a, b) => a - b);
  let penalty = 0;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run >= 3) penalty += run - 2;
  }
  return penalty;
}

function postOptimizationStats(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate) {
  let lunch = 0;
  let consecutive = 0;
  let balance = 0;
  let teacherIssueCount = 0;
  let lunchTeacherCount = 0;
  let consecutiveTeacherCount = 0;
  let balanceTeacherCount = 0;
  for (const teacher of Object.values(records.teachers)) {
    const cells = cellsByTeacher(candidate.schedule, teacher.code).filter((cell) => !cell.fixed);
    let teacherHasIssue = false;
    let teacherHasLunch = false;
    let teacherHasConsecutive = false;
    let teacherHasBalance = false;
    for (const day of records.config.days) {
      const periods = cells.filter((cell) => cell.day === day).map((cell) => cell.period);
      const runPenalty = runPenaltyForPeriods(periods);
      if (runPenalty) {
        consecutive += runPenalty;
        teacherHasIssue = true;
        teacherHasConsecutive = true;
      }
      if (lunchProtectionActive(options) && hasLunchBoundaryIssue(records, periods)) {
        lunch += 1;
        teacherHasIssue = true;
        teacherHasLunch = true;
      }
    }
    const ratios = teacherDayRatios(records, candidate.schedule, teacher.code);
    const spread = Math.max(...ratios, 0) - Math.min(...ratios, 0);
    if (options.balanceStrength !== "off" && spread >= 0.45) {
      balance += Math.ceil((spread - 0.35) * 10);
      teacherHasIssue = true;
      teacherHasBalance = true;
    }
    if (teacherHasLunch) lunchTeacherCount += 1;
    if (teacherHasConsecutive) consecutiveTeacherCount += 1;
    if (teacherHasBalance) balanceTeacherCount += 1;
    if (teacherHasIssue) teacherIssueCount += 1;
  }
  const lunchOverTarget = Math.max(0, lunchTeacherCount - SOFT_ISSUE_TEACHER_TARGET);
  const consecutiveOverTarget = Math.max(0, consecutiveTeacherCount - SOFT_ISSUE_TEACHER_TARGET);
  const balanceOverTarget = Math.max(0, balanceTeacherCount - Math.max(SOFT_ISSUE_TEACHER_TARGET, Math.ceil(Object.keys(records.teachers).length * 0.45)));
  const lunchCountOverTarget = Math.max(0, lunch - (SOFT_ISSUE_COUNT_TARGET - 1));
  const consecutiveCountOverTarget = Math.max(0, consecutive - (SOFT_ISSUE_COUNT_TARGET - 1));
  const cost = (
    candidate.summary.unassigned * 1_000_000 +
    candidate.summary.hardErrors * 500_000 +
    lunch * 420 * softWeight(options, "lunch") +
    consecutive * 180 * softWeight(options, "consecutive") +
    balance * 90 * softWeight(options, "balance") +
    lunchCountOverTarget * 26000 * softWeight(options, "lunch") +
    consecutiveCountOverTarget * 14000 * softWeight(options, "consecutive") +
    lunchOverTarget * 9000 * softWeight(options, "lunch") +
    consecutiveOverTarget * 9000 * softWeight(options, "consecutive") +
    balanceOverTarget * 1800 * softWeight(options, "balance") +
    teacherIssueCount * 12
  );
  return { lunch, consecutive, balance, teacherIssueCount, lunchTeacherCount, consecutiveTeacherCount, balanceTeacherCount, cost };
}

function teacherPostIssueScore(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, teacherCode: string) {
  const teacher = records.teachers[teacherCode];
  if (!teacher) return 0;
  const cells = cellsByTeacher(candidate.schedule, teacherCode).filter((cell) => !cell.fixed);
  let score = 0;
  for (const day of records.config.days) {
    const periods = cells.filter((cell) => cell.day === day).map((cell) => cell.period);
    score += runPenaltyForPeriods(periods) * 5 * softWeight(options, "consecutive");
    if (lunchProtectionActive(options) && hasLunchBoundaryIssue(records, periods)) score += 22 * softWeight(options, "lunch");
  }
  const ratios = teacherDayRatios(records, candidate.schedule, teacherCode);
  const spread = Math.max(...ratios, 0) - Math.min(...ratios, 0);
  if (options.balanceStrength !== "off" && spread >= 0.45) score += Math.ceil((spread - 0.35) * 10) * 4 * softWeight(options, "balance");
  return score;
}

function postOptimizationViolationCells(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, focus?: "lunch" | "consecutive") {
  const lunchPair = lunchBoundaryPair(records);
  const cells = allCells(candidate.schedule).filter((cell) => !cell.fixed);
  const byTeacherDayPeriod = new Map(cells.map((cell) => [`${cell.teacherCode}:${cell.day}:${cell.period}`, cell]));
  const selected: Array<{ cell: ScheduleCell; score: number }> = [];
  const lunchOverTarget = candidate.summary.lunchIssues >= SOFT_ISSUE_COUNT_TARGET;
  const consecutiveOverTarget = candidate.summary.consecutiveIssues >= SOFT_ISSUE_COUNT_TARGET;
  for (const violation of candidate.validation.violations) {
    if (violation.severity === "hard") continue;
    if (!violation.teacherCode || !violation.day) continue;
    if (violation.type !== "lunch" && violation.type !== "consecutive") continue;
    if (focus && violation.type !== focus) continue;
    for (const period of violation.periods || []) {
      const cell = byTeacherDayPeriod.get(`${violation.teacherCode}:${violation.day}:${period}`);
      if (!cell) continue;
      const lunchScore = violation.type === "lunch" || lunchPair.includes(period)
        ? (lunchOverTarget ? 7000 : 1000) * softWeight(options, "lunch")
        : 0;
      const runScore = violation.type === "consecutive"
        ? (consecutiveOverTarget ? 5500 : 350) * softWeight(options, "consecutive")
        : 0;
      selected.push({ cell, score: lunchScore + runScore + random() });
    }
  }
  return uniqueCells(selected.sort((a, b) => b.score - a.score).map((item) => item.cell));
}

function postOptimizationCells(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number) {
  const stats = postOptimizationStats(records, options, candidate);
  const overTarget = (
    stats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
    stats.consecutive >= SOFT_ISSUE_COUNT_TARGET ||
    teacherIssueTypeCount(candidate, "3연강") > SOFT_ISSUE_TEACHER_TARGET ||
    teacherIssueTypeCount(candidate, "식사") > SOFT_ISSUE_TEACHER_TARGET
  );
  const lunchPair = lunchBoundaryPair(records);
  const teacherLimit = overTarget ? 24 : 10;
  const cellLimit = overTarget ? 76 : 36;
  const teacherCodes = Object.keys(records.teachers)
    .map((teacherCode) => ({ teacherCode, score: teacherPostIssueScore(records, options, candidate, teacherCode) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || random() - 0.5)
    .slice(0, teacherLimit)
    .map((item) => item.teacherCode);
  const seen = new Set<string>();
  const cells: ScheduleCell[] = [];
  for (const cell of postOptimizationViolationCells(records, options, candidate, random)) {
    const key = `${cell.classCode}:${cell.day}:${cell.period}:${cell.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push(cell);
    if (cells.length >= cellLimit) return cells;
  }
  for (const teacherCode of teacherCodes) {
    const teacherCells = cellsByTeacher(candidate.schedule, teacherCode).filter((cell) => !cell.fixed);
    const counts = new Map(records.config.days.map((day) => [day, teacherDailyLoadRatio(records, candidate.schedule, teacherCode, day)]));
    const maxCount = Math.max(...counts.values(), 0);
    const focused = teacherCells.filter((cell) => {
      const dayPeriods = teacherCells.filter((item) => item.day === cell.day).map((item) => item.period);
      const nearLunch = lunchProtectionActive(options) && lunchBoundaryPair(records).includes(cell.period);
      const inRun = runPenaltyForPeriods(dayPeriods) > 0 && dayPeriods.some((period) => Math.abs(period - cell.period) <= 2);
      const onHeavyDay = (counts.get(cell.day) || 0) === maxCount && maxCount >= 0.5;
      return nearLunch || inRun || onHeavyDay;
    });
    const ordered = (focused.length ? focused : teacherCells)
      .map((cell) => {
        const dayPeriods = teacherCells.filter((item) => item.day === cell.day).map((item) => item.period);
        const breaksLunch = lunchProtectionActive(options) && hasLunchBoundaryIssue(records, dayPeriods) && lunchPair.includes(cell.period);
        const inRun = runPenaltyForPeriods(dayPeriods) > 0 && dayPeriods.some((period) => Math.abs(period - cell.period) <= 2);
        const onHeavyDay = (counts.get(cell.day) || 0) === maxCount && maxCount >= 0.5;
        return {
          cell,
          score:
            (breaksLunch ? 1000 * softWeight(options, "lunch") : 0) +
            (inRun ? 500 * softWeight(options, "consecutive") : 0) +
            (onHeavyDay ? 120 * softWeight(options, "balance") : 0) +
            random(),
        };
      })
      .sort((a, b) => b.score - a.score)
      .map((item) => item.cell);
    for (const cell of ordered) {
      const key = `${cell.classCode}:${cell.day}:${cell.period}:${cell.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cell);
      if (cells.length >= cellLimit) return cells;
    }
  }
  return cells;
}

function tabuKey(move: ManualMove, cell?: ScheduleCell | null) {
  return `${cell?.teacherCode || "-"}:${cell?.id || "-"}:${move.from.classCode}:${move.from.day}:${move.from.period}->${move.to.classCode || move.from.classCode}:${move.to.day}:${move.to.period}`;
}

function reverseTabuKey(move: ManualMove, cell?: ScheduleCell | null) {
  return `${cell?.teacherCode || "-"}:${cell?.id || "-"}:${move.to.classCode || move.from.classCode}:${move.to.day}:${move.to.period}->${move.from.classCode}:${move.from.day}:${move.from.period}`;
}

function postOptimizationTargetSlots(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, cell: ScheduleCell, random: () => number) {
  const load = cellToLoad(cell);
  const lunchPair = lunchBoundaryPair(records);
  const sourcePeriods = teacherPeriodsForDay(candidate.schedule, cell.teacherCode || "", cell.day);
  const sourceBreaksLunch = lunchProtectionActive(options) && hasLunchBoundaryIssue(records, sourcePeriods) && lunchPair.includes(cell.period);
  const sourceRun = runPenaltyForPeriods(sourcePeriods) > 0;
  return candidate.schedule.days
    .flatMap((day) => candidate.schedule.periods.map((period) => ({ day, period })))
    .filter(({ day, period }) => !(day === cell.day && period === cell.period))
    .filter(({ day, period }) => !isBeyondClassDayLimit(records, cell.classCode, day, period))
    .map(({ day, period }) => {
      const target = candidate.schedule.classes[cell.classCode]?.grid[day]?.[String(period)] || null;
      const targetBlocked = target?.fixed || (target?.syncOccurrenceId && target.syncOccurrenceId !== cell.syncOccurrenceId) || (target?.blockId && (target.blockSize || 1) > 1 && target.blockId !== cell.blockId);
      if (targetBlocked) return null;
      const targetPeriods = teacherPeriodsForDay(candidate.schedule, cell.teacherCode || "", day).filter((item) => !(day === cell.day && item === cell.period));
      const breaksLunch = lunchProtectionActive(options) && lunchPair.includes(period) && lunchPair.some((item) => item !== period && targetPeriods.includes(item));
      const projectedRun = longestRun([...targetPeriods, period]);
      const loadScore = load ? slotScore(candidate.schedule, records, options, [load], day, period, random) : 0;
      const score = (
        loadScore +
        (sourceBreaksLunch && !breaksLunch ? -900 * softWeight(options, "lunch") : 0) +
        (breaksLunch ? 600 * softWeight(options, "lunch") : 0) +
        (sourceRun && projectedRun < Math.max(3, options.consecutiveWarnThreshold || 3) ? -450 * softWeight(options, "consecutive") : 0) +
        (projectedRun >= Math.max(3, options.consecutiveWarnThreshold || 3) ? 280 * softWeight(options, "consecutive") : 0) +
        (target ? 0.4 : 0) +
        random() * 0.2
      );
      return { day, period, score };
    })
    .filter((item): item is { day: DayKey; period: number; score: number } => Boolean(item))
    .sort((a, b) => a.score - b.score);
}

function diversePostOptimizationSlots(slots: Array<{ day: DayKey; period: number; score: number }>, random: () => number, limit: number) {
  if (slots.length <= limit) return slots;
  const topCount = Math.max(4, Math.ceil(limit * 0.65));
  const selected = slots.slice(0, topCount);
  const tail = slots.slice(topCount);
  while (selected.length < limit && tail.length) {
    const index = Math.floor(random() * tail.length);
    selected.push(tail.splice(index, 1)[0]);
  }
  return selected;
}

function postOptimizationGoalScore(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate) {
  const remaining = targetRemaining(candidate.summary);
  const stats = postOptimizationStats(records, options, candidate);
  const maxSoftRemaining = Math.max(remaining.lunchIssues, remaining.consecutiveIssues);
  return (
    remaining.unassigned * 10_000_000 +
    remaining.hardErrors * 8_000_000 +
    maxSoftRemaining * 5_000_000 +
    remaining.lunchIssues * 900_000 +
    remaining.consecutiveIssues * 700_000 +
    candidate.summary.lunchIssues * 15_000 * softWeight(options, "lunch") +
    candidate.summary.consecutiveIssues * 11_000 * softWeight(options, "consecutive") +
    stats.cost
  );
}

function postOptimizationGoalVector(candidate: Candidate) {
  const remaining = targetRemaining(candidate.summary);
  const maxSoftRemaining = Math.max(remaining.lunchIssues, remaining.consecutiveIssues);
  return [
    remaining.unassigned,
    remaining.hardErrors,
    maxSoftRemaining,
    remaining.lunchIssues + remaining.consecutiveIssues,
    remaining.lunchIssues,
    remaining.consecutiveIssues,
    candidate.summary.lunchIssues,
    candidate.summary.consecutiveIssues,
    candidate.summary.balanceIssues,
  ];
}

function postOptimizationDeltaVector(candidate: Candidate, delta: MoveDelta, extraScore = 0) {
  const summary = {
    unassigned: candidate.summary.unassigned + delta.unassigned,
    hardErrors: candidate.summary.hardErrors + delta.hardErrors,
    lunchIssues: candidate.summary.lunchIssues + delta.lunchIssues,
    consecutiveIssues: candidate.summary.consecutiveIssues + delta.consecutiveIssues,
    balanceIssues: candidate.summary.balanceIssues + delta.balanceIssues,
  };
  const remaining = targetRemaining(summary);
  const maxSoftRemaining = Math.max(remaining.lunchIssues, remaining.consecutiveIssues);
  return [
    remaining.unassigned,
    remaining.hardErrors,
    maxSoftRemaining,
    remaining.lunchIssues + remaining.consecutiveIssues,
    remaining.lunchIssues,
    remaining.consecutiveIssues,
    summary.lunchIssues,
    summary.consecutiveIssues,
    summary.balanceIssues,
    delta.softPenalty,
    extraScore,
  ];
}

function postOptimizationOptionVector(candidate: Candidate, option: ManualMoveCandidate) {
  const delta = option.delta || { unassigned: 0, hardErrors: 0, lunchIssues: 0, consecutiveIssues: 0, balanceIssues: 0, softPenalty: 0 };
  return postOptimizationDeltaVector(candidate, delta, (option.depth || 1) * 10 + option.score);
}

function vectorLess(a: number[], b: number[]) {
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

function optionImprovesTarget(candidate: Candidate, option: ManualMoveCandidate, focus?: "lunch" | "consecutive") {
  if (option.applies === false || option.quality === "blocked" || !option.delta) return false;
  if (option.delta.unassigned > 0 || option.delta.hardErrors > 0) return false;
  if (focus === "lunch" && option.delta.lunchIssues >= 0) return false;
  if (focus === "consecutive" && option.delta.consecutiveIssues >= 0) return false;
  return vectorLess(postOptimizationOptionVector(candidate, option), postOptimizationGoalVector(candidate));
}

function goalVectorBetter(a: Candidate, b: Candidate) {
  const av = postOptimizationGoalVector(a);
  const bv = postOptimizationGoalVector(b);
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) return av[i] < bv[i];
  }
  return false;
}

function postOptimizationTeacherRebuildPass(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, startedAt: number, maxMs: number) {
  let current = candidate;
  let improvements = 0;
  const teacherCodes = Object.keys(records.teachers)
    .map((teacherCode) => ({ teacherCode, score: teacherPostIssueScore(records, options, current, teacherCode) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((item) => item.teacherCode);

  for (const teacherCode of teacherCodes) {
    if (Date.now() - startedAt >= maxMs || targetReached(current.summary)) break;
    const movable = cellsByTeacher(current.schedule, teacherCode).filter((cell) => !cell.fixed && !isAtomicCell(cell));
    if (movable.length < 2) continue;
    const loads = movable.map((cell) => cellToLoad(cell)).filter((load): load is LoadUnit => Boolean(load));
    if (loads.length !== movable.length || new Set(loads.map((load) => load.id)).size !== loads.length) continue;
    const base = cloneSchedule(current.schedule);
    for (const cell of movable) {
      const baseCell = base.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null;
      if (baseCell) clearCell(base, baseCell);
    }
    let bestForTeacher = current;
    for (let trial = 0; trial < 10 && Date.now() - startedAt < maxMs; trial += 1) {
      const branch = cloneSchedule(base);
      const remaining = [...loads];
      let failed = false;
      while (remaining.length) {
        if (Date.now() - startedAt >= maxMs) {
          failed = true;
          break;
        }
        const ranked = remaining
          .map((load) => ({ load, slots: availableSlots(branch, records, options, [load], random) }))
          .sort((a, b) => a.slots.length - b.slots.length || b.load.pressure - a.load.pressure);
        const chosen = ranked[0];
        if (!chosen.slots.length) {
          failed = true;
          break;
        }
        const width = Math.min(chosen.slots.length, trial < 2 ? 1 : trial < 6 ? 3 : 5);
        const slot = chosen.slots[Math.floor(random() * width)];
        branch.classes[chosen.load.classCode].grid[slot.day][String(slot.period)] = makeCell(chosen.load, slot.day, slot.period);
        invalidateScheduleCache(branch);
        remaining.splice(remaining.indexOf(chosen.load), 1);
      }
      if (failed) continue;
      const next = makeCandidate(records, options, branch, current.unassigned, Date.now() + trial);
      if (next.summary.unassigned || next.summary.hardErrors) continue;
      if (goalVectorBetter(next, bestForTeacher)) bestForTeacher = next;
    }
    if (bestForTeacher.signature !== current.signature && goalVectorBetter(bestForTeacher, current)) {
      current = bestForTeacher;
      improvements += 1;
    }
  }
  return { candidate: current, improvements };
}

function postOptimizationTargetedPass(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, startedAt: number, maxMs: number) {
  let current = candidate;
  let improvements = 0;
  while (Date.now() - startedAt < maxMs && !targetReached(current.summary)) {
    const remaining = targetRemaining(current.summary);
    const focus = remaining.lunchIssues >= remaining.consecutiveIssues && remaining.lunchIssues > 0
      ? "lunch"
      : remaining.consecutiveIssues > 0
        ? "consecutive"
        : undefined;
    let changed = false;
    const focusOrder: Array<"lunch" | "consecutive" | undefined> = focus ? [focus, undefined] : [undefined];
    for (const focusKind of focusOrder) {
      const cells = postOptimizationViolationCells(records, options, current, random, focusKind).slice(0, focusKind ? 16 : 24);
      if (!cells.length) continue;
      for (const cell of cells) {
        if (Date.now() - startedAt > maxMs) break;
        const from = { classCode: cell.classCode, day: cell.day, period: cell.period };
        for (const slot of diversePostOptimizationSlots(postOptimizationTargetSlots(records, options, current, cell, random), random, focusKind ? 16 : 22)) {
          if (Date.now() - startedAt > maxMs) break;
          const next = applyMove(records, current, { from, to: { classCode: cell.classCode, day: slot.day, period: slot.period } }, options);
          if (next.signature === current.signature) continue;
          if (next.summary.unassigned !== 0 || next.summary.hardErrors !== 0) continue;
          if (!goalVectorBetter(next, current)) continue;
          current = next;
          improvements += 1;
          changed = true;
          break;
        }
        if (changed) break;
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return { candidate: current, improvements };
}

function postOptimizationMoveOptionsPass(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, startedAt: number, maxMs: number) {
  let current = candidate;
  let currentScore = postOptimizationGoalScore(records, options, current);
  let improvements = 0;
  while (Date.now() - startedAt < maxMs && !targetReached(current.summary)) {
    let bestOption: ManualMoveCandidate | null = null;
    const remaining = targetRemaining(current.summary);
    const focus = remaining.lunchIssues >= remaining.consecutiveIssues && remaining.lunchIssues > 0
      ? "lunch"
      : remaining.consecutiveIssues > 0
        ? "consecutive"
        : undefined;
    const focusOrder: Array<"lunch" | "consecutive" | undefined> = focus ? [focus, undefined] : [undefined];
    for (const focusKind of focusOrder) {
      const cells = postOptimizationViolationCells(records, options, current, random, focusKind).slice(0, focusKind ? 12 : 18);
      if (!cells.length) continue;
      for (const cell of cells) {
        if (Date.now() - startedAt > maxMs) break;
        const optionsForCell = moveOptions(records, current, { classCode: cell.classCode, day: cell.day, period: cell.period }, options)
          .filter((option) => option.applies !== false && option.quality !== "blocked")
          .filter((option) => optionImprovesTarget(current, option, focusKind))
          .sort((a, b) => {
            const av = postOptimizationOptionVector(current, a);
            const bv = postOptimizationOptionVector(current, b);
            if (vectorLess(av, bv)) return -1;
            if (vectorLess(bv, av)) return 1;
            return (a.depth || 1) - (b.depth || 1);
          })
          .slice(0, 3);
        for (const option of optionsForCell) {
          if (Date.now() - startedAt > maxMs) break;
          if (!bestOption || vectorLess(postOptimizationOptionVector(current, option), postOptimizationOptionVector(current, bestOption))) {
            bestOption = option;
          }
        }
        if (bestOption && focusKind) break;
      }
      if (bestOption) break;
    }
    if (!bestOption) break;
    const bestNext = applyMove(records, current, bestOption.move, options);
    if (bestNext.signature === current.signature || bestNext.summary.unassigned !== 0 || bestNext.summary.hardErrors !== 0) break;
    current = bestNext;
    currentScore = postOptimizationGoalScore(records, options, current);
    improvements += 1;
  }
  return { candidate: current, improvements, score: currentScore };
}

function postOptimizationRepairProposalPass(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, startedAt: number, maxMs: number) {
  let current = candidate;
  let improvements = 0;
  while (Date.now() - startedAt < maxMs && !targetReached(current.summary)) {
    const proposals = repairOptions(records, current, options)
      .filter((proposal) => proposal.delta.unassigned <= 0 && proposal.delta.hardErrors <= 0)
      .filter((proposal) => vectorLess(postOptimizationDeltaVector(current, proposal.delta, proposal.score), postOptimizationGoalVector(current)))
      .sort((a, b) => {
        const av = postOptimizationDeltaVector(current, a.delta, a.score);
        const bv = postOptimizationDeltaVector(current, b.delta, b.score);
        if (vectorLess(av, bv)) return -1;
        if (vectorLess(bv, av)) return 1;
        return a.score - b.score;
      })
      .slice(0, 4);
    if (!proposals.length) break;
    let changed = false;
    for (const proposal of proposals) {
      if (Date.now() - startedAt > maxMs) break;
      const next = applyMove(records, current, proposal.move, options);
      if (next.signature === current.signature) continue;
      if (next.summary.unassigned !== 0 || next.summary.hardErrors !== 0) continue;
      if (!goalVectorBetter(next, current)) continue;
      current = next;
      improvements += 1;
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return { candidate: current, improvements };
}

function postOptimizeCandidate(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, seed: number) {
  const startedAt = Date.now();
  const beforeStats = postOptimizationStats(records, options, candidate);
  if (candidate.summary.hardErrors) return { candidate, improvements: 0, beforeCost: beforeStats.cost, afterCost: beforeStats.cost };
  if (beforeStats.lunch < SOFT_ISSUE_COUNT_TARGET && beforeStats.consecutive < SOFT_ISSUE_COUNT_TARGET) {
    return { candidate, improvements: 0, beforeCost: beforeStats.cost, afterCost: beforeStats.cost };
  }
  let current = candidate;
  let best = candidate;
  let currentCost = beforeStats.cost;
  let bestCost = beforeStats.cost;
  let improvements = 0;
  let stagnation = 0;
  const tabu = new Map<string, number>();
  const initialOverTarget = (
    beforeStats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
    beforeStats.consecutive >= SOFT_ISSUE_COUNT_TARGET ||
    beforeStats.lunchTeacherCount > SOFT_ISSUE_TEACHER_TARGET ||
    beforeStats.consecutiveTeacherCount > SOFT_ISSUE_TEACHER_TARGET
  );
  const iterations = candidate.summary.unassigned
    ? (options.searchStrength === "strong" ? 18 : 10)
    : (options.searchStrength === "strong" ? (initialOverTarget ? 90 : 60) : (initialOverTarget ? 50 : 35));
  if (initialOverTarget) {
    const rebuilt = postOptimizationTeacherRebuildPass(records, options, current, random, startedAt, POST_OPTIMIZE_CHUNK_MS * 2);
    if (rebuilt.candidate.signature !== current.signature) {
      current = rebuilt.candidate;
      best = rebuilt.candidate;
      currentCost = postOptimizationStats(records, options, current).cost;
      bestCost = currentCost;
      improvements += rebuilt.improvements;
    }
    const targeted = postOptimizationTargetedPass(records, options, current, random, startedAt, POST_OPTIMIZE_CHUNK_MS * 3);
    if (targeted.candidate.signature !== current.signature) {
      current = targeted.candidate;
      best = targeted.candidate;
      currentCost = postOptimizationStats(records, options, current).cost;
      bestCost = currentCost;
      improvements += targeted.improvements;
      const stats = postOptimizationStats(records, options, best);
      if (stats.lunch < SOFT_ISSUE_COUNT_TARGET && stats.consecutive < SOFT_ISSUE_COUNT_TARGET) {
        return {
          candidate: { ...best, id: `${best.id}_tabu_${seed}`, name: "브라우저 CSP + 타부 후처리 후보" },
          improvements,
          beforeCost: beforeStats.cost,
          afterCost: stats.cost,
        };
      }
    }
    if (Date.now() - startedAt < POST_OPTIMIZE_CHUNK_MS * 6) {
      const movePass = postOptimizationMoveOptionsPass(records, options, current, random, startedAt, POST_OPTIMIZE_CHUNK_MS * 6);
      if (movePass.candidate.signature !== current.signature) {
        current = movePass.candidate;
        best = movePass.candidate;
        currentCost = postOptimizationStats(records, options, current).cost;
        bestCost = currentCost;
        improvements += movePass.improvements;
        const stats = postOptimizationStats(records, options, best);
        if (stats.lunch < SOFT_ISSUE_COUNT_TARGET && stats.consecutive < SOFT_ISSUE_COUNT_TARGET) {
          return {
            candidate: { ...best, id: `${best.id}_tabu_${seed}`, name: "브라우저 CSP + 타부 후처리 후보" },
            improvements,
            beforeCost: beforeStats.cost,
            afterCost: stats.cost,
          };
        }
      }
    }
  }
  for (let step = 0; step < iterations; step += 1) {
    if (Date.now() - startedAt > POST_OPTIMIZE_CHUNK_MS) break;
    let chosen: { candidate: Candidate; cost: number; key: string } | null = null;
    const currentStats = postOptimizationStats(records, options, current);
    const overTarget = (
      currentStats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
      currentStats.consecutive >= SOFT_ISSUE_COUNT_TARGET ||
      currentStats.lunchTeacherCount > SOFT_ISSUE_TEACHER_TARGET ||
      currentStats.consecutiveTeacherCount > SOFT_ISSUE_TEACHER_TARGET
    );
    const cells = postOptimizationCells(records, options, current, random).slice(0, overTarget ? (stagnation > 12 ? 36 : 26) : (stagnation > 12 ? 20 : 14));
    for (const cell of cells) {
      if (Date.now() - startedAt > POST_OPTIMIZE_CHUNK_MS) break;
      const from = { classCode: cell.classCode, day: cell.day, period: cell.period };
      for (const slot of diversePostOptimizationSlots(postOptimizationTargetSlots(records, options, current, cell, random), random, overTarget ? 20 : 14)) {
        if (Date.now() - startedAt > POST_OPTIMIZE_CHUNK_MS) break;
        const move: ManualMove = { from, to: { classCode: cell.classCode, day: slot.day, period: slot.period } };
        const key = tabuKey(move, cell);
        const tabuUntil = tabu.get(key) || 0;
        const next = applyMove(records, current, move, options);
        if (next.signature === current.signature) continue;
        if (next.summary.unassigned !== 0 || next.summary.hardErrors !== 0) continue;
        const cost = postOptimizationStats(records, options, next).cost;
        const aspiration = cost < bestCost;
        if (tabuUntil > step && !aspiration) continue;
        if (!chosen || cost < chosen.cost || (cost === chosen.cost && random() < 0.25)) chosen = { candidate: next, cost, key: reverseTabuKey(move, cell) };
      }
    }
    if (!chosen) break;
    current = chosen.candidate;
    currentCost = chosen.cost;
    tabu.set(chosen.key, step + 7 + Math.floor(random() * 6));
    if (currentCost < bestCost) {
      best = current;
      bestCost = currentCost;
      improvements += 1;
      stagnation = 0;
      const stats = postOptimizationStats(records, options, best);
      if (stats.lunch < SOFT_ISSUE_COUNT_TARGET && stats.consecutive < SOFT_ISSUE_COUNT_TARGET) break;
    } else {
      stagnation += 1;
      if (stagnation > 28) break;
    }
  }
  const afterDirectStats = postOptimizationStats(records, options, best);
  if (
    Date.now() - startedAt < POST_OPTIMIZE_CHUNK_MS * 3 &&
    (
      afterDirectStats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
      afterDirectStats.consecutive >= SOFT_ISSUE_COUNT_TARGET ||
      afterDirectStats.lunchTeacherCount > SOFT_ISSUE_TEACHER_TARGET ||
      afterDirectStats.consecutiveTeacherCount > SOFT_ISSUE_TEACHER_TARGET
    )
  ) {
    let chainBest = best;
    let chainBestCost = afterDirectStats.cost;
    for (const cell of postOptimizationCells(records, options, best, random).slice(0, 6)) {
      if (Date.now() - startedAt > POST_OPTIMIZE_CHUNK_MS * 3) break;
      const from = { classCode: cell.classCode, day: cell.day, period: cell.period };
      const chainCandidates = chainMoveOptions(records, chainBest, from, options, chainBestCost)
        .filter((option) => option.applies !== false && option.quality !== "blocked")
        .slice(0, 6);
      for (const option of chainCandidates) {
        if (Date.now() - startedAt > POST_OPTIMIZE_CHUNK_MS * 3) break;
        const next = applyMove(records, chainBest, option.move, options);
        if (next.signature === chainBest.signature) continue;
        if (next.summary.unassigned !== 0 || next.summary.hardErrors !== 0) continue;
        const cost = postOptimizationStats(records, options, next).cost;
        if (cost < chainBestCost) {
          chainBest = next;
          chainBestCost = cost;
        }
      }
    }
    if (chainBest.signature !== best.signature) {
      best = chainBest;
      bestCost = chainBestCost;
      improvements += 1;
    }
  }
  const afterChainStats = postOptimizationStats(records, options, best);
  if (
    Date.now() - startedAt < POST_OPTIMIZE_CHUNK_MS * 4 &&
    (
      afterChainStats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
      afterChainStats.consecutive >= SOFT_ISSUE_COUNT_TARGET
    )
  ) {
    const greedy = postOptimizationMoveOptionsPass(records, options, best, random, startedAt, POST_OPTIMIZE_CHUNK_MS * 4);
    if (greedy.candidate.signature !== best.signature) {
      best = greedy.candidate;
      bestCost = Math.min(bestCost, postOptimizationStats(records, options, best).cost);
      improvements += greedy.improvements;
    }
  }
  const afterGreedyStats = postOptimizationStats(records, options, best);
  const finalDebt = targetRemaining(best.summary).lunchIssues + targetRemaining(best.summary).consecutiveIssues;
  if (
    finalDebt > 0 &&
    finalDebt <= 6 &&
    Date.now() - startedAt < POST_OPTIMIZE_CHUNK_MS * 5 &&
    (
      afterGreedyStats.lunch >= SOFT_ISSUE_COUNT_TARGET ||
      afterGreedyStats.consecutive >= SOFT_ISSUE_COUNT_TARGET
    )
  ) {
    const repair = postOptimizationRepairProposalPass(records, options, best, startedAt, POST_OPTIMIZE_CHUNK_MS * 5);
    if (repair.candidate.signature !== best.signature) {
      best = repair.candidate;
      bestCost = Math.min(bestCost, postOptimizationStats(records, options, best).cost);
      improvements += repair.improvements;
    }
  }
  const finalStats = postOptimizationStats(records, options, best);
  return {
    candidate: bestCost <= beforeStats.cost ? { ...best, id: `${best.id}_tabu_${seed}`, name: "브라우저 CSP + 타부 후처리 후보" } : candidate,
    improvements,
    beforeCost: beforeStats.cost,
    afterCost: finalStats.cost,
  };
}

function makeCandidate(records: NormalizedRecords, options: Required<SolveOptions>, schedule: Schedule, unassignedItems: UnassignedItem[], seed: number) {
  const validation = validateSchedule(records, schedule, options);
  const teacherIssues = summarizeTeacherIssues(records, schedule, validation);
  const summary = summarize(unassignedItems, validation);
  const candidate: Candidate = {
    id: `cand_${seed}`,
    name: "브라우저 CSP 탐색 후보",
    schedule,
    unassigned: unassignedItems,
    validation,
    teacherIssues,
    summary,
    relaxations: [],
    signature: signature(schedule),
  };
  candidate.summary.signature = candidate.signature;
  return candidate;
}

function enforceHardConsecutiveByDropping(records: NormalizedRecords, options: Required<SolveOptions>, schedule: Schedule, unassignedItems: UnassignedItem[], droppedLoads?: LoadUnit[]) {
  for (let guard = 0; guard < 16; guard += 1) {
    const validation = validateSchedule(records, schedule, options);
    const hardRun = validation.violations.find((item) => item.severity === "hard" && item.type === "consecutive" && item.teacherCode && item.day && item.periods?.length);
    if (!hardRun?.teacherCode || !hardRun.day || !hardRun.periods?.length) return;
    const cells = hardRun.periods
      .map((period) => cellsByTeacher(schedule, hardRun.teacherCode!).find((cell) => cell.day === hardRun.day && cell.period === period))
      .filter((cell): cell is ScheduleCell => Boolean(cell && !cell.fixed && !cell.syncOccurrenceId && !(cell.blockId && (cell.blockSize || 1) > 1)));
    const cell = cells[Math.floor(cells.length / 2)] || cells[cells.length - 1];
    const load = cell ? cellToLoad(cell) : null;
    if (!cell || !load) return;
    clearCell(schedule, cell);
    if (droppedLoads) droppedLoads.push(load);
    else unassignedItems.push(unassigned(load, 1, "4연강 hard 제약을 지키기 위해 후처리에서 미배정했습니다."));
  }
}

function tryMoveCellToFreeSlot(schedule: Schedule, records: NormalizedRecords, options: Required<SolveOptions>, cell: ScheduleCell, random: () => number) {
  if (cell.fixed || cell.syncOccurrenceId || (cell.blockId && (cell.blockSize || 1) > 1)) return false;
  const load = cellToLoad(cell);
  if (!load) return false;
  clearCell(schedule, cell);
  const slot = firstSlotForLoad(schedule, records, options, load, random, { day: cell.day, period: cell.period });
  if (slot) {
    schedule.classes[load.classCode].grid[slot.day][String(slot.period)] = makeCell(load, slot.day, slot.period);
    invalidateScheduleCache(schedule);
    return true;
  }
  restoreCell(schedule, cell);
  return false;
}

function improveQuality(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, seed: number) {
  let best = candidate;
  let bestPenalty = qualityPenalty(records, options, best);
  const iterations = options.searchStrength === "strong" ? 50 : 18;
  for (let i = 0; i < iterations; i += 1) {
    const schedule = cloneSchedule(best.schedule);
    const movable = Object.values(schedule.classes).flatMap((table) => schedule.days.flatMap((day) => Object.values(table.grid[day] || {})))
      .filter((cell): cell is ScheduleCell => Boolean(cell && !cell.fixed && !cell.syncOccurrenceId && !(cell.blockId && (cell.blockSize || 1) > 1)));
    if (!movable.length) break;
    const cell = movable[Math.floor(random() * movable.length)];
    if (!tryMoveCellToFreeSlot(schedule, records, options, cell, random)) continue;
    const next = makeCandidate(records, options, schedule, best.unassigned, seed + i + 1);
    if (next.summary.hardErrors > best.summary.hardErrors || next.summary.unassigned > best.summary.unassigned) continue;
    const penalty = qualityPenalty(records, options, next);
    if (penalty < bestPenalty) {
      best = next;
      bestPenalty = penalty;
    }
  }
  return best;
}

type SolvePrimaryMode = "standard" | "lunch-hard" | "consecutive-hard" | "combined-hard";

function solveAttempt(records: NormalizedRecords, options: Required<SolveOptions>, seed: number, profile: string, primaryMode: SolvePrimaryMode = "standard") {
  const random = seededRandom(seed);
  const primaryOptions: Required<SolveOptions> = {
    ...options,
    consecutiveStrictMode: primaryMode === "consecutive-hard" || primaryMode === "combined-hard" ? "three-plus" : options.consecutiveStrictMode,
    lunchProtectionLevel: (primaryMode === "lunch-hard" || primaryMode === "combined-hard") && lunchProtectionActive(options) ? "hard" : options.lunchProtectionLevel,
  };
  let schedule = emptySchedule(records);
  placeFixed(schedule, records);
  const unassignedItems: UnassignedItem[] = [];
  const units = buildWorkUnits(schedule, records, primaryOptions, random);
  const syncUnits = units.filter((unit) => unit.kind === "sync");
  const cohortResult = placeSyncCohorts(schedule, records, primaryOptions, syncUnits, random);
  schedule = cohortResult.schedule;
  const remainingSyncUnits = syncUnits.filter((unit) => !cohortResult.placedIds.has(unit.id));
  const syncResult = placeSyncUnitsWithBeam(schedule, records, primaryOptions, remainingSyncUnits, random, profile);
  schedule = syncResult.schedule;
  let failedUnits: WorkUnit[] = [];
  for (const unit of syncResult.unassignedUnits) {
    if (!placeWithRepair(schedule, records, options, unit, random, "repair")) failedUnits.push(unit);
  }
  const remainingUnits = orderedUnits(
    units
      .filter((unit) => unit.kind !== "sync")
      .map((unit) => makeWorkUnit(schedule, records, primaryOptions, unit.loads, random, unit.kind === "continuous" ? "continuous" : "normal")),
    random,
    options.variationMode === "varied" ? "varied" : profile,
  );
  for (const unit of remainingUnits) {
    if (!placeWithRepair(schedule, records, primaryOptions, unit, random, profile)) {
      failedUnits.push(unit);
    }
  }
  for (let pass = 0; pass < 3 && failedUnits.length; pass += 1) {
    const pending: WorkUnit[] = [];
    const reordered = orderedUnits(
      failedUnits.map((unit) => makeWorkUnit(schedule, records, options, unit.loads, random, unit.kind === "continuous" ? "continuous" : "normal")),
      random,
      "repair",
    );
    for (const unit of reordered) {
      if (!placeWithRepair(schedule, records, options, unit, random, "repair")) pending.push(unit);
    }
    if (pending.length === failedUnits.length) break;
    failedUnits = pending;
  }
  if (failedUnits.length) {
    const pending: WorkUnit[] = [];
    for (const unit of orderedUnits(failedUnits, random, "repair")) {
      if (
        !tryRepairContinuousUnitByEjection(schedule, records, options, unit, random, 300) &&
        !tryRebuildTeacherForUnit(schedule, records, options, unit, random, 260) &&
        !tryRepairSingleUnitByEjection(schedule, records, options, unit, random, 140) &&
        !tryDeepChainPlaceUnit(schedule, records, options, unit, random)
      ) pending.push(unit);
    }
    failedUnits = pending;
  }
  for (const unit of failedUnits) {
    for (const load of unit.loads) unassignedItems.push(unassigned(load, 1, unassignedReason(unit)));
  }
  const droppedLoads: LoadUnit[] = [];
  enforceHardConsecutiveByDropping(records, options, schedule, unassignedItems, droppedLoads);
  let droppedUnits = droppedLoads.map((load) => makeWorkUnit(schedule, records, options, [load], random, "normal"));
  for (let pass = 0; pass < 2 && droppedUnits.length; pass += 1) {
    const pending: WorkUnit[] = [];
    for (const unit of orderedUnits(droppedUnits, random, "repair")) {
      if (!placeWithRepair(schedule, records, options, unit, random, "repair")) pending.push(unit);
    }
    droppedUnits = pending;
    const redropped: LoadUnit[] = [];
    enforceHardConsecutiveByDropping(records, options, schedule, unassignedItems, redropped);
    droppedUnits.push(...redropped.map((load) => makeWorkUnit(schedule, records, options, [load], random, "normal")));
  }
  for (const unit of droppedUnits) {
    for (const load of unit.loads) unassignedItems.push(unassigned(load, 1, "4연강 hard 제약을 지키기 위해 후처리에서 미배정했습니다."));
  }
  const candidate = makeCandidate(records, options, schedule, unassignedItems, seed);
  return profile === "quality" || profile === "repair" ? improveQuality(records, options, candidate, random, seed) : candidate;
}

function repairUnassignedCandidate(records: NormalizedRecords, options: Required<SolveOptions>, candidate: Candidate, random: () => number, seed: number, maxMs: number) {
  if (!candidate.unassigned.length || candidate.summary.hardErrors) return candidate;
  const startedAt = Date.now();
  const schedule = cloneSchedule(candidate.schedule);
  const units = buildWorkUnits(schedule, records, options, random);
  const unitByLoadId = new Map<string, WorkUnit>();
  for (const unit of units) for (const load of unit.loads) unitByLoadId.set(load.id, unit);
  const targetUnits = [...new Set(candidate.unassigned.map((item) => unitByLoadId.get(item.loadId)).filter((unit): unit is WorkUnit => Boolean(unit)))]
    .sort((a, b) => b.pressure - a.pressure || a.possibleSlots - b.possibleSlots);
  const placedLoadIds = new Set<string>();

  const byTeacher = new Map<string, WorkUnit[]>();
  for (const unit of targetUnits) {
    if (unit.loads.length !== 1) continue;
    const list = byTeacher.get(unit.loads[0].teacherCode) || [];
    list.push(unit);
    byTeacher.set(unit.loads[0].teacherCode, list);
  }
  for (const teacherUnits of [...byTeacher.values()].sort((a, b) => b.length - a.length)) {
    if (Date.now() - startedAt >= maxMs) break;
    const remainingMs = Math.max(80, maxMs - (Date.now() - startedAt));
    if (tryRebuildTeacherForUnits(schedule, records, options, teacherUnits, random, Math.min(700, remainingMs))) {
      for (const teacherUnit of teacherUnits) for (const load of teacherUnit.loads) placedLoadIds.add(load.id);
    }
  }

  for (const unit of targetUnits) {
    if (unit.loads.every((load) => placedLoadIds.has(load.id))) continue;
    if (Date.now() - startedAt >= maxMs) break;
    const remainingMs = Math.max(50, maxMs - (Date.now() - startedAt));
    const placed = placeWithRepair(schedule, records, options, unit, random, "repair") ||
      (Date.now() - startedAt < maxMs && tryRepairContinuousUnitByEjection(schedule, records, options, unit, random, Math.min(500, remainingMs))) ||
      (Date.now() - startedAt < maxMs && tryRebuildTeacherForUnit(schedule, records, options, unit, random, Math.min(500, remainingMs))) ||
      (Date.now() - startedAt < maxMs && tryRepairSingleUnitByEjection(schedule, records, options, unit, random, Math.min(360, remainingMs))) ||
      (Date.now() - startedAt < maxMs && tryDeepChainPlaceUnit(schedule, records, options, unit, random, Math.min(300, remainingMs), 14000));
    if (placed) for (const load of unit.loads) placedLoadIds.add(load.id);
  }
  if (!placedLoadIds.size) return candidate;
  const remaining = candidate.unassigned.filter((item) => !placedLoadIds.has(item.loadId));
  const next = makeCandidate(records, options, schedule, remaining, seed);
  if (next.summary.hardErrors || next.summary.unassigned >= candidate.summary.unassigned) return candidate;
  return next;
}

function summarize(unassignedItems: UnassignedItem[], validation: ValidationResult): SolveSummary {
  const affectedTeacherCount = (type: string) => new Set(
    validation.violations
      .filter((item) => item.type === type && item.teacherCode)
      .map((item) => item.teacherCode as string),
  ).size;
  return {
    unassigned: unassignedItems.reduce((sum, item) => sum + item.hours, 0),
    hardErrors: validation.hardErrors,
    lunchIssues: affectedTeacherCount("lunch"),
    consecutiveIssues: affectedTeacherCount("consecutive"),
    balanceIssues: affectedTeacherCount("balance"),
  };
}

function signature(schedule: Schedule) {
  return Object.entries(schedule.classes)
    .flatMap(([classCode, cls]) => schedule.days.flatMap((day) => schedule.periods.map((period) => `${classCode}:${day}:${period}:${cls.grid[day][String(period)]?.id || "-"}`)))
    .join("|");
}

function betterThan(a: Candidate, b: Candidate | null, options: Required<SolveOptions>) {
  if (!b) return true;
  if (a.summary.hardErrors === 0 && b.summary.hardErrors > 0) return true;
  if (a.summary.hardErrors > 0 && b.summary.hardErrors === 0) return false;
  const teacherCount = (candidate: Candidate, key: SoftPriority) => {
    if (key === "consecutive") return teacherIssueTypeCount(candidate, "3연강");
    if (key === "lunch") return teacherIssueTypeCount(candidate, "식사");
    return teacherIssueTypeCount(candidate, "안배");
  };
  const teacherTarget = (key: SoftPriority) => key === "balance" ? 999 : SOFT_ISSUE_TEACHER_TARGET;
  const rawTarget = (key: SoftPriority) => key === "balance" ? 999 : SOFT_ISSUE_COUNT_TARGET - 1;
  const rawCount = (candidate: Candidate, key: SoftPriority) => key === "consecutive" ? candidate.summary.consecutiveIssues : key === "lunch" ? candidate.summary.lunchIssues : candidate.summary.balanceIssues;
  const targetVector = (candidate: Candidate) => {
    const lunchOver = Math.max(0, candidate.summary.lunchIssues - rawTarget("lunch"));
    const consecutiveOver = Math.max(0, candidate.summary.consecutiveIssues - rawTarget("consecutive"));
    const lunchTeacherOver = Math.max(0, teacherIssueTypeCount(candidate, "식사") - teacherTarget("lunch"));
    const consecutiveTeacherOver = Math.max(0, teacherIssueTypeCount(candidate, "3연강") - teacherTarget("consecutive"));
    return [
      Math.max(lunchOver, consecutiveOver),
      lunchOver + consecutiveOver,
      lunchOver,
      consecutiveOver,
      lunchTeacherOver + consecutiveTeacherOver,
      lunchTeacherOver,
      consecutiveTeacherOver,
    ];
  };
  const rawOverVector = (candidate: Candidate) => options.softPriorityOrder.map((key) => Math.max(0, rawCount(candidate, key) - rawTarget(key)));
  const teacherOverVector = (candidate: Candidate) => options.softPriorityOrder.map((key) => Math.max(0, teacherCount(candidate, key) - teacherTarget(key)));
  const teacherCountVector = (candidate: Candidate) => options.softPriorityOrder.map((key) => teacherCount(candidate, key));
  const rawVector = (candidate: Candidate) => options.softPriorityOrder.map((key) => rawCount(candidate, key));
  const av = [a.summary.unassigned, a.summary.hardErrors, ...targetVector(a), ...rawOverVector(a), ...teacherOverVector(a), ...rawVector(a), ...teacherCountVector(a)];
  const bv = [b.summary.unassigned, b.summary.hardErrors, ...targetVector(b), ...rawOverVector(b), ...teacherOverVector(b), ...rawVector(b), ...teacherCountVector(b)];
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) return av[i] < bv[i];
  }
  const qualityDelta = summaryQualityPenalty(a, options) - summaryQualityPenalty(b, options);
  if (qualityDelta !== 0) return qualityDelta < 0;
  return a.signature !== b.signature;
}

function needsSoftPostOptimization(candidate: Candidate | null) {
  return Boolean(candidate &&
    candidate.summary.unassigned === 0 &&
    candidate.summary.hardErrors === 0 &&
    (
      candidate.summary.lunchIssues >= SOFT_ISSUE_COUNT_TARGET ||
      candidate.summary.consecutiveIssues >= SOFT_ISSUE_COUNT_TARGET
    ));
}

function targetRemaining(summary: SolveSummary) {
  return {
    unassigned: summary.unassigned,
    hardErrors: summary.hardErrors,
    lunchIssues: Math.max(0, summary.lunchIssues - (SOFT_ISSUE_COUNT_TARGET - 1)),
    consecutiveIssues: Math.max(0, summary.consecutiveIssues - (SOFT_ISSUE_COUNT_TARGET - 1)),
  };
}

function targetReached(summary: SolveSummary) {
  const remaining = targetRemaining(summary);
  return remaining.unassigned === 0 && remaining.hardErrors === 0 && remaining.lunchIssues === 0 && remaining.consecutiveIssues === 0;
}

export function runChunk(runtime: Runtime) {
  if (runtime.stopped) return runtime.best;
  runtime.chunkCount += 1;
  const start = Date.now();
  let changed = false;
  if (runtime.best?.summary.unassigned && runtime.best.summary.hardErrors === 0) {
    const seed = Date.now() + runtime.chunkCount * 15485863;
    const repairBudget = runtime.best.summary.unassigned <= 4 ? 2200 : 850;
    const repaired = repairUnassignedCandidate(runtime.records, runtime.options, runtime.best, seededRandom(seed), seed, repairBudget);
    if (betterThan(repaired, runtime.best, runtime.options)) {
      runtime.best = repaired;
      runtime.lastResult = repaired;
      runtime.bestChangedAt = nowKst();
      runtime.lastReasons = [...new Set(repaired.unassigned.map((item) => item.reason))].slice(0, 5);
      changed = true;
    }
  }
  const softPolishMode = needsSoftPostOptimization(runtime.best);
  const targetDebt = runtime.best
    ? targetRemaining(runtime.best.summary).lunchIssues + targetRemaining(runtime.best.summary).consecutiveIssues
    : 0;
  if (softPolishMode && targetDebt > 0) {
    if (targetDebt < runtime.lastTargetDebt) {
      runtime.softStagnation = 0;
      runtime.lastTargetDebt = targetDebt;
    } else {
      runtime.softStagnation += 1;
    }
  } else if (!softPolishMode) {
    runtime.softStagnation = 0;
    runtime.lastTargetDebt = Number.POSITIVE_INFINITY;
  }
  const exploreFreshCandidate = !softPolishMode ||
    (targetDebt > 0 && runtime.softStagnation >= 4 && runtime.chunkCount % 3 === 0) ||
    (targetDebt <= 0 && runtime.chunkCount % 12 === 0);
  const attempts = exploreFreshCandidate
    ? (softPolishMode ? (runtime.softStagnation >= 8 ? 2 : 1) : Math.max(1, Math.min(8, Math.ceil((runtime.options.minAssignmentIterations || 20) / 20) * (runtime.options.placementLevel || 1))))
    : 0;
  const profile = softPolishMode && runtime.softStagnation >= 5 ? "repair" : profileForChunk(runtime.chunkCount);
  for (let i = 0; i < attempts; i += 1) {
    runtime.attemptCount += 1;
    const seed = Date.now() + runtime.attemptCount * 7919 + Math.floor(Math.random() * 100000);
    let primaryMode: SolvePrimaryMode = "standard";
    if (runtime.best?.summary.unassigned === 0 && runtime.best.summary.hardErrors === 0) {
      const remaining = targetRemaining(runtime.best.summary);
      if (runtime.softStagnation >= 10) primaryMode = "combined-hard";
      else if (runtime.softStagnation >= 5 && remaining.lunchIssues >= remaining.consecutiveIssues && remaining.lunchIssues > 0) primaryMode = "lunch-hard";
      else if (runtime.softStagnation >= 5 && remaining.consecutiveIssues > 0) primaryMode = "consecutive-hard";
      else primaryMode = "standard";
    } else if (runtime.chunkCount > 10 && runtime.attemptCount % 5 === 0) {
      primaryMode = "lunch-hard";
    }
    let candidate = solveAttempt(runtime.records, runtime.options, seed, profile, primaryMode);
    if (candidate.summary.unassigned > 0 && candidate.summary.hardErrors === 0) {
      const repairBudget = candidate.summary.unassigned <= 4 ? 2200 : 1000;
      candidate = repairUnassignedCandidate(runtime.records, runtime.options, candidate, seededRandom(seed ^ 0xc2b2ae35), seed ^ 0x27d4eb2f, repairBudget);
    }
    if (candidate.summary.unassigned === 0 && candidate.summary.hardErrors === 0 && (candidate.summary.lunchIssues || candidate.summary.consecutiveIssues || candidate.summary.balanceIssues)) {
      const optimized = postOptimizeCandidate(runtime.records, runtime.options, candidate, seededRandom(seed ^ 0x9e3779b9), seed);
      candidate = optimized.candidate;
      runtime.postOptimizeImprovementCount += optimized.improvements;
      runtime.postOptimizeSoftPenalty = optimized.afterCost;
      runtime.postOptimizeSoftDelta = Math.max(0, optimized.beforeCost - optimized.afterCost);
    }
    runtime.lastResult = candidate;
    runtime.lastReasons = [...new Set(candidate.unassigned.map((item) => item.reason))].slice(0, 5);
    if (betterThan(candidate, runtime.best, runtime.options)) {
      runtime.best = candidate;
      runtime.bestChangedAt = nowKst();
      const nextDebt = targetRemaining(candidate.summary).lunchIssues + targetRemaining(candidate.summary).consecutiveIssues;
      runtime.lastTargetDebt = nextDebt;
      runtime.softStagnation = 0;
      changed = true;
    }
    if (Date.now() - start > 140) break;
  }
  const softPasses = runtime.best?.summary.unassigned === 0 && runtime.best?.summary.hardErrors === 0 ? 1 : 1;
  for (let pass = 0; pass < softPasses && needsSoftPostOptimization(runtime.best); pass += 1) {
    const seed = Date.now() + runtime.attemptCount * 3571 + pass * 104729 + Math.floor(Math.random() * 100000);
    const before = runtime.best!;
    const optimized = postOptimizeCandidate(runtime.records, runtime.options, before, seededRandom(seed ^ 0x85ebca6b), seed);
    runtime.postOptimizeImprovementCount += optimized.improvements;
    runtime.postOptimizeSoftPenalty = optimized.afterCost;
    runtime.postOptimizeSoftDelta = Math.max(0, optimized.beforeCost - optimized.afterCost);
    if (optimized.candidate.signature !== before.signature && betterThan(optimized.candidate, before, runtime.options)) {
      runtime.best = optimized.candidate;
      runtime.lastResult = optimized.candidate;
      runtime.bestChangedAt = nowKst();
      const nextDebt = targetRemaining(optimized.candidate.summary).lunchIssues + targetRemaining(optimized.candidate.summary).consecutiveIssues;
      runtime.lastTargetDebt = nextDebt;
      runtime.softStagnation = 0;
      changed = true;
    } else if (!optimized.improvements) {
      break;
    }
  }
  return { candidate: runtime.best, changed };
}

export function progress(runtime: Runtime, changed = false): SolverProgress {
  const postOptimizeActive = runtime.chunkCount > 10 && Boolean(runtime.best && runtime.best.summary.unassigned === 0 && runtime.best.summary.hardErrors === 0);
  const phase = postOptimizeActive ? "tabu-post-optimize" : runtime.chunkCount <= 1 ? "preprocess" : runtime.chunkCount <= 3 ? "bottleneck-csp" : runtime.chunkCount <= 6 ? "grade-csp" : runtime.chunkCount <= 10 ? "repair" : "ga-quality";
  const phaseLabel = phase === "preprocess" ? "전처리" : phase === "bottleneck-csp" ? "병목 배치" : phase === "grade-csp" ? "학년별 배치" : phase === "repair" ? "미배정 보정" : phase === "tabu-post-optimize" ? "후처리 최적화" : "품질 개선";
  const bestSummary = runtime.best?.summary || { unassigned: 0, hardErrors: 0, lunchIssues: 0, consecutiveIssues: 0, balanceIssues: 0 };
  const remaining = targetRemaining(bestSummary);
  return {
    chunkCount: runtime.chunkCount,
    attemptCount: runtime.attemptCount,
    phase,
    phaseLabel,
    bestChanged: changed,
    bestChangedAt: runtime.bestChangedAt,
    bestSummary,
    activeProfiles: phase === "preprocess" ? ["fixed-lock", "conflict-graph"] : phase === "bottleneck-csp" ? ["sync-first", "room-first", "multi-grade"] : phase === "grade-csp" ? ["grade-divide", "forward-checking"] : phase === "repair" ? ["relocation", "same-class-swap", "teacher-free-slot"] : phase === "tabu-post-optimize" ? ["tabu-search", "teacher-issue-focus", "hard-safe-swap", ...(runtime.softStagnation >= 5 ? ["soft-stagnation-escape"] : [])] : ["hard-safe-local-search", "balance"],
    lastResultSummary: runtime.lastResult?.summary,
    unassignedReasons: runtime.lastReasons,
    postOptimizeImprovementCount: runtime.postOptimizeImprovementCount,
    postOptimizeSoftPenalty: runtime.postOptimizeSoftPenalty,
    postOptimizeSoftDelta: runtime.postOptimizeSoftDelta,
    targetReached: targetReached(bestSummary),
    targetRemaining: remaining,
  };
}

export function diagnostics(records: NormalizedRecords, candidate: Candidate | null): Diagnostics {
  const summary = candidate?.summary || { unassigned: 0, hardErrors: 0, lunchIssues: 0, consecutiveIssues: 0, balanceIssues: 0 };
  const syncMap = new Map<string, { assigned: number; unassigned: number }>();
  const syncGroupClasses = new Map<string, Set<string>>();
  for (const load of records.loads) {
    if (!load.syncGroup) continue;
    const classes = syncGroupClasses.get(load.syncGroup) || new Set<string>();
    classes.add(load.classCode);
    syncGroupClasses.set(load.syncGroup, classes);
  }
  if (candidate) {
    for (const cls of Object.values(candidate.schedule.classes)) {
      for (const day of candidate.schedule.days) {
        for (const cell of Object.values(cls.grid[day])) {
          if (cell?.syncGroup) {
            const item = syncMap.get(cell.syncGroup) || { assigned: 0, unassigned: 0 };
            item.assigned += 1;
            syncMap.set(cell.syncGroup, item);
          }
        }
      }
    }
    for (const item of candidate.unassigned) {
      const load = records.loads.find((loadItem) => item.loadId.startsWith(loadItem.id));
      if (load?.syncGroup) {
        const group = syncMap.get(load.syncGroup) || { assigned: 0, unassigned: 0 };
        group.unassigned += item.hours;
        syncMap.set(load.syncGroup, group);
      }
    }
  }
  const cohortMap = new Map<string, { groups: Set<string>; classCount: number; assigned: number; unassigned: number; possibleSlots: number }>();
  for (const [group, classes] of syncGroupClasses) {
    const key = [...classes].sort((a, b) => a.localeCompare(b, "ko")).join("|");
    const item = cohortMap.get(key) || { groups: new Set<string>(), classCount: classes.size, assigned: 0, unassigned: 0, possibleSlots: 0 };
    item.groups.add(group);
    const sync = syncMap.get(group);
    item.assigned += sync?.assigned || 0;
    item.unassigned += sync?.unassigned || 0;
    item.possibleSlots = Math.max(item.possibleSlots, records.config.days.reduce((sum, day) => (
      sum + Array.from({ length: records.config.maxPeriod }, (_, index) => index + 1).filter((period) => (
        [...classes].every((classCode) => !isBeyondClassDayLimit(records, classCode, day, period) && !records.fixed.some((fixed) => fixed.classCode === classCode && fixed.day === day && fixed.period === period))
      )).length
    ), 0));
    cohortMap.set(key, item);
  }
  return {
    unassigned: candidate?.unassigned || [],
    teacherIssues: candidate?.teacherIssues || [],
    syncGroups: [...syncMap.entries()].map(([group, value]) => ({ group, assigned: value.assigned, unassigned: value.unassigned, method: "sync-first beam + relocation" })),
    syncCohorts: [...cohortMap.entries()].filter(([, value]) => value.groups.size >= 2).map(([cohort, value]) => ({
      cohort,
      groups: [...value.groups].sort((a, b) => a.localeCompare(b, "ko")).join(", "),
      classCount: value.classCount,
      assigned: value.assigned,
      unassigned: value.unassigned,
      possibleSlots: value.possibleSlots,
      reason: value.unassigned ? "코호트 공통 슬롯 부족 또는 이전 코호트가 슬롯 소진" : "cohort sync pack",
    })),
    neis: Object.values(records.subjects).filter((subject) => !subject.neisName).map((subject) => ({ type: "subject", message: `${subject.name} NEIS 과목명이 비어 있습니다.` })),
    summary,
  };
}

export function accept(runtime: Runtime) {
  if (!runtime.best) {
    const result = runChunk(runtime);
    if (result && "candidate" in result) runtime.best = result.candidate;
  }
  return runtime.best;
}

export function stop(runtime: Runtime) {
  runtime.stopped = true;
}

function cellsByTeacher(schedule: Schedule, teacherCode: string) {
  return scheduleCache(schedule).teacherCells.get(teacherCode) || [];
}

export function validateSchedule(records: NormalizedRecords, schedule: Schedule, options: Required<SolveOptions>): ValidationResult {
  const violations: ValidationResult["violations"] = [];
  let hardErrors = 0;
  let lunchIssues = 0;
  let consecutiveIssues = 0;
  let balanceIssues = 0;
  for (const day of schedule.days) {
    for (const period of schedule.periods) {
      const teachers = new Map<string, string>();
      const rooms = new Map<string, string>();
      for (const cls of Object.values(schedule.classes)) {
        const cell = cls.grid[day]?.[String(period)];
        if (!cell) continue;
        if (!cell.fixed && isBeyondClassDayLimit(records, cell.classCode, day, period)) {
          hardErrors += 1;
          violations.push({ type: "class-day-limit", severity: "hard", message: `${cell.className} ${day}${period}교시는 요일별시수 범위를 초과합니다.` });
        }
        if (cell.teacherCode) {
          const previous = teachers.get(cell.teacherCode);
          if (previous) {
            hardErrors += 1;
            violations.push({ type: "teacher-conflict", severity: "hard", message: `${cell.teacherName || cell.teacherCode} ${day}${period}교시 교사 중복: ${previous}, ${cell.className}` });
          } else {
            teachers.set(cell.teacherCode, cell.className);
          }
        }
        if (cell.roomCode) {
          const previous = rooms.get(cell.roomCode);
          if (previous) {
            hardErrors += 1;
            violations.push({ type: "room-conflict", severity: "hard", message: `${cell.roomName || cell.roomCode} ${day}${period}교시 특별실 중복: ${previous}, ${cell.className}` });
          } else {
            rooms.set(cell.roomCode, cell.className);
          }
        }
      }
    }
  }
  for (const teacher of Object.values(records.teachers)) {
    for (const day of records.config.days) {
      const periods = cellsByTeacher(schedule, teacher.code).filter((cell) => cell.day === day && !cell.fixed).map((cell) => cell.period).sort((a, b) => a - b);
      const warnThreshold = Math.max(3, options.consecutiveWarnThreshold || 3);
      for (const runPeriods of consecutiveRuns(periods, warnThreshold)) {
        const runLength = runPeriods.length;
        const severity = options.consecutiveStrictMode === "three-plus" || (options.consecutiveStrictMode === "over-max" && runLength > options.maxConsecutive) ? "hard" : "soft";
        if (severity === "hard") hardErrors += 1;
        consecutiveIssues += 1;
        violations.push({ type: "consecutive", severity, teacherCode: teacher.code, day, periods: runPeriods, runLength, message: `${teacher.name} ${day} ${runPeriods.join(",")}교시 ${runLength}연강` });
      }
      const dayMax = teacherDayMaxFor(options, day);
      if (dayMax && periods.length > dayMax) {
        if (options.teacherDayMaxStrict) hardErrors += 1;
        violations.push({ type: "teacher-day-max", severity: options.teacherDayMaxStrict ? "hard" : "soft", message: `${teacher.name} ${day}요일 최대 배정시간수 ${dayMax}시간 초과` });
      }
      if (lunchProtectionActive(options) && hasLunchBoundaryIssue(records, periods)) {
        if (options.lunchProtectionLevel === "hard") hardErrors += 1;
        lunchIssues += 1;
        violations.push({ type: "lunch", severity: options.lunchProtectionLevel === "hard" ? "hard" : "soft", teacherCode: teacher.code, day, periods: lunchBoundaryPair(records), message: `${teacher.name} ${day} 점심 전후 연속` });
      }
    }
    const byDay = records.config.days.map((day) => teacherDailyLoadRatio(records, schedule, teacher.code, day));
    if (Math.max(...byDay, 0) - Math.min(...byDay, 0) >= 0.45 && options.balanceStrength !== "off") {
      balanceIssues += 1;
      violations.push({ type: "balance", severity: "soft", teacherCode: teacher.code, message: `${teacher.name} 요일 안배 부족` });
    }
  }
  for (const cls of Object.values(schedule.classes)) {
    for (const day of schedule.days) {
      const seen = new Set<string>();
      for (const cell of Object.values(cls.grid[day])) {
        if (!cell?.syncOccurrenceId) continue;
        seen.add(`${cell.syncOccurrenceId}:${cell.day}:${cell.period}`);
      }
      const occurrences = new Map<string, Set<string>>();
      for (const classTable of Object.values(schedule.classes)) {
        for (const cell of Object.values(classTable.grid[day])) {
          if (!cell?.syncOccurrenceId) continue;
          const set = occurrences.get(cell.syncOccurrenceId) || new Set<string>();
          set.add(`${cell.day}:${cell.period}`);
          occurrences.set(cell.syncOccurrenceId, set);
        }
      }
      for (const [occurrence, slots] of occurrences) {
        if (slots.size > 1) {
          hardErrors += 1;
          violations.push({ type: "sync", severity: "hard", message: `${occurrence} 동시그룹이 서로 다른 시간에 배정되었습니다.` });
        }
      }
    }
  }
  const blockMap = new Map<string, ScheduleCell[]>();
  for (const cell of allCells(schedule)) {
    if (!cell.blockId || (cell.blockSize || 1) <= 1) continue;
    const list = blockMap.get(cell.blockId) || [];
    list.push(cell);
    blockMap.set(cell.blockId, list);
  }
  for (const [blockId, cells] of blockMap) {
    const sorted = cells.sort((a, b) => (a.blockPart || 1) - (b.blockPart || 1));
    const first = sorted[0];
    const sameDay = sorted.every((cell) => cell.day === first.day && cell.classCode === first.classCode);
    const consecutive = sorted.every((cell, index) => cell.period === first.period + index);
    if (!sameDay || !consecutive || sorted.length !== (first.blockSize || sorted.length)) {
      hardErrors += 1;
      violations.push({ type: "continuous-block", severity: "hard", message: `${blockId} 연속수업 묶음이 분리되었습니다.` });
    }
  }
  for (const item of similarSubjectSameDayViolations(records, schedule, false)) {
    hardErrors += 1;
    violations.push({
      type: "same-subject-same-day",
      severity: "hard",
      message: `${item.className} ${item.day} 같은 과목 같은 날 중복: ${item.subjectName}`,
    });
  }
  if (options.sameSubjectSameDay) {
    for (const item of similarSubjectSameDayViolations(records, schedule, true).filter((entry) => entry.similar)) {
      hardErrors += 1;
      violations.push({
        type: "similar-subject-same-day",
        severity: "hard",
        message: `${item.className} ${item.day} ${item.similar ? "유사과목" : "같은 과목"} 같은 날 중복: ${item.subjectName}`,
      });
    }
  }
  return { hardErrors, lunchIssues, consecutiveIssues, balanceIssues, violations };
}

export function summarizeTeacherIssues(records: NormalizedRecords, schedule: Schedule, validation: ValidationResult): TeacherIssue[] {
  return Object.values(records.teachers).map((teacher) => {
    const cells = cellsByTeacher(schedule, teacher.code).filter((cell) => !cell.fixed);
    const issues: string[] = [];
    const detail: string[] = [];
    const teacherViolations = validation.violations.filter((item) => item.teacherCode === teacher.code || item.message.includes(teacher.name));
    if (teacherViolations.some((item) => item.type === "consecutive")) issues.push("3연강");
    if (teacherViolations.some((item) => item.type === "lunch")) issues.push("식사");
    if (teacherViolations.some((item) => item.type === "balance")) issues.push("안배");
    for (const item of teacherViolations.filter((violation) => violation.type === "consecutive")) {
      detail.push(`${item.day || ""}${item.runLength || 3}연강`);
    }
    for (const item of teacherViolations.filter((violation) => violation.type === "lunch")) {
      detail.push(`${item.day || ""}점심`);
    }
    for (const day of records.config.days) {
      const count = cells.filter((cell) => cell.day === day).length;
      if (count) detail.push(`${day}${count}`);
    }
    return { teacherCode: teacher.code, teacherName: teacher.name, hours: cells.length, issues, detail: detail.join(" ") };
  }).filter((item) => item.issues.length).sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko"));
}

function allCells(schedule: Schedule) {
  return scheduleCache(schedule).cells;
}

function uniqueCells(cells: ScheduleCell[]) {
  const seen = new Set<string>();
  const result: ScheduleCell[] = [];
  for (const cell of cells) {
    const key = `${cell.classCode}:${cell.day}:${cell.period}:${cell.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cell);
  }
  return result;
}

function affectedTeachers(beforeCells: ScheduleCell[], afterCells: ScheduleCell[]) {
  const teachers = new Map<string, { teacherCode?: string; teacherName?: string; beforeCells: ScheduleCell[]; afterCells: ScheduleCell[] }>();
  for (const cell of beforeCells) {
    const key = cell.teacherCode || cell.teacherName || "-";
    const item = teachers.get(key) || { teacherCode: cell.teacherCode, teacherName: cell.teacherName, beforeCells: [], afterCells: [] };
    item.beforeCells.push(cell);
    teachers.set(key, item);
  }
  for (const cell of afterCells) {
    const key = cell.teacherCode || cell.teacherName || "-";
    const item = teachers.get(key) || { teacherCode: cell.teacherCode, teacherName: cell.teacherName, beforeCells: [], afterCells: [] };
    item.afterCells.push(cell);
    teachers.set(key, item);
  }
  return [...teachers.values()].filter((item) => item.teacherCode || item.teacherName);
}

function blockCells(schedule: Schedule, cell: ScheduleCell) {
  if (cell.syncOccurrenceId) return allCells(schedule).filter((item) => item.syncOccurrenceId === cell.syncOccurrenceId);
  if (cell.blockId && (cell.blockSize || 1) > 1) return allCells(schedule).filter((item) => item.blockId === cell.blockId);
  return [cell];
}

function isAtomicCell(cell: ScheduleCell | null | undefined) {
  return Boolean(cell?.syncOccurrenceId || (cell?.blockId && (cell.blockSize || 1) > 1));
}

function cellIdMultiset(schedule: Schedule) {
  return allCells(schedule)
    .filter((cell) => !cell.fixed)
    .map((cell) => cell.id)
    .sort()
    .join("|");
}

function moveIntegrityMessage(before: Schedule, after: Schedule, validation: ValidationResult, previousHardErrors: number) {
  if (cellIdMultiset(before) !== cellIdMultiset(after)) return "수동수정 결과 수업 개수가 달라져 적용하지 않았습니다.";
  if (validation.hardErrors > previousHardErrors) return "수동수정 결과 교사/학급/특별실/묶음 충돌이 생겨 적용하지 않았습니다.";
  return "";
}

function shiftedBlockCells(schedule: Schedule, cells: ScheduleCell[], step: ManualMoveStep) {
  const sorted = [...cells].sort((a, b) => (a.blockPart || 1) - (b.blockPart || 1));
  const basePart = sorted[0]?.blockPart || 1;
  const targetClass = step.to.classCode || step.from.classCode;
  return sorted.map((cell) => {
    const nextClass = cell.syncOccurrenceId ? cell.classCode : targetClass;
    const nextClassName = cell.syncOccurrenceId ? cell.className : (schedule.classes[nextClass]?.className || sorted[0]?.className || "");
    const offset = cell.syncOccurrenceId ? 0 : (cell.blockPart || basePart) - basePart;
    return { ...cell, classCode: nextClass, className: nextClassName, day: step.to.day, period: step.to.period + offset };
  });
}

function stepSourceCell(schedule: Schedule, step: ManualMoveStep) {
  return schedule.classes[step.from.classCode]?.grid[step.from.day]?.[String(step.from.period)] || null;
}

function stepTargetCell(schedule: Schedule, step: ManualMoveStep) {
  const targetClass = step.to.classCode || step.from.classCode;
  return schedule.classes[targetClass]?.grid[step.to.day]?.[String(step.to.period)] || null;
}

function chainSteps(move: ManualMove): ManualMoveStep[] {
  return move.steps?.length ? move.steps : [{ from: move.from, to: move.to }];
}

function applyChainToSchedule(schedule: Schedule, steps: ManualMoveStep[]) {
  const sourceGroups = steps.map((step) => {
    const source = stepSourceCell(schedule, step);
    if (!source || source.fixed) return null;
    const cells = blockCells(schedule, source);
    return { step, cells, shifted: shiftedBlockCells(schedule, cells, step) };
  });
  if (sourceGroups.some((group) => !group)) return false;
  const groups = sourceGroups as Array<{ step: ManualMoveStep; cells: ScheduleCell[]; shifted: ScheduleCell[] }>;
  const sourceSlots = new Set(groups.flatMap((group) => group.cells.map((cell) => `${cell.classCode}:${cell.day}:${cell.period}`)));
  for (const group of groups) {
    for (const cell of group.shifted) {
      const existing = schedule.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null;
      if (existing?.fixed) return false;
      if (existing && !sourceSlots.has(`${existing.classCode}:${existing.day}:${existing.period}`)) return false;
    }
  }
  for (const group of groups) {
    for (const cell of group.cells) schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = null;
  }
  for (const group of groups) {
    for (const cell of group.shifted) schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = cell;
  }
  invalidateScheduleCache(schedule);
  return true;
}

function enhancedMovePreview(candidate: Candidate, move: ManualMove): MovePreview {
  const steps = chainSteps(move);
  if (steps.length > 1) {
    const beforeCells = uniqueCells(steps.flatMap((step) => {
      const source = stepSourceCell(candidate.schedule, step);
      return source ? blockCells(candidate.schedule, source) : [];
    }));
    const schedule = cloneSchedule(candidate.schedule);
    if (!beforeCells.length || !applyChainToSchedule(schedule, steps)) return { ok: false, message: "연쇄 이동 미리보기를 만들 수 없습니다.", beforeCells, afterCells: [] };
    const afterCells = uniqueCells(steps.flatMap((step) => {
      const source = stepSourceCell(candidate.schedule, step);
      return source ? shiftedBlockCells(schedule, blockCells(candidate.schedule, source), step) : [];
    }));
    return { ok: true, message: move.chainLabel || `연쇄 ${steps.length}단계 이동 미리보기`, beforeCells, afterCells, affectedTeachers: affectedTeachers(beforeCells, afterCells) };
  }
  const step = steps[0];
  const fromCell = stepSourceCell(candidate.schedule, step);
  if (!fromCell) return { ok: false, message: "선택한 칸에 수업이 없습니다.", beforeCells: [], afterCells: [] };
  const toCell = stepTargetCell(candidate.schedule, step);
  if (fromCell.fixed || toCell?.fixed) return { ok: false, message: "고정 일과는 수동 이동 대상이 아닙니다.", beforeCells: [fromCell], afterCells: [] };
  if (!isAtomicCell(fromCell) && isAtomicCell(toCell)) {
    return { ok: false, message: "동시수업/연속수업이 있는 도착 칸은 묶음 전체를 함께 이동해야 합니다.", beforeCells: [fromCell, toCell].filter(Boolean) as ScheduleCell[], afterCells: [] };
  }
  if (fromCell.syncOccurrenceId || (fromCell.blockId && (fromCell.blockSize || 1) > 1)) {
    const groupCells = blockCells(candidate.schedule, fromCell);
    const shifted = shiftedBlockCells(candidate.schedule, groupCells, step);
    const targetCells = shifted
      .map((cell) => candidate.schedule.classes[cell.classCode]?.grid[cell.day]?.[String(cell.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell && !groupCells.some((source) => source.classCode === cell.classCode && source.day === cell.day && source.period === cell.period)));
    if (targetCells.some((cell) => cell.fixed)) return { ok: false, message: "묶음 수업은 고정 일과가 있는 시간으로 이동할 수 없습니다.", beforeCells: groupCells, afterCells: [] };
    if (targetCells.length) return { ok: false, message: "묶음 수업은 대상 칸들이 모두 비어 있을 때만 이동할 수 있습니다.", beforeCells: groupCells.concat(targetCells), afterCells: [] };
    return { ok: true, message: fromCell.syncOccurrenceId ? "동시그룹 묶음 이동 미리보기" : "연속수업 묶음 이동 미리보기", beforeCells: groupCells, afterCells: shifted, affectedTeachers: affectedTeachers(groupCells, shifted) };
  }
  const toClass = step.to.classCode || step.from.classCode;
  const afterFrom = toCell ? { ...toCell, classCode: fromCell.classCode, className: fromCell.className, day: fromCell.day, period: fromCell.period } : null;
  const afterTo = { ...fromCell, classCode: toClass, className: candidate.schedule.classes[toClass].className, day: step.to.day, period: step.to.period };
  const beforeCells = [fromCell, ...(toCell ? [toCell] : [])];
  const afterCells = [afterTo, ...(afterFrom ? [afterFrom] : [])];
  return { ok: true, message: toCell ? "맞교환 미리보기" : "이동 미리보기", beforeCells, afterCells, affectedTeachers: affectedTeachers(beforeCells, afterCells) };
}

function enhancedApplyMove(records: NormalizedRecords, candidate: Candidate, move: ManualMove, options: SolveOptions = {}) {
  const preview = enhancedMovePreview(candidate, move);
  if (!preview.ok) return candidate;
  const schedule = cloneSchedule(candidate.schedule);
  const steps = chainSteps(move);
  const source = stepSourceCell(schedule, steps[0]);
  if (steps.length > 1 || source?.syncOccurrenceId || (source?.blockId && (source.blockSize || 1) > 1)) {
    if (!applyChainToSchedule(schedule, steps)) return candidate;
  } else {
    const step = steps[0];
    const fromCell = stepSourceCell(schedule, step);
    const toClass = step.to.classCode || step.from.classCode;
    const toCell = stepTargetCell(schedule, step);
    schedule.classes[toClass].grid[step.to.day][String(step.to.period)] = fromCell ? { ...fromCell, classCode: toClass, className: schedule.classes[toClass].className, day: step.to.day, period: step.to.period } : null;
    schedule.classes[step.from.classCode].grid[step.from.day][String(step.from.period)] = toCell ? { ...toCell, classCode: step.from.classCode, className: schedule.classes[step.from.classCode].className, day: step.from.day, period: step.from.period } : null;
  }
  const validation = validateSchedule(records, schedule, requiredOptions(options));
  const integrityMessage = moveIntegrityMessage(candidate.schedule, schedule, validation, candidate.summary.hardErrors);
  if (integrityMessage) return candidate;
  const teacherIssues = summarizeTeacherIssues(records, schedule, validation);
  const updated: Candidate = { ...candidate, schedule, validation, teacherIssues, summary: summarize(candidate.unassigned, validation), signature: signature(schedule) };
  updated.summary.signature = updated.signature;
  return updated;
}

type MoveTransactionResult = {
  ok: boolean;
  preview: MovePreview;
  candidate?: Candidate;
  failureReason?: string;
};

function hardFailureReason(validation: ValidationResult) {
  const hard = validation.violations.find((item) => item.severity === "hard");
  if (!hard) return "";
  if (hard.type === "class-day-limit") return "요일별시수 초과";
  if (hard.type === "similar-subject-same-day") return "유사과목 같은 날 중복";
  if (hard.type === "same-subject-same-day") return "같은 과목 같은 날 중복";
  if (hard.type === "sync") return "동시수업 묶음 분리";
  if (hard.type === "continuous-block") return "연속수업 묶음 분리";
  if (hard.type === "teacher-conflict") return "교사 시간 중복";
  if (hard.type === "room-conflict") return "특별실 시간 중복";
  return hard.message || "hard 제약 위반";
}

export function simulateMoveTransaction(records: NormalizedRecords, candidate: Candidate, move: ManualMove, options: SolveOptions = {}): MoveTransactionResult {
  const rawPreview = enhancedMovePreview(candidate, move);
  if (!rawPreview.ok) {
    const failureReason = rawPreview.failureReason || rawPreview.message;
    return { ok: false, preview: { ...rawPreview, ok: false, failureReason, message: failureReason }, failureReason };
  }

  const schedule = cloneSchedule(candidate.schedule);
  const steps = chainSteps(move);
  const source = stepSourceCell(schedule, steps[0]);
  let applied = false;
  if (steps.length > 1 || source?.syncOccurrenceId || (source?.blockId && (source.blockSize || 1) > 1)) {
    applied = applyChainToSchedule(schedule, steps);
  } else {
    const step = steps[0];
    const fromCell = stepSourceCell(schedule, step);
    const toClass = step.to.classCode || step.from.classCode;
    const toCell = stepTargetCell(schedule, step);
    if (fromCell && schedule.classes[toClass]) {
      schedule.classes[toClass].grid[step.to.day][String(step.to.period)] = { ...fromCell, classCode: toClass, className: schedule.classes[toClass].className, day: step.to.day, period: step.to.period };
      schedule.classes[step.from.classCode].grid[step.from.day][String(step.from.period)] = toCell ? { ...toCell, classCode: step.from.classCode, className: schedule.classes[step.from.classCode].className, day: step.from.day, period: step.from.period } : null;
      applied = true;
    }
  }

  if (!applied) {
    const failureReason = "동시/연속수업 묶음 또는 도착 칸 점유를 해결할 수 없습니다.";
    return { ok: false, preview: { ...rawPreview, ok: false, failureReason, message: failureReason }, failureReason };
  }

  const validation = validateSchedule(records, schedule, requiredOptions(options));
  let failureReason = moveIntegrityMessage(candidate.schedule, schedule, validation, candidate.summary.hardErrors);
  if (!failureReason && signature(schedule) === candidate.signature) failureReason = "이동 후 시간표가 바뀌지 않습니다.";
  if (!failureReason && validation.hardErrors > candidate.summary.hardErrors) failureReason = hardFailureReason(validation) || "hard 제약 위반";
  if (failureReason) {
    const message = hardFailureReason(validation) || failureReason;
    return { ok: false, preview: { ...rawPreview, ok: false, failureReason: message, message }, failureReason: message };
  }

  const teacherIssues = summarizeTeacherIssues(records, schedule, validation);
  const updated: Candidate = { ...candidate, schedule, validation, teacherIssues, summary: summarize(candidate.unassigned, validation), signature: signature(schedule) };
  updated.summary.signature = updated.signature;
  return { ok: true, preview: rawPreview, candidate: updated };
}

export function movePreview(candidate: Candidate, move: ManualMove): MovePreview {
  return enhancedMovePreview(candidate, move);
  const fromCell = candidate.schedule.classes[move.from.classCode]?.grid[move.from.day]?.[String(move.from.period)]!;
  const toClass = move.to.classCode || move.from.classCode;
  const toCell = (candidate.schedule.classes[toClass]?.grid[move.to.day]?.[String(move.to.period)] || null) as ScheduleCell | null;
  if (!fromCell) return { ok: false, message: "선택한 원본 칸에 수업이 없습니다.", beforeCells: [], afterCells: [] };
  if (fromCell.fixed || toCell?.fixed) return { ok: false, message: "고정 일과는 수동 이동 대상이 아닙니다.", beforeCells: [fromCell], afterCells: [] };
  if (fromCell.syncOccurrenceId) {
    const occurrenceCells = Object.values(candidate.schedule.classes).flatMap((table) => candidate.schedule.days.flatMap((day) => Object.values(table.grid[day] || {})))
      .filter((cell): cell is ScheduleCell => Boolean(cell?.syncOccurrenceId === fromCell.syncOccurrenceId));
    const targetCells = occurrenceCells
      .map((cell) => candidate.schedule.classes[cell.classCode]?.grid[move.to.day]?.[String(move.to.period)] || null)
      .filter((cell): cell is ScheduleCell => Boolean(cell && cell.syncOccurrenceId !== fromCell.syncOccurrenceId));
    if (targetCells.some((cell) => cell.fixed)) return { ok: false, message: "동시그룹은 고정 일과가 있는 시간으로 이동할 수 없습니다.", beforeCells: occurrenceCells, afterCells: [] };
    if (targetCells.length) return { ok: false, message: "동시그룹 묶음 이동은 모든 대상 학급의 같은 시간이 비어 있을 때만 가능합니다.", beforeCells: occurrenceCells.concat(targetCells), afterCells: [] };
    return {
      ok: true,
      message: "동시그룹 묶음 이동 미리보기",
      beforeCells: occurrenceCells,
      afterCells: occurrenceCells.map((cell) => ({ ...cell, day: move.to.day, period: move.to.period })),
    };
  }
  const afterFrom: ScheduleCell | null = toCell ? { ...toCell, classCode: fromCell.classCode, className: fromCell.className, day: fromCell.day, period: fromCell.period } as ScheduleCell : null;
  const afterTo: ScheduleCell = { ...fromCell, classCode: toClass, className: candidate.schedule.classes[toClass].className, day: move.to.day, period: move.to.period };
  // @ts-ignore legacy unreachable body kept only for encoding-safe compatibility.
  return { ok: true, message: toCell ? "맞교환 미리보기" : "이동 미리보기", beforeCells: [fromCell, ...(toCell ? [toCell] : [])], afterCells: [afterTo, ...(afterFrom ? [afterFrom] : [])] };
}

export function applyMove(records: NormalizedRecords, candidate: Candidate, move: ManualMove, options: SolveOptions = {}): Candidate {
  return simulateMoveTransaction(records, candidate, move, options).candidate || candidate;
  const preview = movePreview(candidate, move);
  if (!preview.ok) return candidate;
  const schedule = cloneSchedule(candidate.schedule);
  const fromCell = schedule.classes[move.from.classCode].grid[move.from.day][String(move.from.period)]!;
  if (fromCell?.syncOccurrenceId) {
    const occurrenceId = fromCell.syncOccurrenceId;
    const occurrenceCells = Object.values(schedule.classes).flatMap((table) => schedule.days.flatMap((day) => Object.values(table.grid[day] || {})))
      .filter((cell): cell is ScheduleCell => Boolean(cell?.syncOccurrenceId === occurrenceId));
    for (const cell of occurrenceCells) schedule.classes[cell.classCode].grid[cell.day][String(cell.period)] = null;
    for (const cell of occurrenceCells) {
      schedule.classes[cell.classCode].grid[move.to.day][String(move.to.period)] = { ...cell, day: move.to.day, period: move.to.period };
    }
    const validation = validateSchedule(records, schedule, requiredOptions(options));
    const teacherIssues = summarizeTeacherIssues(records, schedule, validation);
    const updated: Candidate = { ...candidate, schedule, validation, teacherIssues, summary: summarize(candidate.unassigned, validation), signature: signature(schedule) };
    updated.summary.signature = updated.signature;
    return updated;
  }
  const toClass = move.to.classCode || move.from.classCode;
  const toCell = schedule.classes[toClass].grid[move.to.day][String(move.to.period)];
  schedule.classes[toClass].grid[move.to.day][String(move.to.period)] = fromCell ? { ...fromCell, classCode: toClass, className: schedule.classes[toClass].className, day: move.to.day, period: move.to.period } as ScheduleCell : null;
  schedule.classes[move.from.classCode].grid[move.from.day][String(move.from.period)] = toCell ? { ...toCell, classCode: move.from.classCode, className: schedule.classes[move.from.classCode].className, day: move.from.day, period: move.from.period } as ScheduleCell : null;
  const validation = validateSchedule(records, schedule, requiredOptions(options));
  const teacherIssues = summarizeTeacherIssues(records, schedule, validation);
  const updated: Candidate = {
    ...candidate,
    schedule,
    validation,
    teacherIssues,
    summary: summarize(candidate.unassigned, validation),
    signature: signature(schedule),
  };
  updated.summary.signature = updated.signature;
  return updated;
}

function sameSlot(a: { classCode: string; day: DayKey; period: number }, b: { classCode: string; day: DayKey; period: number }) {
  return a.classCode === b.classCode && a.day === b.day && a.period === b.period;
}

function slotKey(slot: { classCode: string; day: DayKey; period: number }) {
  return `${slot.classCode}:${slot.day}:${slot.period}`;
}

function buildDisplacementChain(records: NormalizedRecords, candidate: Candidate, source: ScheduleCell, target: { day: DayKey; period: number }, depthLeft: number, visited: Set<string>): ManualMoveStep[] | null {
  const targetSlot = { classCode: source.classCode, day: target.day, period: target.period };
  if (visited.has(slotKey(targetSlot))) return null;
  if (isBeyondClassDayLimit(records, source.classCode, target.day, target.period)) return null;
  const step: ManualMoveStep = { from: { classCode: source.classCode, day: source.day, period: source.period }, to: { classCode: source.classCode, day: target.day, period: target.period } };
  const targetCell = candidate.schedule.classes[source.classCode]?.grid[target.day]?.[String(target.period)] || null;
  if (!targetCell) return [step];
  if (targetCell.fixed || targetCell.syncOccurrenceId || (targetCell.blockId && (targetCell.blockSize || 1) > 1)) return null;
  if (depthLeft <= 1) return null;

  const nextVisited = new Set(visited);
  nextVisited.add(slotKey(targetSlot));
  const slots = candidate.schedule.days.flatMap((day) => candidate.schedule.periods.map((period) => ({ day, period })))
    .filter((slot) => !isBeyondClassDayLimit(records, source.classCode, slot.day, slot.period))
    .filter((slot) => !sameSlot({ classCode: source.classCode, day: slot.day, period: slot.period }, { classCode: source.classCode, day: source.day, period: source.period }))
    .filter((slot) => !nextVisited.has(slotKey({ classCode: source.classCode, day: slot.day, period: slot.period })))
    .sort((a, b) => {
      const aCell = candidate.schedule.classes[source.classCode]?.grid[a.day]?.[String(a.period)] || null;
      const bCell = candidate.schedule.classes[source.classCode]?.grid[b.day]?.[String(b.period)] || null;
      if (Boolean(aCell) !== Boolean(bCell)) return aCell ? 1 : -1;
      return a.period - b.period;
    })
    .slice(0, 18);
  for (const slot of slots) {
    const rest = buildDisplacementChain(records, candidate, targetCell, slot, depthLeft - 1, nextVisited);
    if (rest) return [step, ...rest];
  }
  return null;
}

function chainMoveOptions(records: NormalizedRecords, candidate: Candidate, from: ManualMove["from"], options: Required<SolveOptions>, currentPenalty: number) {
  const source = candidate.schedule.classes[from.classCode]?.grid[from.day]?.[String(from.period)] || null;
  if (!source || source.fixed || source.syncOccurrenceId || (source.blockId && (source.blockSize || 1) > 1)) return [] as ManualMoveCandidate[];
  const result: ManualMoveCandidate[] = [];
  const initialVisited = new Set([slotKey(from)]);
  for (const day of candidate.schedule.days) {
    for (const period of candidate.schedule.periods) {
      if (day === from.day && period === from.period) continue;
      const targetCell = candidate.schedule.classes[from.classCode]?.grid[day]?.[String(period)] || null;
      if (!targetCell || targetCell.fixed || targetCell.syncOccurrenceId || (targetCell.blockId && (targetCell.blockSize || 1) > 1)) continue;
      const steps = buildDisplacementChain(records, candidate, source, { day, period }, Math.max(2, options.manualChainDepth || 4), initialVisited);
      if (!steps || steps.length <= 1) continue;
      const move: ManualMove = { from, to: { classCode: from.classCode, day, period }, steps, chainLabel: `연쇄 ${steps.length}단계` };
      const transaction = simulateMoveTransaction(records, candidate, move, options);
      const preview = transaction.preview;
      if (!transaction.ok || !transaction.candidate) {
        result.push({ move, steps, depth: steps.length, affectedTeachers: preview.affectedTeachers?.map((item) => item.teacherName || item.teacherCode || "").filter(Boolean), chainLabel: move.chainLabel, applies: false, failureReason: transaction.failureReason || preview.message, quality: "blocked", score: 900000, reasons: [transaction.failureReason || preview.message], preview });
        continue;
      }
      const next = transaction.candidate;
      const reasons: string[] = [`연쇄 ${steps.length}단계로 ${preview.affectedTeachers?.length || 0}명의 시간표가 함께 바뀝니다.`];
      if (next.summary.hardErrors > candidate.summary.hardErrors) {
        result.push({ move, steps, depth: steps.length, affectedTeachers: preview.affectedTeachers?.map((item) => item.teacherName || item.teacherCode || "").filter(Boolean), chainLabel: move.chainLabel, quality: "blocked", score: 900000, reasons: ["연쇄 이동 중 교사/학급/특별실/요일별시수 충돌이 생깁니다."], preview });
        continue;
      }
      const nextPenalty = summaryQualityPenalty(next, options);
      const delta = moveDelta(candidate, next, options);
      if (delta.lunchIssues > 0) reasons.push("식사시간 부족이 늘어납니다.");
      if (delta.consecutiveIssues > 0) reasons.push("3연강 이상이 늘어납니다.");
      if (delta.balanceIssues > 0) reasons.push("요일 안배가 나빠집니다.");
      if (delta.lunchIssues < 0) reasons.push("식사시간 부족이 줄어듭니다.");
      if (delta.consecutiveIssues < 0) reasons.push("3연강이 줄어듭니다.");
      if (delta.balanceIssues < 0) reasons.push("요일 안배가 좋아집니다.");
      const worsensSoft = delta.lunchIssues > 0 || delta.consecutiveIssues > 0 || delta.balanceIssues > 0;
      const improvesSoft = delta.lunchIssues < 0 || delta.consecutiveIssues < 0 || delta.balanceIssues < 0 || nextPenalty < currentPenalty;
      const quality = worsensSoft ? "warning" : improvesSoft ? "good" : "good";
      result.push({ move, steps, depth: steps.length, affectedTeachers: preview.affectedTeachers?.map((item) => item.teacherName || item.teacherCode || "").filter(Boolean), chainLabel: move.chainLabel, applies: true, quality, score: nextPenalty + steps.length * 5, reasons, preview, delta });
      if (result.length >= 30) return result;
    }
  }
  return result;
}

export function moveOptions(records: NormalizedRecords, candidate: Candidate, from: ManualMove["from"], options: SolveOptions = {}): ManualMoveCandidate[] {
  const required = requiredOptions(options);
  const fromCell = candidate.schedule.classes[from.classCode]?.grid[from.day]?.[String(from.period)];
  if (!fromCell || fromCell.fixed) return [];
  const currentPenalty = summaryQualityPenalty(candidate, required);
  const result: ManualMoveCandidate[] = [];
  for (const day of candidate.schedule.days) {
    for (const period of candidate.schedule.periods) {
      if (day === from.day && period === from.period) continue;
      const move: ManualMove = { from, to: { classCode: from.classCode, day, period } };
      const transaction = simulateMoveTransaction(records, candidate, move, required);
      const preview = transaction.preview;
      const reasons: string[] = [];
      if (!transaction.ok || !transaction.candidate) {
        const failureReason = transaction.failureReason || preview.failureReason || preview.message;
        result.push({ move, applies: false, failureReason, quality: "blocked", score: 999999, reasons: [failureReason], preview });
        continue;
      }
      const next = transaction.candidate;
      if (next.summary.hardErrors > candidate.summary.hardErrors) {
        result.push({ move, quality: "blocked", score: 900000, reasons: ["교사/학급/특별실 중복이 생깁니다."], preview });
        continue;
      }
      const targetGrid = candidate.schedule.classes[from.classCode]?.grid[day] || {};
      const sameSubject = Object.values(targetGrid).some((cell) => Boolean(cell && subjectSimilarKey(records, cell.subjectCode) === subjectSimilarKey(records, fromCell.subjectCode) && subjectSameDayScope(cell.syncGroup) === subjectSameDayScope(fromCell.syncGroup) && !(cell.day === from.day && cell.period === from.period) && !sameContinuousSubjectBlock(cell.blockId, fromCell.blockId)));
      const nextPenalty = summaryQualityPenalty(next, required);
      const delta = moveDelta(candidate, next, required);
      if (sameSubject) reasons.push(fromCell.syncGroup ? "같은 동시그룹의 같은 과목이 같은 날에 있습니다." : "단일교과가 같은 날에 있습니다.");
      if (delta.lunchIssues > 0) reasons.push("식사시간 부족이 늘어납니다.");
      if (delta.consecutiveIssues > 0) reasons.push("3연강 이상이 늘어납니다.");
      if (delta.balanceIssues > 0) reasons.push("요일 안배가 나빠집니다.");
      if (delta.lunchIssues < 0) reasons.push("식사시간 부족이 줄어듭니다.");
      if (delta.consecutiveIssues < 0) reasons.push("3연강이 줄어듭니다.");
      if (delta.balanceIssues < 0) reasons.push("요일 안배가 좋아집니다.");
      const worsensSoft = delta.lunchIssues > 0 || delta.consecutiveIssues > 0 || delta.balanceIssues > 0;
      const improvesSoft = delta.lunchIssues < 0 || delta.consecutiveIssues < 0 || delta.balanceIssues < 0 || nextPenalty < currentPenalty;
      const quality = sameSubject ? "duplicate-subject" : worsensSoft ? "warning" : improvesSoft ? "good" : "good";
      result.push({ move, quality, score: nextPenalty, reasons: reasons.length ? reasons : ["현재 조건에서 이동 가능합니다."], preview, delta, affectedTeachers: preview.affectedTeachers?.map((item) => item.teacherName || item.teacherCode || "").filter(Boolean) });
    }
  }
  result.push(...chainMoveOptions(records, candidate, from, required, currentPenalty));
  return result.sort((a, b) => {
    const order = { good: 0, warning: 1, "duplicate-subject": 2, blocked: 3 };
    if (order[a.quality] !== order[b.quality]) return order[a.quality] - order[b.quality];
    return a.score - b.score;
  }).map((option) => ({
    ...option,
    applies: option.applies ?? option.quality !== "blocked",
    failureReason: option.failureReason || (option.quality === "blocked" ? option.reasons[0] : undefined),
  }));
}

function moveKey(move: ManualMove) {
  return chainSteps(move)
    .map((step) => `${step.from.classCode}:${step.from.day}:${step.from.period}->${step.to.classCode || step.from.classCode}:${step.to.day}:${step.to.period}`)
    .join("|");
}

function moveSubject(schedule: Schedule, cell: ScheduleCell): MoveSubject {
  const cells = blockCells(schedule, cell);
  const kind: MoveSubject["kind"] = cell.syncOccurrenceId ? "sync" : (cell.blockId && (cell.blockSize || 1) > 1) ? "continuous" : "single";
  const id = cell.syncOccurrenceId || cell.blockId || cell.id;
  const label = kind === "sync"
    ? `${cell.syncGroup || "동시수업"} 묶음`
    : kind === "continuous"
      ? `${cell.subjectName || cell.label || "연속수업"} ${cell.blockSize || cells.length}연속`
      : `${cell.subjectName || cell.label || "수업"} ${cell.className}`;
  return { kind, id, label, cells };
}

function moveDelta(before: Candidate, after: Candidate, options: Required<SolveOptions>): MoveDelta {
  return {
    unassigned: after.summary.unassigned - before.summary.unassigned,
    hardErrors: after.summary.hardErrors - before.summary.hardErrors,
    lunchIssues: after.summary.lunchIssues - before.summary.lunchIssues,
    consecutiveIssues: after.summary.consecutiveIssues - before.summary.consecutiveIssues,
    balanceIssues: after.summary.balanceIssues - before.summary.balanceIssues,
    softPenalty: summaryQualityPenalty(after, options) - summaryQualityPenalty(before, options),
  };
}

function deltaReasons(delta: MoveDelta, fallback: string[]) {
  const reasons: string[] = [];
  if (delta.lunchIssues < 0) reasons.push(`식사부족 ${Math.abs(delta.lunchIssues)}건 감소`);
  if (delta.consecutiveIssues < 0) reasons.push(`3연강 ${Math.abs(delta.consecutiveIssues)}건 감소`);
  if (delta.balanceIssues < 0) reasons.push(`안배부족 ${Math.abs(delta.balanceIssues)}건 감소`);
  if (delta.hardErrors > 0) reasons.push(`hard 오류 ${delta.hardErrors}건 증가`);
  if (delta.unassigned > 0) reasons.push(`미배정 ${delta.unassigned}건 증가`);
  if (delta.softPenalty > 0 && !reasons.length) reasons.push("soft 품질이 나빠질 수 있습니다.");
  return reasons.length ? reasons : fallback;
}

function proposalTitle(option: ManualMoveCandidate, subject: MoveSubject) {
  if (option.depth && option.depth > 1) return `${subject.label} 연쇄 ${option.depth}단계 이동`;
  if (subject.kind === "sync") return `${subject.label} 전체 이동`;
  if (subject.kind === "continuous") return `${subject.label} 전체 이동`;
  return `${subject.label} 이동`;
}

function repairSourceCells(records: NormalizedRecords, candidate: Candidate, options: Required<SolveOptions>) {
  const issueCodes = candidate.teacherIssues
    .map((issue) => issue.teacherCode)
    .filter(Boolean);
  const scoredCodes = Object.keys(records.teachers)
    .map((teacherCode) => ({ teacherCode, score: teacherPostIssueScore(records, options, candidate, teacherCode) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.teacherCode);
  const teacherCodes = [...new Set([...issueCodes, ...scoredCodes])].slice(0, 12);
  const seen = new Set<string>();
  const cells: ScheduleCell[] = [];
  for (const teacherCode of teacherCodes) {
    const teacherCells = cellsByTeacher(candidate.schedule, teacherCode)
      .filter((cell) => !cell.fixed)
      .sort((a, b) => {
        const aScore = teacherPostIssueScore(records, options, candidate, a.teacherCode || "");
        const bScore = teacherPostIssueScore(records, options, candidate, b.teacherCode || "");
        return bScore - aScore || a.day.localeCompare(b.day, "ko") || a.period - b.period;
      });
    for (const cell of teacherCells) {
      const subject = moveSubject(candidate.schedule, cell);
      const key = `${subject.kind}:${subject.id}:${cell.classCode}:${cell.day}:${cell.period}`;
      if (seen.has(key)) continue;
      seen.add(key);
      cells.push(cell);
      if (cells.length >= 36) return cells;
    }
  }
  return cells;
}

export function repairOptions(records: NormalizedRecords, candidate: Candidate, options: SolveOptions = {}): MoveProposal[] {
  const required = requiredOptions(options);
  const currentPenalty = summaryQualityPenalty(candidate, required);
  const proposals: MoveProposal[] = [];
  const seenMoves = new Set<string>();
  for (const cell of repairSourceCells(records, candidate, required)) {
    const from = { classCode: cell.classCode, day: cell.day, period: cell.period };
    const subject = moveSubject(candidate.schedule, cell);
    for (const option of moveOptions(records, candidate, from, required)) {
      if (!option.preview.ok || option.applies === false || option.quality === "blocked") continue;
      const key = moveKey(option.move);
      if (seenMoves.has(key)) continue;
      seenMoves.add(key);
      const next = applyMove(records, candidate, option.move, required);
      if (next.signature === candidate.signature) continue;
      if (next.summary.unassigned > candidate.summary.unassigned) continue;
      if (next.summary.hardErrors > candidate.summary.hardErrors) continue;
      const delta = moveDelta(candidate, next, required);
      if (delta.softPenalty > 0 && delta.lunchIssues >= 0 && delta.consecutiveIssues >= 0 && delta.balanceIssues >= 0) continue;
      proposals.push({
        proposalId: "",
        title: proposalTitle(option, subject),
        move: option.move,
        subject,
        delta,
        score: currentPenalty + delta.softPenalty + (option.depth || 1) * 3,
        reasons: deltaReasons(delta, option.reasons),
        preview: option.preview,
        affectedTeachers: option.affectedTeachers || option.preview.affectedTeachers?.map((item) => item.teacherName || item.teacherCode || "").filter(Boolean),
        source: "local",
      });
      if (proposals.length >= 80) break;
    }
    if (proposals.length >= 80) break;
  }
  return proposals
    .sort((a, b) => {
      if (a.delta.unassigned !== b.delta.unassigned) return a.delta.unassigned - b.delta.unassigned;
      if (a.delta.hardErrors !== b.delta.hardErrors) return a.delta.hardErrors - b.delta.hardErrors;
      if (a.delta.softPenalty !== b.delta.softPenalty) return a.delta.softPenalty - b.delta.softPenalty;
      return a.score - b.score;
    })
    .slice(0, 30)
    .map((proposal, index) => ({ ...proposal, proposalId: `repair-${index + 1}` }));
}

export function repairPreview(_candidate: Candidate, proposal: MoveProposal): MovePreview {
  return proposal.preview;
}

export function repairApply(records: NormalizedRecords, candidate: Candidate, proposal: MoveProposal, options: SolveOptions = {}) {
  const required = requiredOptions(options);
  const next = applyMove(records, candidate, proposal.move, required);
  if (next.summary.unassigned > candidate.summary.unassigned) return candidate;
  if (next.summary.hardErrors > candidate.summary.hardErrors) return candidate;
  return next;
}
