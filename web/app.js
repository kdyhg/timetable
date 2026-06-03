const state = {
  selectedFile: null,
  currentImport: null,
  imports: [],
  scheduleResult: null,
  selectedCandidate: null,
  quickMoveSource: null,
  quickMoveOptions: [],
  quickMoveActive: false,
  chatConstraints: [],
  pendingConstraintDrafts: [],
  activeTab: "overview",
  apiValidated: false,
  validatedAiConfig: null,
};

const els = {
  healthBadge: document.querySelector("#healthBadge"),
  fileDrop: document.querySelector(".file-drop"),
  uploadInput: document.querySelector("#uploadInput"),
  selectedFileName: document.querySelector("#selectedFileName"),
  uploadButton: document.querySelector("#uploadButton"),
  solveMethod: document.querySelector("#solveMethod"),
  preferenceOrder: document.querySelector("#preferenceOrder"),
  solveIterations: document.querySelector("#solveIterations"),
  maxConsecutive: document.querySelector("#maxConsecutive"),
  balanceStrength: document.querySelector("#balanceStrength"),
  allowRelaxForUnassigned: document.querySelector("#allowRelaxForUnassigned"),
  protectLunch: document.querySelector("#protectLunch"),
  teacherDayMaxEnabled: document.querySelector("#teacherDayMaxEnabled"),
  teacherMaxMon: document.querySelector("#teacherMaxMon"),
  teacherMaxTue: document.querySelector("#teacherMaxTue"),
  teacherMaxWed: document.querySelector("#teacherMaxWed"),
  teacherMaxThu: document.querySelector("#teacherMaxThu"),
  teacherMaxFri: document.querySelector("#teacherMaxFri"),
  refreshImports: document.querySelector("#refreshImports"),
  importList: document.querySelector("#importList"),
  currentTitle: document.querySelector("#currentTitle"),
  currentSubtitle: document.querySelector("#currentSubtitle"),
  solveButton: document.querySelector("#solveButton"),
  solveStatus: document.querySelector("#solveStatus"),
  excelExport: document.querySelector("#excelExport"),
  neisExport: document.querySelector("#neisExport"),
  metrics: document.querySelector("#metrics"),
  validationState: document.querySelector("#validationState"),
  issueTable: document.querySelector("#issueTable"),
  reportLink: document.querySelector("#reportLink"),
  candidateBadge: document.querySelector("#candidateBadge"),
  candidateList: document.querySelector("#candidateList"),
  classSelect: document.querySelector("#classSelect"),
  viewMode: document.querySelector("#viewMode"),
  scheduleBoard: document.querySelector("#scheduleBoard"),
  diagnosticPanel: document.querySelector("#diagnosticPanel"),
  teacherIssuePanel: document.querySelector("#teacherIssuePanel"),
  quickEditStatus: document.querySelector("#quickEditStatus"),
  quickMoveList: document.querySelector("#quickMoveList"),
  moveMode: document.querySelector("#moveMode"),
  moveClass: document.querySelector("#moveClass"),
  moveFromDay: document.querySelector("#moveFromDay"),
  moveFromPeriod: document.querySelector("#moveFromPeriod"),
  moveToDay: document.querySelector("#moveToDay"),
  moveToPeriod: document.querySelector("#moveToPeriod"),
  moveButton: document.querySelector("#moveButton"),
  aiProvider: document.querySelector("#aiProvider"),
  aiModel: document.querySelector("#aiModel"),
  aiBaseUrl: document.querySelector("#aiBaseUrl"),
  aiBaseUrlLabel: document.querySelector("#aiBaseUrlLabel"),
  apiProviderBadge: document.querySelector("#apiProviderBadge"),
  apiKey: document.querySelector("#apiKey"),
  apiCheckButton: document.querySelector("#apiCheckButton"),
  apiStatus: document.querySelector("#apiStatus"),
  chatAiStatus: document.querySelector("#chatAiStatus"),
  chatLog: document.querySelector("#chatLog"),
  chatMessage: document.querySelector("#chatMessage"),
  chatButton: document.querySelector("#chatButton"),
  chatConstraintList: document.querySelector("#chatConstraintList"),
  systemLog: document.querySelector("#systemLog"),
};

const metricLabels = {
  teacherCount: "교사",
  classCount: "학급",
  subjectCount: "과목",
  roomCount: "특별실",
  fixedPeriodCount: "고정 일과",
  loadCount: "시수 행",
  constraintCount: "조건",
  syncGroupCount: "동시/합반",
  continuousCount: "연속",
  coTeacherCount: "복수교사",
};

const providerDefaults = {
  openai: { label: "OpenAI", model: "gpt-5.2" },
  gemini: { label: "Gemini", model: "gemini-2.5-flash" },
  custom: { label: "Custom", model: "" },
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function log(message) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = `${new Date().toLocaleTimeString()} · ${message}`;
  els.systemLog.prepend(line);
}

function setSelectedFile(file) {
  state.selectedFile = file || null;
  els.selectedFileName.textContent = state.selectedFile ? state.selectedFile.name : "선택된 파일 없음";
  els.uploadButton.disabled = !state.selectedFile;
}

function getAiConfig() {
  return {
    provider: els.aiProvider.value,
    model: els.aiModel.value.trim(),
    baseUrl: els.aiProvider.value === "custom" ? els.aiBaseUrl.value.trim() : "",
    apiKey: els.apiKey.value.trim(),
  };
}

function numericOption(input, fallback) {
  const value = Number(input?.value || fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getSolveOptions() {
  return {
    assignmentMethod: els.solveMethod.value,
    preferenceOrder: els.preferenceOrder.value,
    iterations: numericOption(els.solveIterations, 60),
    maxConsecutive: numericOption(els.maxConsecutive, 3),
    balanceStrength: els.balanceStrength.value,
    allowRelaxForUnassigned: els.allowRelaxForUnassigned.checked ? "Y" : "N",
    protectLunch: els.protectLunch.checked ? "Y" : "N",
    teacherDayMaxEnabled: els.teacherDayMaxEnabled.checked ? "Y" : "N",
    teacherDayMax: {
      월: els.teacherMaxMon.value.trim(),
      화: els.teacherMaxTue.value.trim(),
      수: els.teacherMaxWed.value.trim(),
      목: els.teacherMaxThu.value.trim(),
      금: els.teacherMaxFri.value.trim(),
    },
  };
}

function providerLabel(provider = els.aiProvider.value) {
  return providerDefaults[provider]?.label || provider;
}

function resetApiValidation(message = "API 키 미검증") {
  state.apiValidated = false;
  state.validatedAiConfig = null;
  els.apiStatus.textContent = message;
  els.apiStatus.classList.remove("ok");
  els.apiStatus.classList.add("error");
  els.apiProviderBadge.textContent = "미검증";
  els.apiProviderBadge.classList.add("muted");
  if (els.chatAiStatus) els.chatAiStatus.textContent = "왼쪽 시작 패널에서 AI 키를 먼저 검증하세요.";
  updateSolveAvailability();
}

function updateProviderFields(forceDefault = false) {
  const provider = els.aiProvider.value;
  const defaults = providerDefaults[provider] || providerDefaults.openai;
  els.aiBaseUrl.classList.toggle("hidden", provider !== "custom");
  els.aiBaseUrlLabel.classList.toggle("hidden", provider !== "custom");
  if (forceDefault || !els.aiModel.value.trim()) {
    els.aiModel.value = defaults.model;
  }
  resetApiValidation(`${defaults.label} API 키를 검증하세요.`);
}

function strategyName(strategy) {
  if (strategy?.startsWith("ga-")) {
    const labels = [];
    if (strategy.includes("spread-days")) labels.push("요일안배");
    if (strategy.includes("spread-periods")) labels.push("교시안배");
    if (strategy.includes("special-room")) labels.push("특별실");
    if (strategy.includes("relax")) labels.push("미배정완화");
    return labels.length ? labels.join(" · ") : "균형안";
  }
  return {
    balanced: "균형형",
    "gap-light": "공강 완화형",
    "special-room-first": "특별실 우선형",
    "ai-balance-off": "AI 개선: 균등완화",
    "ai-lunch-relaxed": "AI 개선: 점심완화",
    "ai-consecutive-plus1": "AI 개선: 연강완화",
    "ai-relax-combined": "AI 개선: 복합완화",
  }[strategy] || strategy;
}

function setExportsEnabled(enabled) {
  for (const link of [els.excelExport, els.neisExport]) {
    link.classList.toggle("disabled", !enabled);
  }
}

function updateSolveAvailability() {
  let status = "API 미검증";
  let enabled = false;
  const importItem = state.currentImport || state.imports.find((item) => item.ok) || null;
  if (!state.apiValidated) {
    status = "API 미검증";
  } else if (!importItem) {
    status = "엑셀 미업로드";
  } else if (!importItem.ok) {
    status = "검증 오류 있음";
  } else {
    status = "배정 가능";
    enabled = true;
  }
  els.solveButton.disabled = !enabled;
  els.solveButton.title = enabled ? "" : status;
  if (els.solveStatus) {
    els.solveStatus.textContent = status;
    els.solveStatus.classList.toggle("muted", !enabled);
  }
}

function getActiveImport() {
  if (state.currentImport) return state.currentImport;
  const item = state.imports.find((candidate) => candidate.ok) || state.imports[0] || null;
  if (item) {
    renderCurrentImport(item);
  }
  return item;
}

function requestBasePayload() {
  const item = getActiveImport();
  return {
    importId: item?.id || null,
    chatConstraints: state.chatConstraints,
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    throw new Error(data.error || data || `요청 실패: ${response.status}`);
  }
  return data;
}

async function checkHealth() {
  try {
    await api("/api/health");
    els.healthBadge.textContent = "연결됨";
  } catch (error) {
    els.healthBadge.textContent = "오프라인";
    log(error.message);
  }
}

function renderMetrics(stats = {}) {
  const keys = ["teacherCount", "classCount", "subjectCount", "roomCount", "fixedPeriodCount", "loadCount", "constraintCount"];
  els.metrics.innerHTML = keys
    .map((key) => {
      const label = metricLabels[key] || key;
      return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(stats[key] ?? 0)}</strong></div>`;
    })
    .join("");
}

function renderIssues(issues = []) {
  els.issueTable.innerHTML = "";
  if (!issues.length) {
    els.validationState.style.display = "block";
    els.validationState.textContent = "검증 오류가 없습니다. 자동배정을 실행할 수 있습니다.";
    return;
  }
  els.validationState.style.display = "none";
  els.issueTable.innerHTML = issues
    .map(
      (item) => `
        <div class="issue-row ${escapeHtml(item.severity)}">
          <div class="severity">${escapeHtml(item.severity)}</div>
          <div>${escapeHtml(item.sheet)}</div>
          <div>${escapeHtml(item.cell)}</div>
          <div>${escapeHtml(item.message)}</div>
          <div>${escapeHtml(item.fix)}</div>
        </div>
      `
    )
    .join("");
}

function renderCurrentImport(item) {
  const previousImportId = state.currentImport?.id || null;
  state.currentImport = item;
  state.scheduleResult = null;
  state.selectedCandidate = null;
  if ((item?.id || null) !== previousImportId) {
    state.chatConstraints = [];
    state.pendingConstraintDrafts = [];
    renderChatConstraints();
  }
  setExportsEnabled(false);
  if (!item) {
    els.currentTitle.textContent = "자료를 업로드하세요";
    els.currentSubtitle.textContent = "빈 양식은 구조 검증을 통과하며, 실제 자동배정은 시수표 입력 후 가능합니다.";
    updateSolveAvailability();
    els.reportLink.classList.add("disabled");
    renderMetrics();
    renderIssues([]);
    renderCandidates([]);
    renderSchedule(null);
    renderDiagnostics(null);
    renderTeacherIssues(null);
    clearQuickMove("수업 칸 선택", false);
    return;
  }
  const errorCount = item.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = item.issues.filter((issue) => issue.severity === "warning").length;
  els.currentTitle.textContent = item.fileName;
  els.currentSubtitle.textContent = `${item.createdAt} · 오류 ${errorCount}건 · 경고 ${warningCount}건`;
  updateSolveAvailability();
  els.reportLink.href = item.reportUrl || `/imports/${item.id}/report.xlsx`;
  els.reportLink.classList.remove("disabled");
  renderMetrics(item.stats);
  renderIssues(item.issues);
  renderDiagnostics(null);
  renderTeacherIssues(null);
  clearQuickMove("수업 칸 선택", false);
  renderImports();
}

function renderImports() {
  if (!state.imports.length) {
    els.importList.innerHTML = `<div class="empty-state">업로드 이력이 없습니다.</div>`;
    return;
  }
  els.importList.innerHTML = state.imports
    .map((item) => {
      const active = state.currentImport && state.currentImport.id === item.id ? "active" : "";
      const errors = item.issues.filter((issue) => issue.severity === "error").length;
      const status = item.ok ? "검증 가능" : `오류 ${errors}`;
      return `
        <button class="history-item ${active}" type="button" data-import-id="${escapeHtml(item.id)}">
          <strong>${escapeHtml(item.fileName)}</strong>
          <span class="history-meta">${escapeHtml(item.createdAt)} · ${escapeHtml(status)}</span>
        </button>
      `;
    })
    .join("");
}

async function loadImports() {
  const data = await api("/api/imports");
  state.imports = data.imports.map((item) => ({ ...item, reportUrl: `/imports/${item.id}/report.xlsx` }));
  renderImports();
  if (!state.currentImport && state.imports.length) {
    renderCurrentImport(state.imports[0]);
  }
}

async function uploadWorkbook() {
  if (!state.selectedFile) return;
  els.uploadButton.disabled = true;
  els.uploadButton.textContent = "검증 중";
  const form = new FormData();
  form.append("file", state.selectedFile);
  try {
    const result = await api("/imports/timetable-input", { method: "POST", body: form });
    const item = { ...result, reportUrl: result.reportUrl };
    state.imports = [item, ...state.imports.filter((existing) => existing.id !== item.id)];
    renderCurrentImport(item);
    log(`엑셀 검증 완료: ${result.ok ? "통과" : "오류 있음"}`);
  } catch (error) {
    log(error.message);
    alert(error.message);
  } finally {
    els.uploadButton.textContent = "↥ 업로드 및 검증";
    els.uploadButton.disabled = !state.selectedFile;
  }
}

function renderCandidates(candidates = [], selectedStrategy = "") {
  if (!candidates.length) {
    els.candidateBadge.textContent = "대기";
    els.candidateList.innerHTML = `<div class="empty-state">자동배정 후 후보 시간표가 표시됩니다.</div>`;
    return;
  }
  els.candidateBadge.textContent = `${candidates.length}개`;
  els.candidateList.innerHTML = candidates
    .map((candidate, index) => {
      const selected = candidate.strategy === selectedStrategy ? "selected" : "";
      const violations = (candidate.validation?.violations || []).filter((item) => item.severity === "error").length;
      const diagnostic = candidate.diagnostics?.find((item) => item.severity !== "success")?.reason || "";
      const relaxations = (candidate.relaxations || [])
        .map((item) => `<span class="relaxation-tag">${escapeHtml(item)}</span>`)
        .join("");
      return `
        <button class="candidate-item ${selected}" type="button" data-strategy="${escapeHtml(candidate.strategy)}">
          <div class="candidate-title">
            <span>후보 ${index + 1} · ${escapeHtml(strategyName(candidate.strategy))}</span>
            <span>${escapeHtml(candidate.score)}점</span>
          </div>
          <p>미배정 ${(candidate.unassigned || []).length}건 · 검증오류 ${violations}건</p>
          ${diagnostic ? `<p>${escapeHtml(diagnostic)}</p>` : ""}
          ${relaxations ? `<div class="relaxation-tags">${relaxations}</div>` : ""}
        </button>
      `;
    })
    .join("");
}

function renderDiagnostics(candidate = state.selectedCandidate) {
  const diagnostics = candidate?.diagnostics || [];
  if (!els.diagnosticPanel) return;
  if (!diagnostics.length) {
    els.diagnosticPanel.innerHTML = `<div class="diagnostic-row success"><strong>진단</strong><span>선택된 후보의 검증 진단이 없습니다.</span></div>`;
    return;
  }
  els.diagnosticPanel.innerHTML = diagnostics
    .slice(0, 8)
    .map(
      (item) => `
        <div class="diagnostic-row ${escapeHtml(item.severity || "warning")}">
          <strong>${escapeHtml(item.title || item.type || "진단")}</strong>
          <span>${escapeHtml(item.reason || "")}</span>
          <small>${escapeHtml(item.suggestion || "")}</small>
        </div>
      `
    )
    .join("");
}

function renderTeacherIssues(candidate = state.selectedCandidate) {
  if (!els.teacherIssuePanel) return;
  const issues = candidate?.teacherIssues || [];
  if (!candidate) {
    els.teacherIssuePanel.innerHTML = `<div class="empty-state compact">자동배정 후 배정불량교사가 표시됩니다.</div>`;
    return;
  }
  if (!issues.length) {
    els.teacherIssuePanel.innerHTML = `<div class="teacher-issue-row success"><strong>배정불량교사 없음</strong><span>안배·식사·연강 기준에서 큰 이상이 없습니다.</span></div>`;
    return;
  }
  els.teacherIssuePanel.innerHTML = issues
    .map((item) => {
      const tags = (item.issues || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
      const details = (item.details || []).slice(0, 2).join(" · ");
      return `
        <div class="teacher-issue-row ${escapeHtml(item.severity || "warning")}">
          <strong>${escapeHtml(item.teacherName || item.teacherCode)}</strong>
          <em>${escapeHtml(item.totalHours || 0)}시간</em>
          <div class="teacher-issue-tags">${tags}</div>
          <small>${escapeHtml(details)}</small>
        </div>
      `;
    })
    .join("");
}

async function solveSchedule() {
  const importItem = getActiveImport();
  if (!importItem?.id) {
    alert("먼저 엑셀을 업로드하고 검증을 완료하세요.");
    updateSolveAvailability();
    return;
  }
  els.solveButton.disabled = true;
  els.solveButton.textContent = "배정 중";
  try {
    const result = await api("/schedules/solve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        aiConfig: getAiConfig(),
        apiValidated: state.apiValidated,
        solveOptions: getSolveOptions(),
      }),
    });
    state.scheduleResult = result;
    state.selectedCandidate = result.selected;
    clearQuickMove("수업 칸 선택", false);
    renderCandidates(result.candidates, result.selected.strategy);
    renderSchedule(result.selected.schedule);
    renderDiagnostics(result.selected);
    renderTeacherIssues(result.selected);
    setActiveTab("timetable");
    setExportsEnabled(true);
    if (result.aiAdvisor?.advice) {
      const advice = result.aiAdvisor.advice;
      const lines = [advice.summary, ...(advice.suggestions || []).map((item) => `${item.title}: ${(item.steps || []).join(" → ") || item.explanation}`)].filter(Boolean);
      appendChat("assistant", `AI 자동배정 검토\n${lines.join("\n")}`, result.aiAdvisor.remote?.ok ? { responseId: result.aiAdvisor.remote.responseId, model: result.aiAdvisor.remote.model } : null);
    }
    log(`자동배정 완료: ${strategyName(result.bestStrategy)} 선택`);
  } catch (error) {
    log(error.message);
    alert(error.message);
  } finally {
    els.solveButton.textContent = "▶ AI 자동배정";
    updateSolveAvailability();
  }
}

function renderSchedule(schedule) {
  els.classSelect.innerHTML = "";
  els.scheduleBoard.innerHTML = "";
  if (!schedule || !Object.keys(schedule.classes || {}).length) {
    els.classSelect.innerHTML = `<option>학급 없음</option>`;
    els.scheduleBoard.innerHTML = `<div class="empty-state">표시할 시간표가 없습니다.</div>`;
    return;
  }
  const entities = els.viewMode.value === "teacher" ? buildTeacherViews(schedule) : schedule.classes;
  for (const [entityCode, entityData] of Object.entries(entities)) {
    const option = document.createElement("option");
    option.value = entityCode;
    option.textContent = entityData.name || entityCode;
    els.classSelect.append(option);
  }
  populateMoveControls(schedule);
  drawSelectedSchedule();
}

function buildTeacherViews(schedule) {
  const teachers = {};
  for (const [classCode, classData] of Object.entries(schedule.classes || {})) {
    for (const day of schedule.days || []) {
      for (const period of schedule.periods || []) {
        const cell = classData.grid[day][String(period)];
        if (!cell || !cell.teacherCode) continue;
        if (!teachers[cell.teacherCode]) {
          teachers[cell.teacherCode] = {
            name: cell.teacherName || cell.teacherCode,
            grid: Object.fromEntries(schedule.days.map((item) => [item, Object.fromEntries(schedule.periods.map((p) => [String(p), []]))])),
          };
        }
        teachers[cell.teacherCode].grid[day][String(period)].push({ ...cell, className: classData.name || classCode });
      }
    }
  }
  return teachers;
}

function renderCellContent(cell, mode) {
  if (!cell) return `<div class="schedule-cell"><small>비어 있음</small></div>`;
  const fixed = cell.source === "fixed";
  const teacherLine = mode === "teacher" ? `<span>${escapeHtml(cell.className || cell.classCode)}</span>` : cell.teacherName ? `<span>${escapeHtml(cell.teacherName)}</span>` : "";
  const meta = fixed ? cell.kind || "고정 일과" : cell.roomName || cell.source;
  return `
    <div class="schedule-cell ${fixed ? "fixed" : ""}">
      <strong>${escapeHtml(cell.subjectName)}</strong>
      ${teacherLine}
      <small>${escapeHtml(meta)}</small>
    </div>
  `;
}

function quickOptionKey(day, period) {
  return `${day}::${Number(period)}`;
}

function findQuickMoveOption(day, period) {
  const key = quickOptionKey(day, period);
  return state.quickMoveOptions.find((item) => quickOptionKey(item.day, item.period) === key) || null;
}

function isQuickMoveSource(classCode, day, period) {
  const source = state.quickMoveSource;
  return Boolean(source && source.classCode === classCode && source.day === day && Number(source.period) === Number(period));
}

function setQuickEditStatus(message, variant = "") {
  if (!els.quickEditStatus) return;
  els.quickEditStatus.textContent = message;
  els.quickEditStatus.classList.toggle("ok", variant === "ok");
  els.quickEditStatus.classList.toggle("error", variant === "error");
}

function renderQuickMoveList() {
  if (!els.quickMoveList) return;
  const gradeLabels = { good: "좋음", ok: "가능", warn: "주의", bad: "불가" };
  if (!state.quickMoveSource) {
    els.quickMoveList.innerHTML = `<div class="empty-state compact">수업 칸을 선택하세요.</div>`;
    return;
  }
  if (!state.quickMoveActive) {
    els.quickMoveList.innerHTML = `<div class="empty-state compact">Enter를 누르면 이동 후보가 표시됩니다.</div>`;
    return;
  }
  if (!state.quickMoveOptions.length) {
    els.quickMoveList.innerHTML = `<div class="empty-state compact">이동 가능한 칸이 없습니다.</div>`;
    return;
  }
  els.quickMoveList.innerHTML = state.quickMoveOptions
    .slice(0, 12)
    .map((option) => {
      const label = gradeLabels[option.grade] || "가능";
      const reasons = (option.reasons || []).slice(0, 2).join(" · ");
      return `
        <button class="move-option-item ${escapeHtml(option.grade)}" type="button" data-option-key="${escapeHtml(quickOptionKey(option.day, option.period))}">
          <strong>${escapeHtml(option.day)} ${escapeHtml(option.period)}교시</strong>
          <span>${escapeHtml(option.mode === "swap" ? "맞교환" : "이동")} · ${escapeHtml(label)}</span>
          <small>${escapeHtml(reasons)}</small>
        </button>
      `;
    })
    .join("");
}

function clearQuickMove(message = "수업 칸 선택", redraw = true) {
  state.quickMoveSource = null;
  state.quickMoveOptions = [];
  state.quickMoveActive = false;
  setQuickEditStatus(message);
  renderQuickMoveList();
  if (redraw) drawSelectedSchedule();
}

function drawSelectedSchedule() {
  const schedule = state.selectedCandidate?.schedule;
  if (!schedule) return;
  const mode = els.viewMode.value;
  const entities = mode === "teacher" ? buildTeacherViews(schedule) : schedule.classes;
  const entityCode = els.classSelect.value || Object.keys(entities)[0];
  const entityData = entities[entityCode];
  if (!entityData) {
    els.scheduleBoard.innerHTML = `<div class="empty-state">표시할 시간표가 없습니다.</div>`;
    return;
  }
  const header = `<tr><th>요일</th>${schedule.periods.map((period) => `<th>${period}교시</th>`).join("")}</tr>`;
  const rows = schedule.days
    .map((day) => {
      const cells = schedule.periods
        .map((period) => {
          const dayLimit = Number(entityData.dayLimits?.[day] ?? schedule.periods.length);
          if (mode === "class" && period > dayLimit) {
            return `<td class="unavailable"><div class="schedule-cell unavailable"><small>수업 없음</small></div></td>`;
          }
          const raw = entityData.grid[day][String(period)];
          const cell = Array.isArray(raw) ? raw[0] : raw;
          const option = mode === "class" ? findQuickMoveOption(day, period) : null;
          const cellClasses = [];
          if (mode === "class" && isQuickMoveSource(entityCode, day, period)) cellClasses.push("quick-source");
          if (option) cellClasses.push("quick-option", `quick-${option.grade || "ok"}`);
          const attrs = mode === "class" ? `data-day="${escapeHtml(day)}" data-period="${period}" data-class-code="${escapeHtml(entityCode)}" data-has-cell="${cell ? "1" : "0"}" data-source="${escapeHtml(cell?.source || "")}"` : "";
          const note = option ? `<div class="move-option-note">${escapeHtml(option.grade === "good" ? "좋음" : option.grade === "warn" ? "주의" : option.grade === "bad" ? "불가" : "가능")}</div>` : "";
          return `<td class="${cellClasses.join(" ")}" ${attrs}>${renderCellContent(cell, mode)}${note}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(day)}</th>${cells}</tr>`;
    })
    .join("");
  els.scheduleBoard.innerHTML = `<table class="schedule-table">${header}${rows}</table>`;
}

function fillSelect(select, values, formatter = (value) => value) {
  select.innerHTML = "";
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = formatter(value);
    select.append(option);
  }
}

function populateMoveControls(schedule) {
  fillSelect(
    els.moveClass,
    Object.keys(schedule.classes || {}),
    (classCode) => schedule.classes[classCode].name || classCode
  );
  fillSelect(els.moveFromDay, schedule.days || []);
  fillSelect(els.moveToDay, schedule.days || []);
}

async function handleScheduleCellClick(event) {
  if (els.viewMode.value !== "class") return;
  const cell = event.target.closest("td[data-day]");
  if (!cell || cell.dataset.source === "fixed") return;
  const quickOption = state.quickMoveActive ? findQuickMoveOption(cell.dataset.day, Number(cell.dataset.period)) : null;
  if (quickOption) {
    await applyQuickMoveOption(quickOption);
    return;
  }
  els.moveClass.value = cell.dataset.classCode;
  if (cell.dataset.hasCell === "1") {
    els.moveFromDay.value = cell.dataset.day;
    els.moveFromPeriod.value = cell.dataset.period;
    state.quickMoveSource = {
      classCode: cell.dataset.classCode,
      day: cell.dataset.day,
      period: Number(cell.dataset.period),
    };
    state.quickMoveOptions = [];
    state.quickMoveActive = false;
    setQuickEditStatus(`${cell.dataset.day} ${cell.dataset.period}교시 선택됨 · Enter`);
    renderQuickMoveList();
    drawSelectedSchedule();
  } else {
    els.moveToDay.value = cell.dataset.day;
    els.moveToPeriod.value = cell.dataset.period;
  }
}

async function loadQuickMoveOptions() {
  if (!getActiveImport() || !state.selectedCandidate || !state.quickMoveSource) {
    setQuickEditStatus("이동할 수업 칸을 먼저 선택하세요.", "error");
    return;
  }
  setQuickEditStatus("이동 후보 계산 중");
  try {
    const result = await api("/schedules/move-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        schedule: state.selectedCandidate.schedule,
        from: state.quickMoveSource,
      }),
    });
    if (!result.ok) {
      state.quickMoveOptions = [];
      state.quickMoveActive = false;
      setQuickEditStatus(result.message || "이동 후보를 만들 수 없습니다.", "error");
      renderQuickMoveList();
      drawSelectedSchedule();
      return;
    }
    state.quickMoveOptions = result.options || [];
    state.quickMoveActive = true;
    if (result.teacherIssues) {
      state.selectedCandidate.teacherIssues = result.teacherIssues;
      renderTeacherIssues(state.selectedCandidate);
    }
    setQuickEditStatus(`이동 후보 ${state.quickMoveOptions.length}개`, state.quickMoveOptions.length ? "ok" : "error");
    renderQuickMoveList();
    drawSelectedSchedule();
  } catch (error) {
    setQuickEditStatus(error.message, "error");
    log(error.message);
  }
}

async function submitManualMove(move) {
  if (!getActiveImport() || !state.selectedCandidate) return;
  try {
    const result = await api("/schedules/move", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        schedule: state.selectedCandidate.schedule,
        effectiveConfig: state.selectedCandidate.effectiveConfig || null,
        strategy: state.selectedCandidate.strategy,
        relaxations: state.selectedCandidate.relaxations || [],
        move,
      }),
    });
    if (!result.validation) {
      log(result.message);
      if (!result.ok) alert(result.message);
      return;
    }
    state.selectedCandidate.schedule = result.schedule;
    state.selectedCandidate.validation = result.validation || state.selectedCandidate.validation;
    state.selectedCandidate.diagnostics = result.diagnostics || state.selectedCandidate.diagnostics;
    state.selectedCandidate.teacherIssues = result.teacherIssues || state.selectedCandidate.teacherIssues || [];
    state.selectedCandidate.manualEdited = true;
    const candidate = state.scheduleResult?.candidates?.find((item) => item.strategy === state.selectedCandidate.strategy);
    if (candidate) {
      candidate.schedule = state.selectedCandidate.schedule;
      candidate.validation = state.selectedCandidate.validation;
      candidate.diagnostics = state.selectedCandidate.diagnostics;
      candidate.teacherIssues = state.selectedCandidate.teacherIssues;
      candidate.manualEdited = true;
    }
    if (state.scheduleResult?.selected?.strategy === state.selectedCandidate.strategy) {
      state.scheduleResult.selected = state.selectedCandidate;
    }
    clearQuickMove("수정 완료", false);
    renderCandidates(state.scheduleResult?.candidates || [], state.selectedCandidate.strategy);
    renderSchedule(state.selectedCandidate.schedule);
    renderDiagnostics(state.selectedCandidate);
    renderTeacherIssues(state.selectedCandidate);
    log(result.message);
  } catch (error) {
    log(error.message);
    alert(error.message);
  }
}

async function applyQuickMoveOption(option) {
  if (!state.quickMoveSource || !option) return;
  const move = {
    mode: option.mode || "auto",
    from: state.quickMoveSource,
    to: {
      day: option.day,
      period: Number(option.period),
    },
  };
  await submitManualMove(move);
}

async function applyManualMove() {
  const move = {
    mode: els.moveMode.value,
    from: {
      classCode: els.moveClass.value,
      day: els.moveFromDay.value,
      period: Number(els.moveFromPeriod.value),
    },
    to: {
      day: els.moveToDay.value,
      period: Number(els.moveToPeriod.value),
    },
  };
  await submitManualMove(move);
}

function handleQuickEditKeydown(event) {
  const tagName = event.target?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(tagName)) return;
  if (event.key === "Enter") {
    event.preventDefault();
    loadQuickMoveOptions();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    clearQuickMove("간편수정 취소");
  }
}

function constraintLabel(item) {
  const dayText = (item.days || []).join(",") || "전체요일";
  const periodText = item.periodsText || (item.periods || []).join(",") || "전체교시";
  return `${item.targetName || item.targetCode} · ${item.conditionType} · ${dayText} ${periodText}교시`;
}

function sameConstraint(a, b) {
  return [
    "targetType",
    "targetCode",
    "conditionType",
    "periodsText",
    "strength",
  ].every((key) => String(a[key] || "") === String(b[key] || "")) && JSON.stringify(a.days || []) === JSON.stringify(b.days || []);
}

function renderChatConstraints() {
  if (!els.chatConstraintList) return;
  const pending = state.pendingConstraintDrafts || [];
  const applied = state.chatConstraints || [];
  if (!pending.length && !applied.length) {
    els.chatConstraintList.innerHTML = "";
    return;
  }
  const pendingHtml = pending
    .map((item, index) => `
      <div class="constraint-draft pending">
        <span>${escapeHtml(constraintLabel(item))}</span>
        <button class="mini-button" type="button" data-apply-constraint="${index}">적용</button>
      </div>
    `)
    .join("");
  const appliedHtml = applied
    .map((item, index) => `
      <div class="constraint-draft applied">
        <span>${escapeHtml(constraintLabel(item))}</span>
        <button class="mini-button ghost" type="button" data-remove-constraint="${index}">해제</button>
      </div>
    `)
    .join("");
  els.chatConstraintList.innerHTML = `
    ${pendingHtml ? `<div class="constraint-group"><strong>AI 제약 초안</strong>${pendingHtml}</div>` : ""}
    ${appliedHtml ? `<div class="constraint-group"><strong>적용 중인 대화 제약</strong>${appliedHtml}</div>` : ""}
  `;
}

function applyConstraintDraft(index) {
  const draft = state.pendingConstraintDrafts[index];
  if (!draft) return;
  if (!state.chatConstraints.some((item) => sameConstraint(item, draft))) {
    state.chatConstraints.push(draft);
  }
  state.pendingConstraintDrafts.splice(index, 1);
  renderChatConstraints();
  updateSolveAvailability();
  log(`대화 제약 적용: ${constraintLabel(draft)}`);
}

function removeChatConstraint(index) {
  const removed = state.chatConstraints.splice(index, 1)[0];
  renderChatConstraints();
  if (removed) log(`대화 제약 해제: ${constraintLabel(removed)}`);
}

async function sendChat() {
  const message = els.chatMessage.value.trim();
  if (!message) return;
  appendChat("user", message);
  els.chatMessage.value = "";
  els.chatButton.disabled = true;
  try {
    const response = await api("/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        message,
        aiConfig: getAiConfig(),
        apiValidated: state.apiValidated,
        schedule: state.selectedCandidate?.schedule || null,
        unassigned: state.selectedCandidate?.unassigned || [],
        effectiveConfig: state.selectedCandidate?.effectiveConfig || null,
      }),
    });
    const suggestionText = response.suggestions
      .map((item) => {
        const body = item.explanation || (item.steps ? item.steps.join(" → ") : JSON.stringify(item.draft));
        return `${item.title}: ${body}`;
      })
      .join("\n");
    const summary = response.advice?.summary ? `${response.advice.summary}\n` : "";
    appendChat("assistant", `${response.privacy}\n${summary}${suggestionText}`, response.maskedPayload);
    if (response.constraintDrafts?.length) {
      state.pendingConstraintDrafts = response.constraintDrafts;
      renderChatConstraints();
      setActiveTab("diagnostics");
    }
    log("AI 제안 생성 완료");
  } catch (error) {
    appendChat("assistant", error.message);
    log(error.message);
  } finally {
    els.chatButton.disabled = false;
  }
}

async function validateApiKey() {
  els.apiCheckButton.disabled = true;
  els.apiStatus.textContent = `${providerLabel()} API 키 검증 중`;
  try {
    const result = await api("/ai/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiConfig: getAiConfig() }),
    });
    state.apiValidated = Boolean(result.ok);
    state.validatedAiConfig = result.aiConfig || null;
    els.apiStatus.textContent = result.message;
    els.apiStatus.classList.toggle("ok", Boolean(result.ok));
    els.apiStatus.classList.toggle("error", !result.ok);
    els.apiProviderBadge.textContent = result.ok ? `${providerLabel()} 연결됨` : "미검증";
    els.apiProviderBadge.classList.toggle("muted", !result.ok);
    if (els.chatAiStatus) {
      els.chatAiStatus.textContent = result.ok ? `${providerLabel()} 연결이 검증되었습니다.` : "왼쪽 시작 패널에서 AI 키를 먼저 검증하세요.";
    }
    log(result.message);
    updateSolveAvailability();
  } catch (error) {
    state.apiValidated = false;
    els.apiStatus.textContent = error.message;
    els.apiStatus.classList.remove("ok");
    els.apiStatus.classList.add("error");
    els.apiProviderBadge.textContent = "미검증";
    els.apiProviderBadge.classList.add("muted");
    if (els.chatAiStatus) els.chatAiStatus.textContent = "왼쪽 시작 패널에서 AI 키를 먼저 검증하세요.";
    log(error.message);
    updateSolveAvailability();
  } finally {
    els.apiCheckButton.disabled = false;
  }
}

function appendChat(role, message, payload = null) {
  const node = document.createElement("div");
  node.className = `chat-message ${role === "user" ? "user" : ""}`;
  node.innerHTML = `<strong>${role === "user" ? "사용자" : "AI 제안"}</strong><div>${escapeHtml(message).replaceAll("\n", "<br>")}</div>`;
  if (payload) {
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(payload, null, 2);
    node.append(pre);
  }
  els.chatLog.append(node);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function setActiveTab(tabName) {
  state.activeTab = tabName || "overview";
  for (const button of document.querySelectorAll("[data-tab-target]")) {
    button.classList.toggle("active", button.dataset.tabTarget === state.activeTab);
  }
  for (const panel of document.querySelectorAll("[data-tab-panel]")) {
    panel.classList.toggle("active", panel.dataset.tabPanel === state.activeTab);
  }
}

function wireEvents() {
  els.uploadInput.addEventListener("change", () => {
    setSelectedFile(els.uploadInput.files[0] || null);
  });
  els.fileDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.fileDrop.classList.add("dragging");
  });
  els.fileDrop.addEventListener("dragleave", () => {
    els.fileDrop.classList.remove("dragging");
  });
  els.fileDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    els.fileDrop.classList.remove("dragging");
    const file = event.dataTransfer.files[0];
    if (file) setSelectedFile(file);
  });
  els.uploadButton.addEventListener("click", uploadWorkbook);
  els.refreshImports.addEventListener("click", () => loadImports().catch((error) => log(error.message)));
  els.solveButton.addEventListener("click", solveSchedule);
  els.importList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-import-id]");
    if (!button) return;
    const item = state.imports.find((candidate) => candidate.id === button.dataset.importId);
    renderCurrentImport(item);
    log(`업로드 이력 선택: ${item.fileName}`);
  });
  els.candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-strategy]");
    if (!button || !state.scheduleResult) return;
    const candidate = state.scheduleResult.candidates.find((item) => item.strategy === button.dataset.strategy);
    state.selectedCandidate = candidate;
    clearQuickMove("수업 칸 선택", false);
    renderCandidates(state.scheduleResult.candidates, candidate.strategy);
    renderSchedule(candidate.schedule);
    renderDiagnostics(candidate);
    renderTeacherIssues(candidate);
  });
  els.viewMode.addEventListener("change", () => {
    clearQuickMove("수업 칸 선택", false);
    renderSchedule(state.selectedCandidate?.schedule);
  });
  els.classSelect.addEventListener("change", () => {
    clearQuickMove("수업 칸 선택", false);
    drawSelectedSchedule();
  });
  els.scheduleBoard.addEventListener("click", handleScheduleCellClick);
  els.quickMoveList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-option-key]");
    if (!button) return;
    const option = state.quickMoveOptions.find((item) => quickOptionKey(item.day, item.period) === button.dataset.optionKey);
    applyQuickMoveOption(option);
  });
  els.chatConstraintList?.addEventListener("click", (event) => {
    const applyButton = event.target.closest("[data-apply-constraint]");
    if (applyButton) {
      applyConstraintDraft(Number(applyButton.dataset.applyConstraint));
      return;
    }
    const removeButton = event.target.closest("[data-remove-constraint]");
    if (removeButton) {
      removeChatConstraint(Number(removeButton.dataset.removeConstraint));
    }
  });
  document.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-tab-target]");
    if (!tabButton) return;
    event.preventDefault();
    setActiveTab(tabButton.dataset.tabTarget);
  });
  els.moveButton.addEventListener("click", applyManualMove);
  document.addEventListener("keydown", handleQuickEditKeydown);
  els.apiCheckButton.addEventListener("click", validateApiKey);
  els.aiProvider.addEventListener("change", () => updateProviderFields(true));
  for (const input of [els.apiKey, els.aiModel, els.aiBaseUrl]) {
    input.addEventListener("input", () => resetApiValidation(`${providerLabel()} API 키를 다시 검증하세요.`));
  }
  els.chatButton.addEventListener("click", sendChat);
  els.chatMessage.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      sendChat();
    }
  });
}

async function boot() {
  renderMetrics();
  renderIssues([]);
  renderCandidates([]);
  renderSchedule(null);
  renderTeacherIssues(null);
  renderQuickMoveList();
  renderChatConstraints();
  setActiveTab("overview");
  updateProviderFields(false);
  appendChat("assistant", "엑셀에는 이름으로 입력하세요. 저는 서버가 자동 코드화한 자료만 보고 제안합니다.");
  wireEvents();
  await checkHealth();
  await loadImports();
  log("앱 초기화 완료");
}

boot().catch((error) => {
  log(error.message);
});
