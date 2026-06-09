import { Workbook, type Worksheet } from "exceljs";
import { requireAdmin } from "@/lib/auth";

export const runtime = "nodejs";

type SheetSpec = {
  name: string;
  headers: string[];
  examples: Array<{ caseName: string; values: string[]; tip: string }>;
};

const CLASS_COLUMNS = [
  "1-1", "1-2", "1-3", "1-4", "1-5", "1-6", "1-7", "1-8", "1-9", "1-10",
  "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-7", "2-8", "2-9", "2-10",
  "3-1", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-8", "3-9", "3-10",
];

const SHEETS: SheetSpec[] = [
  {
    name: "기본설정",
    headers: ["항목", "값", "설명"],
    examples: [
      { caseName: "요일", values: ["수업요일", "월,화,수,목,금", "시간표에 사용할 요일 순서"], tip: "쉼표 또는 공백으로 구분합니다." },
      { caseName: "교시", values: ["일일최대교시", "7", "하루 최대 교시"], tip: "학급별 요일별시수는 이 값 이하로 입력합니다." },
      { caseName: "점심", values: ["점심시간전교시", "4", "점심 직전 교시"], tip: "4라면 4교시와 5교시를 모두 가진 교사를 식사 부족으로 봅니다." },
      { caseName: "보호", values: ["점심시간보호", "Y", "Y/N"], tip: "기본값은 Y입니다." },
      { caseName: "연강", values: ["최대연강허용", "3", "교사별 최대 연속 수업"], tip: "조건 완화 허용 전에는 이 값을 지킵니다." },
      { caseName: "제목", values: ["시간표제목", "2026학년도 1학기", "출력 제목"], tip: "출력물 제목으로 사용합니다." },
    ],
  },
  {
    name: "교사",
    headers: ["교사명", "점심시간전교시", "배정금지", "비고"],
    examples: [
      { caseName: "기본", values: ["김하늘", "", "", "담임"], tip: "교사명은 다른 시트에서 그대로 참조합니다." },
      { caseName: "금지", values: ["박도윤", "", "월1, 금7", "시간강사"], tip: "정교한 금지는 배정금지-희망조건 시트를 사용합니다." },
    ],
  },
  {
    name: "학급-계열",
    headers: ["학급명", "학년", "계열", "담임교사명", "요일별시수", "가상학급여부"],
    examples: [
      { caseName: "일반", values: ["1-1", "1", "공통", "김하늘", "7,7,6,7,7", "N"], tip: "수요일만 6교시인 예시입니다." },
      { caseName: "가상", values: ["2-이동A", "2", "공통", "", "7,7,6,7,7", "Y"], tip: "분반/이동수업용 임시 학급입니다." },
    ],
  },
  {
    name: "고정 일과",
    headers: ["대상유형", "대상명", "교시", "월", "화", "수", "목", "금", "임장교사명"],
    examples: [
      { caseName: "HR", values: ["학년", "1", "5", "", "", "HR", "", "", ""], tip: "수업은 아니지만 시간표에 고정 표시할 때 사용합니다." },
      { caseName: "자습", values: ["전체", "", "7", "", "", "", "자습", "", ""], tip: "교사 시수와 무관한 고정 일과입니다." },
    ],
  },
  {
    name: "과목",
    headers: ["과목명", "단축명", "NEIS과목명", "유사과목그룹"],
    examples: [
      { caseName: "일반", values: ["국어", "국", "국어", "국어군"], tip: "단축명은 시간표 칸에 표시할 이름입니다." },
      { caseName: "유사", values: ["문학", "문", "문학", "국어군"], tip: "유사과목그룹은 같은 날 회피 판단에 사용합니다." },
    ],
  },
  {
    name: "교사별 시수표",
    headers: ["교사명", "과목명", "연속패턴", "특별실명", "동시그룹", "복수교사그룹", ...CLASS_COLUMNS],
    examples: [
      { caseName: "기본", values: ["김하늘", "국어", "", "", "", "", "4", "4", "4"], tip: "교사/과목을 한 번 쓰고 학급 열에 시수 숫자만 입력합니다." },
      { caseName: "동시", values: ["박물리", "물리", "", "과학실1", "A", "", "", "", "", "", "", "", "", "", "", "", "3"], tip: "동시그룹 값이 같은 수업은 같은 회차에 동시에 배정됩니다." },
      { caseName: "연속", values: ["최체육", "체육", "2연속", "체육관", "", "", "2"], tip: "연속수업이 필요한 경우 패턴을 적습니다." },
    ],
  },
  {
    name: "특별실",
    headers: ["특별실명", "사용과목", "배정금지"],
    examples: [
      { caseName: "과학실", values: ["과학실1", "물리,화학", "금7"], tip: "특별실 중복 사용을 막는 데 사용합니다." },
      { caseName: "체육관", values: ["체육관", "체육", ""], tip: "특별실이 필요 없는 수업은 비워 둡니다." },
    ],
  },
  {
    name: "동시-합반-분반",
    headers: ["유형", "그룹명", "대상학급", "과목명", "교사명", "설명"],
    examples: [
      { caseName: "동시", values: ["동시", "A", "2-1,2-2,2-3", "세계사/물리", "", "교사별 시수표의 동시그룹 A와 함께 사용합니다."], tip: "참고 설명용 시트입니다." },
      { caseName: "분반", values: ["분반", "B", "1-1", "영어", "김영어,박영어", "필요 시 가상학급을 먼저 만듭니다."], tip: "첫 버전에서는 교사별 시수표가 기준입니다." },
    ],
  },
  {
    name: "연속수업",
    headers: ["과목명", "교사명", "학급명", "연속시간", "설명"],
    examples: [
      { caseName: "블록", values: ["미술", "정미술", "1-5", "2", "2시간 연속 배정"], tip: "교사별 시수표의 연속패턴과 함께 사용합니다." },
    ],
  },
  {
    name: "복수교사",
    headers: ["그룹명", "과목명", "학급명", "교사명", "역할"],
    examples: [
      { caseName: "팀티칭", values: ["T1", "과학", "1-1", "김과학,박과학", "공동지도"], tip: "복수교사그룹과 맞춰 입력합니다." },
    ],
  },
  {
    name: "배정금지-희망조건",
    headers: ["대상유형", "대상명", "조건유형", "요일", "교시", "강도", "우선순위", "설명"],
    examples: [
      { caseName: "교사금지", values: ["교사", "김하늘", "배정금지", "월", "1", "hard", "1", "월요일 1교시 불가"], tip: "hard는 반드시 지켜야 하는 조건입니다." },
      { caseName: "희망", values: ["과목", "체육", "희망", "금", "6-7", "soft", "5", "가능하면 피함"], tip: "soft는 품질 점수로 반영합니다." },
    ],
  },
  {
    name: "NEIS 코드",
    headers: ["과목명", "NEIS과목명", "NEIS과목코드", "교사명", "NEIS교사명"],
    examples: [
      { caseName: "과목", values: ["국어", "국어", "KOR101", "김하늘", "김하늘"], tip: "NEIS 출력 전 명칭을 맞춥니다." },
    ],
  },
];

function addGuideSheet(workbook: Workbook) {
  const guide = workbook.addWorksheet("작성 안내");
  guide.addRows([
    ["항목", "설명"],
    ["입력 영역", "각 시트의 왼쪽 표가 실제 입력 영역입니다. 오른쪽 예시 영역은 검증에서 무시됩니다."],
    ["교사별 시수표", "교사명과 과목명은 한 행에 한 번만 쓰고, 오른쪽 학급 열에 주당 시수 숫자를 입력합니다."],
    ["요일별시수", "기본설정의 수업요일 순서대로 입력합니다. 월~금 기준 7,7,6,7,7은 수요일만 6교시입니다."],
    ["동시그룹", "교사별 시수표의 동시그룹 값이 같은 수업은 같은 요일/교시에 묶어서 배정됩니다."],
  ]);
  guide.columns = [{ width: 22 }, { width: 90 }];
  styleWorksheet(guide, 2);
}

function styleWorksheet(sheet: Worksheet, headerCount: number) {
  const headerFill = "173F3F";
  const optionalFill = "48656A";
  const inputFill = "FFF7D6";
  const exampleFill = "F6FAFE";
  const border = { style: "thin" as const, color: { argb: "FFC9D1D1" } };

  sheet.getRow(1).height = 24;
  for (let col = 1; col <= headerCount; col += 1) {
    const cell = sheet.getCell(1, col);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${col <= 2 ? headerFill : optionalFill}` } };
    cell.font = { color: { argb: "FFFFFFFF" }, bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = { left: border, right: border, top: border, bottom: border };
  }
  for (let row = 2; row <= 80; row += 1) {
    for (let col = 1; col <= headerCount; col += 1) {
      const cell = sheet.getCell(row, col);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${inputFill}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { left: border, right: border, top: border, bottom: border };
    }
  }
  const exampleStart = headerCount + 2;
  const maxColumn = Math.max(sheet.columnCount, exampleStart + headerCount + 2);
  for (let row = 1; row <= Math.max(sheet.rowCount, 8); row += 1) {
    for (let col = exampleStart; col <= maxColumn; col += 1) {
      const cell = sheet.getCell(row, col);
      if (cell.value == null) continue;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${exampleFill}` } };
      cell.alignment = { vertical: "middle", wrapText: true };
      cell.border = { left: border, right: border, top: border, bottom: border };
    }
  }
}

function addSpecSheet(workbook: Workbook, spec: SheetSpec) {
  const sheet = workbook.addWorksheet(spec.name);
  sheet.addRow(spec.headers);
  const inputRows = Math.max(80, spec.examples.length + 12);
  for (let row = 2; row <= inputRows; row += 1) sheet.addRow(new Array(spec.headers.length).fill(""));

  if (spec.name === "기본설정") {
    spec.examples.forEach((example, index) => {
      const row = 2 + index;
      const values = [...example.values, ...new Array(spec.headers.length).fill("")].slice(0, spec.headers.length);
      values.forEach((value, colIndex) => {
        sheet.getCell(row, colIndex + 1).value = value;
      });
    });
  }

  const exampleStart = spec.headers.length + 2;
  sheet.getCell(1, exampleStart).value = "작성 예시 영역";
  sheet.getCell(2, exampleStart).value = "상황";
  spec.headers.forEach((header, index) => {
    sheet.getCell(2, exampleStart + index + 1).value = header;
  });
  sheet.getCell(2, exampleStart + spec.headers.length + 1).value = "작성 팁";
  spec.examples.forEach((example, rowIndex) => {
    const row = 3 + rowIndex;
    sheet.getCell(row, exampleStart).value = example.caseName;
    const values = [...example.values, ...new Array(spec.headers.length).fill("")].slice(0, spec.headers.length);
    values.forEach((value, index) => {
      sheet.getCell(row, exampleStart + index + 1).value = value;
    });
    sheet.getCell(row, exampleStart + spec.headers.length + 1).value = example.tip;
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.columns = spec.headers.map((header) => ({ width: Math.max(12, Math.min(22, header.length * 2 + 8)) }));
  for (let col = exampleStart; col <= exampleStart + spec.headers.length + 1; col += 1) {
    sheet.getColumn(col).width = col === exampleStart + spec.headers.length + 1 ? 42 : 16;
  }
  styleWorksheet(sheet, spec.headers.length);
}

async function createTemplateWorkbookBytes() {
  const workbook = new Workbook();
  workbook.creator = "AI Timetable";
  workbook.created = new Date();
  addGuideSheet(workbook);
  SHEETS.forEach((spec) => addSpecSheet(workbook, spec));
  return workbook.xlsx.writeBuffer();
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const bytes = await createTemplateWorkbookBytes();
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="timetable-input.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
