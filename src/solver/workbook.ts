import { Workbook } from "exceljs";
import type { ClassInfo, ConstraintRule, DayKey, FixedCell, ImportIssue, LoadUnit, NormalizedRecords, Room, Subject, Teacher } from "@/solver/types";

const DAY_ALIASES: Record<string, DayKey> = {
  월: "월",
  화: "화",
  수: "수",
  목: "목",
  금: "금",
  토: "토",
  일: "일",
};

const DEFAULT_DAYS: DayKey[] = ["월", "화", "수", "목", "금"];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function splitList(value: unknown) {
  return text(value).split(/[,\s/]+/).map((item) => item.trim()).filter(Boolean);
}

function parseDays(value: unknown): DayKey[] {
  const raw = text(value);
  if (!raw) return DEFAULT_DAYS;
  const days = raw.split(/[,\s/]+/).map((item) => DAY_ALIASES[item[0]]).filter(Boolean) as DayKey[];
  return days.length ? days : DEFAULT_DAYS;
}

function cellValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if (Array.isArray(obj.richText)) return obj.richText.map((part) => text((part as Record<string, unknown>).text)).join("");
  if ("text" in obj) return obj.text;
  if ("result" in obj) return obj.result;
  return value;
}

function sheetByName(workbook: Workbook, wanted: string) {
  const exact = workbook.worksheets.find((sheet) => sheet.name === wanted);
  if (exact) return exact;
  return workbook.worksheets.find((sheet) => sheet.name.includes(wanted) || wanted.includes(sheet.name));
}

function rows(workbook: Workbook, sheetName: string): unknown[][] {
  const sheet = sheetByName(workbook, sheetName);
  if (!sheet) return [];
  const data: unknown[][] = [];
  const columnCount = Math.max(sheet.columnCount, 1);
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: unknown[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      values.push(cellValue(row.getCell(column).value));
    }
    data[rowNumber - 1] = values;
  });
  return data.map((row) => row || []);
}

function headerIndex(headers: string[], names: string[], fallback = -1) {
  for (const name of names) {
    const idx = headers.findIndex((header) => header === name || header.includes(name));
    if (idx >= 0) return idx;
  }
  return fallback;
}

function rowObjects(workbook: Workbook, sheetName: string) {
  const data = rows(workbook, sheetName);
  if (!data.length) return [] as Array<{ rowNumber: number; headers: string[]; row: unknown[]; get: (names: string[]) => string }>;
  const headers = data[0].map(text);
  return data.slice(1).map((row, offset) => ({
    rowNumber: offset + 2,
    headers,
    row,
    get(names: string[]) {
      const idx = headerIndex(headers, names);
      return idx >= 0 ? text(row[idx]) : "";
    },
  })).filter((item) => item.row.some((value) => text(value)));
}

function code(prefix: string, index: number) {
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

function addIssue(issues: ImportIssue[], severity: "error" | "warning", sheet: string, row: number, column: string, message: string, fix: string) {
  issues.push({ severity, sheet, row, column, message, fix });
}

function parsePeriods(value: unknown) {
  const source = text(value);
  const result: number[] = [];
  for (const part of source.split(/[,\s]+/).filter(Boolean)) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((x) => numberValue(x));
      for (let p = start; p <= end; p += 1) result.push(p);
    } else {
      const n = numberValue(part);
      if (n) result.push(n);
    }
  }
  return result;
}

function parseContinuousBlocks(value: unknown, hours: number) {
  const source = text(value);
  if (!source) return Array.from({ length: hours }, () => 1);
  const blocks = source.match(/\d+/g)?.map((item) => Number(item)).filter((item) => Number.isFinite(item) && item > 0) || [];
  return blocks.length ? blocks : Array.from({ length: hours }, () => 1);
}

function parseDayLimits(value: unknown, days: DayKey[], maxPeriod: number) {
  const parts = splitList(value);
  const limits: Record<string, number> = {};
  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    for (const day of days) limits[day] = Number(parts[0]);
    return limits;
  }
  days.forEach((day, index) => {
    limits[day] = numberValue(parts[index], maxPeriod) || maxPeriod;
  });
  return limits;
}

export async function parseWorkbookFile(file: File): Promise<NormalizedRecords> {
  return parseWorkbookBuffer(await file.arrayBuffer());
}

export async function parseWorkbookBuffer(buffer: ArrayBuffer): Promise<NormalizedRecords> {
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer as never);
  return normalizeWorkbook(workbook);
}

export function normalizeWorkbook(workbook: Workbook): NormalizedRecords {
  const issues: ImportIssue[] = [];
  const configRows = rowObjects(workbook, "기본설정");
  const configMap = new Map<string, string>();
  for (const item of configRows) {
    const key = text(item.row[0]);
    const value = text(item.row[1]);
    if (key) configMap.set(key, value);
  }

  const days = parseDays(configMap.get("수업요일"));
  const maxPeriod = numberValue(configMap.get("일일최대교시"), 7) || 7;
  const lunchPeriod = numberValue(configMap.get("점심시간후교시") || configMap.get("점심시간전교시"), 4) || 4;
  const defaultDayLimits = Object.fromEntries(days.map((day) => [day, maxPeriod])) as Record<string, number>;

  const teachers: Record<string, Teacher> = {};
  const teacherByName = new Map<string, string>();
  rowObjects(workbook, "교사").forEach((item, index) => {
    const name = item.get(["교사명"]);
    if (!name) return;
    const teacherCode = code("T", index);
    teachers[teacherCode] = {
      code: teacherCode,
      name,
      lunchPeriod: numberValue(item.get(["점심시간후교시", "점심시간전교시"]), lunchPeriod) || lunchPeriod,
      unavailable: item.get(["배정금지"]),
    };
    teacherByName.set(name, teacherCode);
  });

  const classes: Record<string, ClassInfo> = {};
  const classByName = new Map<string, string>();
  rowObjects(workbook, "학급-계열").forEach((item, index) => {
    const name = item.get(["학급명"]);
    if (!name) return;
    const classCode = code("C", index);
    const limits = parseDayLimits(item.get(["요일별시수"]), days, maxPeriod);
    classes[classCode] = {
      code: classCode,
      name,
      grade: item.get(["학년"]) || name[0] || "",
      track: item.get(["계열"]),
      homeroomTeacherName: item.get(["담임교사명"]),
      dayLimits: Object.keys(limits).length ? limits : defaultDayLimits,
      virtual: item.get(["가상학급여부"]).toUpperCase() === "Y",
    };
    classByName.set(name, classCode);
  });

  const subjects: Record<string, Subject> = {};
  const subjectByName = new Map<string, string>();
  rowObjects(workbook, "과목").forEach((item, index) => {
    const name = item.get(["과목명"]);
    if (!name) return;
    const subjectCode = code("S", index);
    subjects[subjectCode] = {
      code: subjectCode,
      name,
      shortName: item.get(["단축명"]) || name,
      neisName: item.get(["NEIS과목명"]),
      similarGroup: item.get(["유사과목그룹"]),
    };
    subjectByName.set(name, subjectCode);
  });

  const rooms: Record<string, Room> = {};
  const roomByName = new Map<string, string>();
  rowObjects(workbook, "특별실").forEach((item, index) => {
    const name = item.get(["특별실명"]);
    if (!name) return;
    const roomCode = code("R", index);
    rooms[roomCode] = { code: roomCode, name, unavailable: item.get(["배정금지"]) };
    roomByName.set(name, roomCode);
  });

  const fixed: FixedCell[] = [];
  rowObjects(workbook, "고정 일과").forEach((item, rowIndex) => {
    const targetType = item.get(["대상유형"]);
    const targetName = item.get(["대상명"]);
    const period = numberValue(item.get(["교시"]));
    if (!period) return;
    const targetClasses = Object.values(classes).filter((cls) => {
      if (targetType === "전체") return true;
      if (targetType === "학년") return cls.grade === targetName;
      if (targetType === "계열") return cls.track === targetName;
      if (targetType === "학급") return cls.name === targetName;
      return false;
    });
    for (const day of days) {
      const label = item.get([day]);
      if (!label) continue;
      for (const cls of targetClasses) {
        fixed.push({
          id: `F${rowIndex}_${cls.code}_${day}_${period}`,
          classCode: cls.code,
          day,
          period,
          label,
          teacherName: item.get(["임장교사명"]),
          source: "fixed",
        });
      }
    }
  });

  const loadRows = rows(workbook, "교사별 시수표");
  const loadHeaders = (loadRows[0] || []).map(text);
  const teacherCol = headerIndex(loadHeaders, ["교사명"], 0);
  const subjectCol = headerIndex(loadHeaders, ["과목명"], 1);
  const consecutiveCol = headerIndex(loadHeaders, ["연속패턴"]);
  const roomCol = headerIndex(loadHeaders, ["특별실명"]);
  const syncCol = headerIndex(loadHeaders, ["동시그룹"]);
  const coTeacherCol = headerIndex(loadHeaders, ["복수교사그룹"]);
  const fixedHeaderCount = Math.max(6, coTeacherCol + 1);
  const loads: LoadUnit[] = [];

  loadRows.slice(1).forEach((row, rowOffset) => {
    const teacherName = text(row[teacherCol]);
    const subjectName = text(row[subjectCol]);
    if (!teacherName && !subjectName) return;
    const teacherCode = teacherByName.get(teacherName);
    const subjectCode = subjectByName.get(subjectName);
    if (!teacherCode) addIssue(issues, "error", "교사별 시수표", rowOffset + 2, "A", `${teacherName || "빈 교사명"} 교사를 찾을 수 없습니다.`, "교사 시트에 교사명을 먼저 입력하세요.");
    if (!subjectCode) addIssue(issues, "error", "교사별 시수표", rowOffset + 2, "B", `${subjectName || "빈 과목명"} 과목을 찾을 수 없습니다.`, "과목 시트에 과목명을 먼저 입력하세요.");
    const roomName = roomCol >= 0 ? text(row[roomCol]) : "";
    const roomCode = roomName ? roomByName.get(roomName) : "";
    if (roomName && !roomCode) addIssue(issues, "error", "교사별 시수표", rowOffset + 2, "D", `${roomName} 특별실을 찾을 수 없습니다.`, "특별실 시트에 특별실명을 먼저 입력하세요.");
    for (let column = fixedHeaderCount; column < loadHeaders.length; column += 1) {
      const className = loadHeaders[column];
      if (!className) continue;
      const hours = numberValue(row[column]);
      if (!hours) continue;
      const classCode = classByName.get(className);
      if (!classCode) {
        addIssue(issues, "error", "교사별 시수표", rowOffset + 2, String(column + 1), `${className} 학급을 찾을 수 없습니다.`, "학급-계열 시트에 학급명을 먼저 입력하세요.");
        continue;
      }
      if (!teacherCode || !subjectCode) continue;
      const syncGroup = syncCol >= 0 ? text(row[syncCol]) : "";
      const consecutivePattern = consecutiveCol >= 0 ? text(row[consecutiveCol]) : "";
      const continuousBlocks = parseContinuousBlocks(consecutivePattern, hours);
      const blockSum = continuousBlocks.reduce((sum, item) => sum + item, 0);
      if (consecutivePattern && blockSum !== hours) {
        addIssue(issues, "error", "교사별 시수표", rowOffset + 2, String(consecutiveCol + 1), `연속패턴 ${consecutivePattern}의 합계(${blockSum})가 ${className} 시수(${hours})와 다릅니다.`, "예: 3시수 중 2연속+1단독이면 2,1로 입력하세요.");
        continue;
      }
      const pressure = (roomCode ? 4 : 0) + (syncGroup ? 5 : 0) + Math.max(0, 8 - hours);
      loads.push({
        id: `L${loads.length + 1}`,
        teacherCode,
        teacherName,
        subjectCode,
        subjectName,
        classCode,
        className,
        hours,
        roomCode: roomCode || undefined,
        roomName: roomName || undefined,
        syncGroup: syncGroup || undefined,
        consecutivePattern: consecutivePattern || undefined,
        continuousBlocks,
        coTeacherGroup: coTeacherCol >= 0 ? text(row[coTeacherCol]) || undefined : undefined,
        pressure,
      });
    }
  });

  const syncGroups = new Map<string, Map<string, number>>();
  for (const load of loads.filter((item) => item.syncGroup)) {
    const group = syncGroups.get(load.syncGroup!) || new Map<string, number>();
    group.set(load.classCode, (group.get(load.classCode) || 0) + load.hours);
    syncGroups.set(load.syncGroup!, group);
  }
  for (const [groupName, classHours] of syncGroups) {
    const values = [...classHours.values()];
    if (new Set(values).size > 1) {
      const detail = [...classHours.entries()].map(([classCode, hours]) => `${classes[classCode]?.name || classCode}=${hours}`).join(", ");
      addIssue(issues, "error", "교사별 시수표", 2, "E", `동시그룹 ${groupName}의 학급별 시수가 서로 다릅니다.`, `같은 동시그룹 안에서는 각 학급별 참여 시수를 동일하게 맞추세요. 현재 ${detail}`);
    }
  }

  const constraints: ConstraintRule[] = rowObjects(workbook, "배정금지-희망조건").map((item) => {
    const strengthText = item.get(["강도"]).toLowerCase();
    const strength: ConstraintRule["strength"] = strengthText === "hard" ? "hard" : strengthText === "wish" ? "wish" : "soft";
    return {
      targetType: item.get(["대상유형"]),
      targetName: item.get(["대상명"]),
      conditionType: item.get(["조건유형"]),
      day: item.get(["요일"]),
      periods: parsePeriods(item.get(["교시"])),
      strength,
      priority: numberValue(item.get(["우선순위"]), 5),
      description: item.get(["설명"]),
    };
  }).filter((item) => item.targetType && item.targetName && item.conditionType);

  if (!Object.keys(classes).length) addIssue(issues, "warning", "학급-계열", 2, "A", "학급 자료가 비어 있습니다.", "학급-계열 시트에 학급을 입력하세요.");
  if (!loads.length) addIssue(issues, "warning", "교사별 시수표", 2, "A", "시수 자료가 비어 있습니다.", "교사별 시수표에 주당 시수를 입력하세요.");

  return {
    config: {
      days,
      maxPeriod,
      lunchPeriod,
      lunchProtection: (configMap.get("점심시간보호") || "Y").toUpperCase() !== "N",
      maxConsecutive: numberValue(configMap.get("최대연강허용"), 3) || 3,
      balanceStrength: ((configMap.get("균등분배강도") || "soft") as "off" | "soft" | "hard"),
      title: configMap.get("시간표제목") || "AI 공동작성 시간표",
    },
    teachers,
    classes,
    subjects,
    rooms,
    loads,
    fixed,
    constraints,
    issues,
    stats: {
      teacherCount: Object.keys(teachers).length,
      classCount: Object.keys(classes).length,
      subjectCount: Object.keys(subjects).length,
      roomCount: Object.keys(rooms).length,
      loadCount: loads.length,
      fixedCount: fixed.length,
      issueCount: issues.length,
    },
  };
}
