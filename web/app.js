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
  startStep: "api",
  setupComplete: false,
  apiValidated: false,
  validatedAiConfig: null,
  sessionAiConfig: null,
  solveLaunchContext: "workspace",
  solveInProgress: false,
  solveSessionId: "",
  solveStartedAt: 0,
  solveAcceptVisible: false,
  solveAcceptRequested: false,
  solveAcceptInProgress: false,
  solveAcceptedResult: null,
  pendingMovePreview: null,
  pendingScheduleProposal: null,
  pendingPreviewKind: "",
  chatPendingRemoteId: 0,
  chatLocalResponse: null,
  chatLocalDisplayed: false,
  insights: null,
  scenarios: [],
};

const STORAGE_KEYS = {
  importId: "ai-timetable:last-import-id",
};

const els = {
  healthBadge: document.querySelector("#healthBadge"),
  startPanel: document.querySelector(".start-panel"),
  fileDrop: document.querySelector(".file-drop"),
  uploadInput: document.querySelector("#uploadInput"),
  selectedFileName: document.querySelector("#selectedFileName"),
  uploadButton: document.querySelector("#uploadButton"),
  uploadStatus: document.querySelector("#uploadStatus"),
  uploadReportLink: document.querySelector("#uploadReportLink"),
  uploadIssuePreview: document.querySelector("#uploadIssuePreview"),
  solveMethod: document.querySelector("#solveMethod"),
  searchStrength: document.querySelector("#searchStrength"),
  variationMode: document.querySelector("#variationMode"),
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
  startSolveButton: document.querySelector("#startSolveButton"),
  solvePreferenceModal: document.querySelector("#solvePreferenceModal"),
  solvePreferenceClose: document.querySelector("#solvePreferenceClose"),
  solvePreferenceCancel: document.querySelector("#solvePreferenceCancel"),
  solvePreferenceConfirm: document.querySelector("#solvePreferenceConfirm"),
  solveOverlay: document.querySelector("#solveOverlay"),
  solveFailureBox: document.querySelector("#solveFailureBox"),
  solveFailureMessage: document.querySelector("#solveFailureMessage"),
  retrySolveButton: document.querySelector("#retrySolveButton"),
  editSolvePreferenceButton: document.querySelector("#editSolvePreferenceButton"),
  solveProgressMessage: document.querySelector("#solveProgressMessage"),
  solveProgressStats: document.querySelector("#solveProgressStats"),
  acceptBestSolveButton: document.querySelector("#acceptBestSolveButton"),
  solveOverlayProgressMessage: document.querySelector("#solveOverlayProgressMessage"),
  solveOverlayProgressStats: document.querySelector("#solveOverlayProgressStats"),
  acceptBestSolveOverlayButton: document.querySelector("#acceptBestSolveOverlayButton"),
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
  refreshInsightsButton: document.querySelector("#refreshInsightsButton"),
  analysisSummary: document.querySelector("#analysisSummary"),
  unassignedDashboard: document.querySelector("#unassignedDashboard"),
  riskDashboard: document.querySelector("#riskDashboard"),
  relaxationSimulator: document.querySelector("#relaxationSimulator"),
  candidateComparison: document.querySelector("#candidateComparison"),
  syncGroupVisualization: document.querySelector("#syncGroupVisualization"),
  manualRecommendations: document.querySelector("#manualRecommendations"),
  neisPrecheck: document.querySelector("#neisPrecheck"),
  scenarioName: document.querySelector("#scenarioName"),
  saveScenarioButton: document.querySelector("#saveScenarioButton"),
  scenarioList: document.querySelector("#scenarioList"),
  solveQueuePanel: document.querySelector("#solveQueuePanel"),
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
  aiModelSelect: document.querySelector("#aiModelSelect"),
  aiModelCustom: document.querySelector("#aiModelCustom"),
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
  chatPendingBox: document.querySelector("#chatPendingBox"),
  chatPendingMessage: document.querySelector("#chatPendingMessage"),
  chatUseLocalButton: document.querySelector("#chatUseLocalButton"),
  chatConstraintList: document.querySelector("#chatConstraintList"),
  startStepBadge: document.querySelector("#startStepBadge"),
  initialConstraintText: document.querySelector("#initialConstraintText"),
  initialConstraintButton: document.querySelector("#initialConstraintButton"),
  initialConstraintStatus: document.querySelector("#initialConstraintStatus"),
  skipConstraintButton: document.querySelector("#skipConstraintButton"),
  systemLog: document.querySelector("#systemLog"),
  recentLogsButton: document.querySelector("#recentLogsButton"),
  downloadLogsLink: document.querySelector("#downloadLogsLink"),
  changePreviewModal: document.querySelector("#changePreviewModal"),
  changePreviewClose: document.querySelector("#changePreviewClose"),
  changePreviewCancel: document.querySelector("#changePreviewCancel"),
  changePreviewConfirm: document.querySelector("#changePreviewConfirm"),
  changePreviewTitle: document.querySelector("#changePreviewTitle"),
  changePreviewBody: document.querySelector("#changePreviewBody"),
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
  syncBundleCount: "동시묶음",
  continuousCount: "연속",
  coTeacherCount: "복수교사",
};

const CUSTOM_MODEL_VALUE = "__custom_model__";

const providerDefaults = {
  openai: {
    label: "OpenAI",
    model: "gpt-5.5",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.2", "gpt-5.2-chat-latest", "gpt-5-mini", "gpt-5-nano", "gpt-5.2-pro"],
  },
  gemini: {
    label: "Gemini",
    model: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-3.1-pro-preview", "gemini-3-flash-preview", "gemini-3.1-flash-lite"],
  },
  custom: { label: "Custom", model: "", models: [] },
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

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    if (value) window.localStorage?.setItem(key, value);
  } catch {
    // Browser storage can be disabled; the server fallback still handles this case.
  }
}

function scheduleResultImportId(result = state.scheduleResult) {
  return (
    result?.importId ||
    result?.solveSession?.importId ||
    result?.selected?.importId ||
    ""
  );
}

function rememberImportId(importId) {
  if (importId) storageSet(STORAGE_KEYS.importId, importId);
}

function normalizeImport(item) {
  if (!item) return null;
  const id = item.id || "";
  return {
    ...item,
    issues: Array.isArray(item.issues) ? item.issues : [],
    stats: item.stats || {},
    reportUrl: item.reportUrl || (id ? `/imports/${id}/report.xlsx` : ""),
  };
}

function setUploadStatus(message, tone = "", reportUrl = "", issues = []) {
  if (els.uploadStatus) {
    els.uploadStatus.textContent = message;
    els.uploadStatus.classList.remove("ok", "error", "warning");
    if (tone) els.uploadStatus.classList.add(tone);
  }
  if (els.uploadReportLink) {
    els.uploadReportLink.href = reportUrl || "#";
    els.uploadReportLink.classList.toggle("hidden", !reportUrl);
  }
  if (!els.uploadIssuePreview) return;
  const visibleIssues = Array.isArray(issues) ? issues.slice(0, 6) : [];
  els.uploadIssuePreview.classList.toggle("hidden", !visibleIssues.length);
  els.uploadIssuePreview.innerHTML = visibleIssues.length
    ? `
      <strong>먼저 고칠 항목</strong>
      ${visibleIssues
        .map(
          (issue) => `
            <div class="upload-issue-row">
              <span>${escapeHtml(issue.sheet)} ${escapeHtml(issue.cell)}</span>
              <p>${escapeHtml(issue.message)}</p>
              <small>${escapeHtml(issue.fix)}</small>
            </div>
          `
        )
        .join("")}
    `
    : "";
}

function setSelectedFile(file) {
  state.selectedFile = file || null;
  els.selectedFileName.textContent = state.selectedFile ? state.selectedFile.name : "선택된 파일 없음";
  els.uploadButton.disabled = !state.selectedFile;
  setUploadStatus(
    state.selectedFile ? "파일이 선택되었습니다. 업로드 및 검증을 눌러 구조 검사를 시작하세요." : "작성한 엑셀을 선택한 뒤 검증하면 결과가 여기에 표시됩니다.",
    "",
    "",
    []
  );
}

function syncModelValueFromControls() {
  if (!els.aiModelSelect || !els.aiModel) return;
  const provider = els.aiProvider.value;
  if (provider === "custom" || els.aiModelSelect.value === CUSTOM_MODEL_VALUE) {
    els.aiModel.value = els.aiModelCustom?.value.trim() || "";
  } else {
    els.aiModel.value = els.aiModelSelect.value || "";
  }
}

function renderModelOptions(forceDefault = false) {
  if (!els.aiModelSelect) return;
  const provider = els.aiProvider.value;
  const defaults = providerDefaults[provider] || providerDefaults.openai;
  const previous = els.aiModel.value.trim();
  const models = defaults.models || [];
  els.aiModelSelect.innerHTML = "";
  if (models.length) {
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      els.aiModelSelect.append(option);
    }
  }
  const customOption = document.createElement("option");
  customOption.value = CUSTOM_MODEL_VALUE;
  customOption.textContent = "기타 직접 입력";
  els.aiModelSelect.append(customOption);

  const nextModel = forceDefault ? defaults.model : previous || defaults.model;
  if (models.includes(nextModel)) {
    els.aiModelSelect.value = nextModel;
    if (els.aiModelCustom) {
      els.aiModelCustom.value = "";
      els.aiModelCustom.classList.add("hidden");
    }
    els.aiModel.value = nextModel;
  } else {
    els.aiModelSelect.value = CUSTOM_MODEL_VALUE;
    if (els.aiModelCustom) {
      els.aiModelCustom.value = nextModel;
      els.aiModelCustom.classList.remove("hidden");
    }
    els.aiModel.value = nextModel;
  }
  if (provider === "custom" && els.aiModelCustom) {
    els.aiModelSelect.value = CUSTOM_MODEL_VALUE;
    els.aiModelCustom.classList.remove("hidden");
    els.aiModel.value = els.aiModelCustom.value.trim();
  }
}

function handleModelSelectionChange() {
  const custom = els.aiProvider.value === "custom" || els.aiModelSelect?.value === CUSTOM_MODEL_VALUE;
  els.aiModelCustom?.classList.toggle("hidden", !custom);
  syncModelValueFromControls();
}

function readAiConfig() {
  syncModelValueFromControls();
  return {
    provider: els.aiProvider.value,
    model: els.aiModel.value.trim(),
    baseUrl: els.aiProvider.value === "custom" ? els.aiBaseUrl.value.trim() : "",
    apiKey: els.apiKey.value.trim(),
  };
}

function getAiConfig() {
  if (state.sessionAiConfig) {
    return { ...state.sessionAiConfig };
  }
  return { ...readAiConfig(), validated: state.apiValidated };
}

function numericOption(input, fallback) {
  const value = Number(input?.value || fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getSolveOptions() {
  return {
    assignmentMethod: els.solveMethod.value,
    searchStrength: els.searchStrength?.value || "strong",
    variationMode: els.variationMode?.value || "quality-first",
    requireCpSat: "Y",
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
  state.sessionAiConfig = null;
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
  renderModelOptions(forceDefault || !els.aiModel.value.trim());
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

const startSteps = ["api", "excel", "constraints", "preferences", "solving"];

function setStartStep(stepName) {
  const step = startSteps.includes(stepName) ? stepName : "api";
  if (!state.setupComplete) {
    els.startPanel?.classList.remove("completed");
    document.body.classList.remove("setup-complete");
  }
  state.startStep = step;
  const stepIndex = startSteps.indexOf(step);
  const progressIndex = step === "solving" ? startSteps.indexOf("preferences") : stepIndex;
  for (const panel of document.querySelectorAll("[data-start-step]")) {
    panel.classList.toggle("active", panel.dataset.startStep === step);
  }
  for (const item of document.querySelectorAll("[data-progress-step]")) {
    const index = startSteps.indexOf(item.dataset.progressStep);
    item.classList.toggle("active", index <= progressIndex);
  }
  if (els.startStepBadge) {
    els.startStepBadge.textContent = step === "solving" ? "진행 중" : `${stepIndex + 1}/4`;
  }
}

function completeSetup() {
  state.setupComplete = true;
  els.startPanel?.classList.add("completed");
  document.body.classList.add("setup-complete");
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
  if (state.solveInProgress) {
    status = "배정 진행 중";
    enabled = false;
  }
  els.solveButton.disabled = !enabled;
  els.solveButton.title = enabled ? "" : status;
  if (els.startSolveButton) {
    els.startSolveButton.disabled = !enabled;
    els.startSolveButton.title = enabled ? "" : status;
  }
  if (els.solveStatus) {
    els.solveStatus.textContent = status;
    els.solveStatus.classList.toggle("muted", !enabled);
  }
}

function getActiveImport() {
  if (state.currentImport) return state.currentImport;
  const storedId = storageGet(STORAGE_KEYS.importId);
  const item = state.imports.find((candidate) => candidate.id === storedId) || state.imports.find((candidate) => candidate.ok) || state.imports[0] || null;
  if (item) {
    renderCurrentImport(item);
  }
  return item;
}

function requestBasePayload() {
  const item = getActiveImport();
  const importId = item?.id || storageGet(STORAGE_KEYS.importId) || scheduleResultImportId() || null;
  return {
    importId,
    fallbackLatestImport: true,
    fallbackLastSchedule: true,
    chatConstraints: state.chatConstraints,
  };
}

async function requestBasePayloadForSolve() {
  const payload = requestBasePayload();
  if (payload.importId) return payload;
  try {
    const result = await api("/schedules/current");
    const importId = scheduleResultImportId(result.scheduleResult);
    if (importId) {
      rememberImportId(importId);
      if (!state.scheduleResult && result.scheduleResult) {
        state.scheduleResult = result.scheduleResult;
        state.selectedCandidate = result.scheduleResult.selected || null;
      }
      return { ...payload, importId };
    }
  } catch (error) {
    log(error.message);
  }
  throw new Error("이전 배정의 입력 엑셀 자료를 찾지 못했습니다. 엑셀을 다시 업로드하거나 업로드 이력에서 선택하세요.");
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get("Content-Type") || "";
  const data = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const rawMessage = data?.error || data?.message || data || `요청 실패: ${response.status}`;
    let message = String(rawMessage);
    if (message.includes("FUNCTION_INVOCATION_TIMEOUT")) {
      message = "서버 응답이 중단되었습니다. 배정 chunk가 Vercel 제한보다 오래 걸렸습니다. 다시 시작하면 더 짧은 chunk로 이어서 탐색합니다.";
    }
    throw new Error(message);
  }
  return data;
}

async function restoreCurrentSchedule(activateTab = false) {
  const result = await api("/schedules/current");
  if (!result.ok || !result.scheduleResult?.selected?.schedule) {
    throw new Error(result.error || "현재 시간표를 불러오지 못했습니다. 자동배정을 먼저 실행하세요.");
  }
  rememberImportId(scheduleResultImportId(result.scheduleResult));
  applyScheduleResult(result.scheduleResult, "현재 시간표 복구 완료", { activateTab });
  return true;
}

async function ensureScheduleForManual() {
  getActiveImport();
  if (state.selectedCandidate?.schedule) return true;
  try {
    await restoreCurrentSchedule(false);
    return true;
  } catch (error) {
    setQuickEditStatus(error.message || "현재 시간표를 불러오지 못했습니다. 자동배정을 먼저 실행하세요.", "error");
    log(error.message);
    return false;
  }
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
  const keys = ["teacherCount", "classCount", "subjectCount", "roomCount", "fixedPeriodCount", "loadCount", "constraintCount", "syncBundleCount"];
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
  item = normalizeImport(item);
  state.currentImport = item;
  state.scheduleResult = null;
  state.selectedCandidate = null;
  if ((item?.id || null) !== previousImportId) {
    state.chatConstraints = [];
    state.pendingConstraintDrafts = [];
    renderChatConstraints();
  }
  if (item?.id) {
    storageSet(STORAGE_KEYS.importId, item.id);
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
  const issues = item.issues || [];
  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  els.currentTitle.textContent = item.fileName;
  els.currentSubtitle.textContent = `${item.createdAt} · 오류 ${errorCount}건 · 경고 ${warningCount}건`;
  updateSolveAvailability();
  els.reportLink.href = item.reportUrl || `/imports/${item.id}/report.xlsx`;
  els.reportLink.classList.remove("disabled");
  renderMetrics(item.stats);
  renderIssues(issues);
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
      const issues = Array.isArray(item.issues) ? item.issues : [];
      const errors = issues.filter((issue) => issue.severity === "error").length;
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
  state.imports = data.imports.map((item) => normalizeImport(item));
  renderImports();
  if (!state.currentImport && state.imports.length) {
    const storedId = storageGet(STORAGE_KEYS.importId);
    renderCurrentImport(state.imports.find((item) => item.id === storedId) || state.imports[0]);
  }
}

async function uploadWorkbook() {
  if (!state.selectedFile) return;
  els.uploadButton.disabled = true;
  els.uploadButton.textContent = "검증 중";
  setUploadStatus("엑셀 구조와 입력값을 검증하는 중입니다...", "", "", []);
  const form = new FormData();
  form.append("file", state.selectedFile);
  try {
    const result = await api("/imports/timetable-input", { method: "POST", body: form });
    const item = normalizeImport(result);
    const errors = item.issues.filter((issue) => issue.severity === "error");
    const warnings = item.issues.filter((issue) => issue.severity === "warning");
    state.imports = [item, ...state.imports.filter((existing) => existing.id !== item.id)];
    renderCurrentImport(item);
    if (item.ok) {
      setUploadStatus(`검증을 통과했습니다. 오류 0건, 경고 ${warnings.length}건입니다.`, "ok", "", []);
      setStartStep("constraints");
    } else {
      setUploadStatus(
        `검증 오류 ${errors.length}건, 경고 ${warnings.length}건입니다. 아래 항목을 고친 뒤 다시 업로드하세요.`,
        "error",
        item.reportUrl,
        item.issues
      );
      setStartStep("excel");
    }
    log(`엑셀 검증 완료: ${item.ok ? "통과" : `오류 ${errors.length}건`}`);
  } catch (error) {
    log(error.message);
    setUploadStatus(`업로드 요청 실패: ${error.message}`, "error", "", []);
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

renderDiagnostics = function renderDiagnosticsWithUnassigned(candidate = state.selectedCandidate) {
  const diagnostics = candidate?.diagnostics || [];
  const unassigned = candidate?.unassigned || [];
  if (!els.diagnosticPanel) return;
  if (!diagnostics.length && !unassigned.length) {
    els.diagnosticPanel.innerHTML = `<div class="diagnostic-row success"><strong>진단</strong><span>선택된 후보의 검증 진단이 없습니다.</span></div>`;
    return;
  }
  const unassignedHtml = unassigned
    .map((item) => `
      <div class="diagnostic-row error unassigned-card">
        <strong>미배정</strong>
        <span>${escapeHtml(item.teacherName || item.teacherCode || "-")} / ${escapeHtml(item.subjectName || item.subjectCode || "-")} / ${escapeHtml(item.className || item.classCode || "-")} ${escapeHtml(item.hours || 1)}시간</span>
        <small>${escapeHtml(item.reason || "")}</small>
      </div>
    `)
    .join("");
  const diagnosticHtml = diagnostics
    .slice(0, 8)
    .map((item) => `
      <div class="diagnostic-row ${escapeHtml(item.severity || "warning")}">
        <strong>${escapeHtml(item.type === "repair" ? "미배정 자동 보정 기록" : item.title || item.type || "진단")}</strong>
        <span>${escapeHtml(item.reason || "")}</span>
        <small>${escapeHtml(item.suggestion || "")}</small>
      </div>
    `)
    .join("");
  els.diagnosticPanel.innerHTML = `${unassignedHtml}${diagnosticHtml}`;
};

function renderTeacherIssues(candidate = state.selectedCandidate) {
  if (!els.teacherIssuePanel) return;
  const issues = [...(candidate?.teacherIssues || [])].sort((a, b) => String(a.teacherName || a.teacherCode || "").localeCompare(String(b.teacherName || b.teacherCode || ""), "ko"));
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

function countTable(rows = [], labelKey = "label") {
  if (!rows.length) return `<div class="empty-state compact">표시할 항목이 없습니다.</div>`;
  return `
    <table class="analysis-table">
      <thead><tr><th>항목</th><th>건수</th></tr></thead>
      <tbody>
        ${rows.map((item) => `<tr><td>${escapeHtml(item[labelKey] || "-")}</td><td>${escapeHtml(item.count ?? 0)}</td></tr>`).join("")}
      </tbody>
    </table>
  `;
}

function renderAnalysisSummary(summary = {}) {
  if (!els.analysisSummary) return;
  const stats = [
    ["미배정", summary.unassigned ?? "-"],
    ["검증오류", summary.errors ?? "-"],
    ["경고", summary.warnings ?? "-"],
    ["점수", summary.score ?? "-"],
  ];
  els.analysisSummary.innerHTML = stats
    .map(([label, value]) => `<div class="analysis-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
}

function renderUnassignedDashboard(data = {}) {
  if (!els.unassignedDashboard) return;
  const blockers = data.blockers || [];
  const items = data.items || [];
  els.unassignedDashboard.innerHTML = `
    <div class="analysis-list">
      <div class="analysis-row ${Number(data.total || 0) ? "error" : ""}">
        <strong>현재 미배정 ${escapeHtml(data.total ?? 0)}건</strong>
        <small>${blockers.map((item) => `${item.label} ${item.count}건`).join(" · ") || "미배정이 없습니다."}</small>
      </div>
      ${countTable(data.bySyncGroup || [])}
      ${items.slice(0, 8).map((item) => `
        <div class="analysis-row error">
          <strong>${escapeHtml(item.teacherName || item.teacherCode || "-")} / ${escapeHtml(item.subjectName || item.subjectCode || "-")}</strong>
          <small>${escapeHtml(item.className || item.classCode || "-")} · ${escapeHtml(item.reason || "")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderRiskDashboard(risk = {}) {
  if (!els.riskDashboard) return;
  const levelLabel = risk.level === "high" ? "높음" : risk.level === "medium" ? "주의" : "낮음";
  const rows = risk.tightClasses || [];
  els.riskDashboard.innerHTML = `
    <div class="analysis-list">
      <div class="analysis-row ${risk.level === "high" ? "error" : risk.level === "medium" ? "warning" : ""}">
        <strong>위험도 ${escapeHtml(levelLabel)}</strong>
        <small>${escapeHtml(risk.summary || "")}</small>
      </div>
      <table class="analysis-table">
        <thead><tr><th>학급</th><th>교과</th><th>고정</th><th>여유</th></tr></thead>
        <tbody>
          ${rows.slice(0, 12).map((row) => `<tr><td>${escapeHtml(row.className)}</td><td>${escapeHtml(row.loadHours)}</td><td>${escapeHtml(row.fixedHours)}</td><td>${escapeHtml(row.slack)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRelaxationSimulator(rows = []) {
  if (!els.relaxationSimulator) return;
  if (!rows.length) {
    els.relaxationSimulator.innerHTML = `<div class="empty-state compact">자동배정 후 완화 시뮬레이션이 표시됩니다.</div>`;
    return;
  }
  els.relaxationSimulator.innerHTML = `
    <table class="analysis-table">
      <thead><tr><th>조건</th><th>미배정</th><th>변화</th><th>오류</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.unassigned ?? "-")}</td>
            <td>${escapeHtml(row.delta > 0 ? `+${row.delta}` : row.delta ?? "-")}</td>
            <td>${escapeHtml(row.errors ?? row.error ?? "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderCandidateComparison(rows = []) {
  if (!els.candidateComparison) return;
  if (!rows.length) {
    els.candidateComparison.innerHTML = `<div class="empty-state compact">후보 시간표가 없습니다.</div>`;
    return;
  }
  els.candidateComparison.innerHTML = `
    <table class="analysis-table">
      <thead><tr><th>후보</th><th>미배정</th><th>오류</th><th>연강</th><th>식사</th><th>안배</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${row.selected ? "✓ " : ""}${escapeHtml(strategyName(row.strategy || `후보 ${row.index}`))}</td>
            <td>${escapeHtml(row.unassigned)}</td>
            <td>${escapeHtml(row.errors)}</td>
            <td>${escapeHtml(row.consecutive)}</td>
            <td>${escapeHtml(row.lunchShortage)}</td>
            <td>${escapeHtml(row.imbalance)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderSyncGroups(rows = []) {
  if (!els.syncGroupVisualization) return;
  if (!rows.length) {
    els.syncGroupVisualization.innerHTML = `<div class="empty-state compact">동시그룹이 없습니다.</div>`;
    return;
  }
  els.syncGroupVisualization.innerHTML = `
    <table class="analysis-table">
      <thead><tr><th>그룹</th><th>회차</th><th>배정</th><th>미배정</th><th>방식</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.syncGroup)}</td>
            <td>${escapeHtml(row.occurrenceCount)}회 · ${escapeHtml(row.laneCount)}학급</td>
            <td>${escapeHtml(row.placedCount)}</td>
            <td>${escapeHtml(row.unassigned)}</td>
            <td>${escapeHtml(row.arrangementMethod || "-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderManualRecommendations(rows = []) {
  if (!els.manualRecommendations) return;
  if (!rows.length) {
    els.manualRecommendations.innerHTML = `<div class="empty-state compact">미배정이 없거나 추천할 항목이 없습니다.</div>`;
    return;
  }
  els.manualRecommendations.innerHTML = `
    <div class="analysis-list">
      ${rows.map((row) => `
        <div class="analysis-row ${row.type === "blocked" || row.type === "sync" ? "warning" : ""}">
          <strong>${escapeHtml(row.title)}</strong>
          <small>${escapeHtml(row.message)}</small>
          ${(row.options || []).length ? `<small>${row.options.map((item) => item.label).join(" · ")}</small>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function renderNeisPrecheck(neis = {}) {
  if (!els.neisPrecheck) return;
  const issues = neis.issues || [];
  els.neisPrecheck.innerHTML = `
    <div class="analysis-list">
      <div class="analysis-row ${neis.ok ? "" : "warning"}">
        <strong>${escapeHtml(neis.summary || "NEIS 사전검증")}</strong>
        <small>${neis.ok ? "내보내기 전 큰 차단 요소가 없습니다." : "아래 항목을 확인하세요."}</small>
      </div>
      ${issues.slice(0, 12).map((item) => `<div class="analysis-row ${item.severity === "error" ? "error" : "warning"}"><small>${escapeHtml(item.message)}</small></div>`).join("")}
    </div>
  `;
}

function renderScenarios(rows = []) {
  if (!els.scenarioList) return;
  if (!rows.length) {
    els.scenarioList.innerHTML = `<div class="empty-state compact">저장된 시나리오가 없습니다.</div>`;
    return;
  }
  els.scenarioList.innerHTML = `
    <div class="analysis-list">
      ${rows.map((row) => `
        <button class="analysis-row" type="button" data-load-scenario="${escapeHtml(row.id)}">
          <strong>${escapeHtml(row.name || row.id)}</strong>
          <small>미배정 ${escapeHtml(row.unassigned)} · 오류 ${escapeHtml(row.errors)} · ${escapeHtml(row.createdAt || "")}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function renderSolveQueue(queue = {}) {
  if (!els.solveQueuePanel) return;
  els.solveQueuePanel.innerHTML = `
    <div class="analysis-list">
      <div class="analysis-row ${state.solveInProgress ? "warning" : ""}">
        <strong>${state.solveInProgress ? "탐색 진행 중" : "대기 중"}</strong>
        <small>${escapeHtml(queue.message || "진행형 탐색 큐가 준비되어 있습니다.")}</small>
        <small>세션 ${escapeHtml(queue.lastSession || state.solveSessionId || "-")} · chunk ${escapeHtml(queue.chunkCount || 0)} · 후보 ${escapeHtml(queue.attemptCount || 0)}</small>
      </div>
    </div>
  `;
}

function renderInsights(data = state.insights) {
  if (!data) {
    renderAnalysisSummary({});
    for (const node of [els.unassignedDashboard, els.riskDashboard, els.relaxationSimulator, els.candidateComparison, els.syncGroupVisualization, els.manualRecommendations, els.neisPrecheck, els.scenarioList, els.solveQueuePanel]) {
      if (node) node.innerHTML = `<div class="empty-state compact">자동배정 후 분석이 표시됩니다.</div>`;
    }
    return;
  }
  state.insights = data;
  state.scenarios = data.scenarios || state.scenarios || [];
  renderAnalysisSummary(data.summary || {});
  renderUnassignedDashboard(data.unassigned || {});
  renderRiskDashboard(data.risk || {});
  renderRelaxationSimulator(data.relaxationSimulations || []);
  renderCandidateComparison(data.candidateComparison || []);
  renderSyncGroups(data.syncGroups || []);
  renderManualRecommendations(data.manualRecommendations || []);
  renderNeisPrecheck(data.neis || {});
  renderScenarios(state.scenarios);
  renderSolveQueue(data.queue || {});
}

async function loadInsights(includeSimulation = true) {
  if (!state.scheduleResult && !state.selectedCandidate) {
    renderInsights(null);
    return null;
  }
  const data = await api("/schedules/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...requestBasePayload(),
      scheduleResult: state.scheduleResult,
      candidate: state.selectedCandidate,
      includeSimulation,
    }),
  });
  renderInsights(data);
  return data;
}

async function saveCurrentScenario() {
  if (!state.scheduleResult?.selected) {
    log("저장할 시간표가 없습니다.");
    return;
  }
  const name = els.scenarioName?.value.trim() || `시나리오 ${new Date().toLocaleString("ko-KR")}`;
  const result = await api("/scenarios/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...requestBasePayload(),
      name,
      scheduleResult: state.scheduleResult,
    }),
  });
  state.scenarios = result.scenarios || [];
  renderScenarios(state.scenarios);
  log(`시나리오 저장: ${result.scenario?.name || name}`);
}

async function loadScenario(scenarioId) {
  const result = await api("/scenarios/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenarioId, apply: true }),
  });
  if (result.scheduleResult) {
    applyScheduleResult(result.scheduleResult, `시나리오 불러오기: ${result.scenario?.name || scenarioId}`);
    setActiveTab("timetable");
  }
}

function applyScheduleResult(result, message = "시간표 반영 완료", options = {}) {
  const activateTab = options.activateTab !== false;
  rememberImportId(scheduleResultImportId(result));
  state.scheduleResult = result;
  state.selectedCandidate = result.selected;
  clearQuickMove("수업 칸 선택", false);
  renderCandidates(result.candidates, result.selected.strategy);
  renderSchedule(result.selected.schedule);
  renderDiagnostics(result.selected);
  renderTeacherIssues(result.selected);
  setExportsEnabled(true);
  if (activateTab) setActiveTab("timetable");
  completeSetup();
  log(message);
  loadInsights(true).catch((error) => log(error.message));
}

function openSolvePreferences(context = "workspace") {
  if (state.solveInProgress) return;
  state.solveLaunchContext = context;
  if (els.solvePreferenceModal?.showModal) {
    els.solvePreferenceModal.showModal();
  } else {
    els.solvePreferenceModal?.classList.remove("hidden");
    els.solvePreferenceModal?.setAttribute("open", "open");
  }
}

function closeSolvePreferences() {
  if (els.solvePreferenceModal?.close) {
    els.solvePreferenceModal.close();
  } else {
    els.solvePreferenceModal?.classList.add("hidden");
    els.solvePreferenceModal?.removeAttribute("open");
  }
}

function showSolveProgress(context) {
  els.solveFailureBox?.classList.add("hidden");
  if (els.solveFailureMessage) els.solveFailureMessage.textContent = "";
  state.solveStartedAt = Date.now();
  state.solveAcceptVisible = false;
  state.solveAcceptRequested = false;
  renderSolveProgress({ progressMessage: "탐색을 시작하고 있습니다.", bestSummary: null, canAccept: false }, context);
  if (context === "setup") {
    setStartStep("solving");
  } else {
    els.solveOverlay?.classList.remove("hidden");
  }
}

function hideSolveProgress() {
  els.solveOverlay?.classList.add("hidden");
  els.acceptBestSolveButton?.classList.add("hidden");
  els.acceptBestSolveOverlayButton?.classList.add("hidden");
}

function showSolveFailure(error, context, options = {}) {
  const message = error?.message || "자동배정 요청을 처리하지 못했습니다.";
  if (context === "setup" && !state.setupComplete) {
    setStartStep("solving");
    els.solveFailureBox?.classList.remove("hidden");
    if (els.solveFailureMessage) els.solveFailureMessage.textContent = message;
  } else {
    els.solveOverlay?.classList.remove("hidden");
    const prefix = options.keepProgress ? "현재 최선안 반영 실패" : "자동배정 실패";
    for (const node of [els.solveProgressMessage, els.solveOverlayProgressMessage]) {
      if (node) node.textContent = `${prefix}: ${message}`;
    }
    const failureStats = `<div class="diagnostic-row error"><strong>요청이 끊겼습니다</strong><span>${escapeHtml(message)}</span><small>최근 오류 로그를 확인하거나 자동배정을 다시 시작하세요.</small></div>`;
    for (const node of [els.solveProgressStats, els.solveOverlayProgressStats]) {
      if (node && !options.keepProgress) node.innerHTML = failureStats;
    }
    appendChat("assistant", `자동배정 요청 실패: ${message}`);
  }
  log(message);
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function progressSummaryText(summary = {}) {
  if (!summary || !Object.keys(summary).length) return "-";
  return `미배정 ${summary.unassigned ?? "-"} / 오류 ${summary.errors ?? "-"}`;
}

function formatProgressTime(value) {
  if (!value) return "-";
  const text = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text) ? `${text}Z` : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function progressChips(items = []) {
  return (items || [])
    .slice(0, 6)
    .map((item) => `<span class="solve-profile-chip">${escapeHtml(item)}</span>`)
    .join("");
}

function blockerChips(blockers = []) {
  return (blockers || [])
    .slice(0, 4)
    .map((item) => `<span class="solve-profile-chip warn">${escapeHtml(item.label || item.type)} ${escapeHtml(item.count ?? "")}</span>`)
    .join("");
}

function solveProgressStatsHtml(progress = {}) {
  const summary = progress.bestSummary || {};
  const last = progress.lastResultSummary || {};
  const stats = [
    ["미배정", summary.unassigned ?? "-"],
    ["식사부족", summary.lunchShortage ?? "-"],
    ["연강", summary.consecutive ?? "-"],
    ["안배부족", summary.imbalance ?? "-"],
  ];
  const statCards = stats
    .map(([label, value]) => `<div class="solve-progress-stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`)
    .join("");
  const changedText = progress.bestChanged ? "방금 개선됨" : `다른 후보 탐색 중${Number(progress.stagnationCount || 0) ? ` · 정체 ${progress.stagnationCount}회` : ""}`;
  const profiles = progressChips(progress.activeProfiles || []);
  const blockers = blockerChips(progress.structuralBlockers || []);
  const aiSummary = progress.aiRepairAdvice?.summary ? `<div class="solve-progress-row"><span>AI 원인분석</span><strong>${escapeHtml(progress.aiRepairAdvice.summary)}</strong></div>` : "";
  return `
    ${statCards}
    <div class="solve-progress-details">
      <div class="solve-progress-row"><span>탐색 회차</span><strong>${escapeHtml(progress.chunkCount ?? "-")}</strong></div>
      <div class="solve-progress-row"><span>시도 후보 수</span><strong>${escapeHtml(progress.attemptCount ?? "-")}</strong></div>
      <div class="solve-progress-row"><span>마지막 후보</span><strong>${escapeHtml(progressSummaryText(last))}</strong></div>
      <div class="solve-progress-row"><span>현재 최선안</span><strong>${escapeHtml(progressSummaryText(summary))}</strong></div>
      <div class="solve-progress-row"><span>최선안 변경</span><strong>${escapeHtml(changedText)}</strong></div>
      <div class="solve-progress-row"><span>마지막 변경</span><strong>${escapeHtml(formatProgressTime(progress.bestChangedAt))}</strong></div>
      <div class="solve-progress-row"><span>CP 단계</span><strong>${escapeHtml(progress.phase || progress.searchStats?.phase || "-")}</strong></div>
      <div class="solve-progress-row"><span>CP 상태</span><strong>${escapeHtml(progress.cpStatus || progress.searchStats?.cpStatus || "-")}</strong></div>
      <div class="solve-progress-row"><span>병목 수업</span><strong>${escapeHtml(progress.bottleneckCount ?? progress.searchStats?.bottleneckCount ?? "-")}</strong></div>
      <div class="solve-progress-row"><span>안전 변이</span><strong>${escapeHtml(progress.hardSafeMutationCount ?? progress.searchStats?.hardSafeMutationCount ?? "-")}</strong></div>
      <div class="solve-progress-row"><span>탐색 모드</span><strong>${escapeHtml(progress.repairMode || "constraint")}</strong></div>
      ${profiles ? `<div class="solve-progress-row wide"><span>활성 프로필</span><div>${profiles}</div></div>` : ""}
      ${blockers ? `<div class="solve-progress-row wide"><span>미배정 원인</span><div>${blockers}</div></div>` : ""}
      ${aiSummary}
    </div>
  `;
}

function renderSolveProgress(progress = {}, context = "workspace") {
  const elapsed = Date.now() - (state.solveStartedAt || Date.now());
  const canShowAccept = Boolean(progress.canAccept) && elapsed >= 20000;
  state.solveAcceptVisible = canShowAccept;
  const message = progress.progressMessage || "탐색을 계속 진행 중입니다.";
  const statsHtml = solveProgressStatsHtml(progress || {});
  for (const node of [els.solveProgressMessage, els.solveOverlayProgressMessage]) {
    if (node) node.textContent = message;
  }
  for (const node of [els.solveProgressStats, els.solveOverlayProgressStats]) {
    if (node) node.innerHTML = statsHtml;
  }
  for (const button of [els.acceptBestSolveButton, els.acceptBestSolveOverlayButton]) {
    if (button) button.classList.toggle("hidden", !canShowAccept);
  }
}

function setAcceptButtonsBusy(isBusy) {
  for (const button of [els.acceptBestSolveButton, els.acceptBestSolveOverlayButton]) {
    if (!button) continue;
    button.disabled = isBusy;
    button.textContent = isBusy ? "반영 중" : "현재 최선안 사용";
  }
}

async function acceptBestSolveNow(context = state.solveLaunchContext || "workspace") {
  if (state.solveAcceptInProgress) return state.solveAcceptedResult;
  if (!state.solveSessionId) {
    showSolveFailure(new Error("진행 중인 자동배정 세션을 찾을 수 없습니다."), context);
    return null;
  }
  state.solveAcceptRequested = true;
  state.solveAcceptInProgress = true;
  setAcceptButtonsBusy(true);
  for (const node of [els.solveProgressMessage, els.solveOverlayProgressMessage]) {
    if (node) node.textContent = "현재 최선안을 반영하는 중입니다.";
  }
  try {
    const result = await api("/schedules/solve/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: state.solveSessionId }),
    });
    state.solveAcceptedResult = result;
    state.solveInProgress = false;
    applyScheduleResult(result, `자동배정 완료: ${strategyName(result.bestStrategy)} 선택`);
    if (result.progressMessage) log(result.progressMessage);
    hideSolveProgress();
    return result;
  } catch (error) {
    state.solveAcceptRequested = false;
    showSolveFailure(error, context, { keepProgress: true });
    return null;
  } finally {
    state.solveAcceptInProgress = false;
    setAcceptButtonsBusy(false);
  }
}

function requestAcceptBestSolve() {
  acceptBestSolveNow().catch((error) => showSolveFailure(error, state.solveLaunchContext || "workspace"));
}

function perfectEnough(summary = {}) {
  return Number(summary.unassigned || 0) === 0 && Number(summary.errors || 0) === 0;
}

async function solveSchedule(context = "workspace") {
  if (state.solveInProgress) return false;
  getActiveImport();
  let hadError = false;
  state.solveInProgress = true;
  state.solveSessionId = "";
  state.solveAcceptedResult = null;
  state.solveAcceptInProgress = false;
  els.solveButton.disabled = true;
  els.solveButton.textContent = "배정 중";
  if (els.startSolveButton) els.startSolveButton.disabled = true;
  if (els.solvePreferenceConfirm) els.solvePreferenceConfirm.disabled = true;
  showSolveProgress(context);
  updateSolveAvailability();
  try {
    const basePayload = {
      ...(await requestBasePayloadForSolve()),
      aiConfig: getAiConfig(),
      apiValidated: state.apiValidated,
      solveOptions: getSolveOptions(),
    };
    let progress = await api("/schedules/solve/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(basePayload),
    });
    state.solveSessionId = progress.sessionId || "";
    renderSolveProgress(progress, context);
    while (state.solveInProgress && !state.solveAcceptRequested) {
      if (progress.canAccept && perfectEnough(progress.bestSummary)) {
        await acceptBestSolveNow(context);
        break;
      }
      await sleep(700);
      if (state.solveAcceptRequested) break;
      progress = await api("/schedules/solve/continue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...basePayload, sessionId: state.solveSessionId }),
      });
      if (state.solveAcceptedResult) break;
      renderSolveProgress(progress, context);
    }
    const result = state.solveAcceptedResult || await acceptBestSolveNow(context);
    if (!result) return false;
    if (result.progressMessage) log(result.progressMessage);
    if (result.aiAdvisor?.advice) {
      const advice = result.aiAdvisor.advice;
      const remote = result.aiAdvisor.remote || {};
      const lines = [];
      if (remote.ok) {
        lines.push(`[원격 AI 응답] ${remote.provider || "AI"} ${remote.model || ""}`.trim());
      } else if (getAiConfig().apiKey) {
        lines.push(`[원격 AI 실패] ${remote.provider || providerLabel()} ${remote.status || ""}: ${remote.message || "응답을 받지 못했습니다."}`);
        lines.push("[보조 진단]");
      }
      lines.push(advice.summary);
      lines.push(...(advice.suggestions || []).map((item) => `${item.title}: ${(item.steps || []).join(" → ") || item.explanation}`));
      appendChat("assistant", `AI 자동배정 검토\n${lines.filter(Boolean).join("\n")}`, remote.ok ? { responseId: remote.responseId, model: remote.model } : null);
    }
    return true;
  } catch (error) {
    hadError = true;
    showSolveFailure(error, context);
    return false;
  } finally {
    state.solveInProgress = false;
    state.solveSessionId = "";
    state.solveAcceptVisible = false;
    state.solveAcceptRequested = false;
    state.solveAcceptInProgress = false;
    state.solveAcceptedResult = null;
    setAcceptButtonsBusy(false);
    els.solveButton.textContent = "▶ AI 자동배정";
    if (els.startSolveButton) els.startSolveButton.disabled = false;
    if (els.solvePreferenceConfirm) els.solvePreferenceConfirm.disabled = false;
    if (!hadError && !(context === "setup" && !state.setupComplete)) hideSolveProgress();
    updateSolveAvailability();
  }
}

async function solveScheduleFromSetup() {
  openSolvePreferences("setup");
}

async function confirmSolvePreferences() {
  const context = state.solveLaunchContext || "workspace";
  closeSolvePreferences();
  await solveSchedule(context);
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
        teachers[cell.teacherCode].grid[day][String(period)].push({
          ...cell,
          classCode,
          className: classData.name || classCode,
          day,
          period: Number(period),
        });
      }
    }
  }
  return Object.fromEntries(
    Object.entries(teachers).sort((a, b) => String(a[1].name || a[0]).localeCompare(String(b[1].name || b[0]), "ko"))
  );
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
          const sourceClassCode = mode === "teacher" ? cell?.classCode : entityCode;
          const option = findQuickMoveOption(day, period);
          const cellClasses = [];
          if (sourceClassCode && isQuickMoveSource(sourceClassCode, day, period)) cellClasses.push("quick-source");
          if (option) cellClasses.push("quick-option", `quick-${option.grade || "ok"}`);
          const attrs = sourceClassCode || option
            ? `data-day="${escapeHtml(day)}" data-period="${period}" data-class-code="${escapeHtml(sourceClassCode || state.quickMoveSource?.classCode || "")}" data-teacher-code="${escapeHtml(mode === "teacher" ? entityCode : cell?.teacherCode || "")}" data-has-cell="${cell ? "1" : "0"}" data-source="${escapeHtml(cell?.source || "")}"`
            : "";
          const note = option ? `<div class="move-option-note">${escapeHtml(option.grade === "good" ? "좋음" : option.grade === "warn" ? "주의" : option.grade === "bad" ? "불가" : "가능")}</div>` : "";
          return `<td class="${cellClasses.join(" ")}" ${attrs}>${renderCellContent(cell, mode)}${note}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(day)}</th>${cells}</tr>`;
    })
    .join("");
  els.scheduleBoard.innerHTML = `<table class="schedule-table">${header}${rows}</table>`;
}

drawSelectedSchedule = function drawSelectedSchedulePeriodRows() {
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
  const days = schedule.days || [];
  const periods = schedule.periods || [];
  const header = `<tr><th>교시</th>${days.map((day) => `<th>${escapeHtml(day)}</th>`).join("")}</tr>`;
  const rows = periods
    .map((period) => {
      const cells = days
        .map((day) => {
          const dayLimit = Number(entityData.dayLimits?.[day] ?? periods.length);
          if (mode === "class" && period > dayLimit) {
            return `<td class="unavailable"><div class="schedule-cell unavailable"><small>수업 없음</small></div></td>`;
          }
          const raw = entityData.grid?.[day]?.[String(period)];
          const cell = Array.isArray(raw) ? raw[0] : raw;
          const sourceClassCode = mode === "teacher" ? (cell?.classCode || state.quickMoveSource?.classCode || "") : entityCode;
          const option = findQuickMoveOption(day, period);
          const cellClasses = [];
          if (sourceClassCode && isQuickMoveSource(sourceClassCode, day, period)) cellClasses.push("quick-source");
          if (option) cellClasses.push("quick-option", `quick-${option.grade || "ok"}`);
          const attrs = sourceClassCode || option
            ? `data-day="${escapeHtml(day)}" data-period="${period}" data-class-code="${escapeHtml(sourceClassCode || "")}" data-teacher-code="${escapeHtml(mode === "teacher" ? entityCode : cell?.teacherCode || "")}" data-has-cell="${cell ? "1" : "0"}" data-source="${escapeHtml(cell?.source || "")}"`
            : "";
          const note = option ? `<div class="move-option-note">${escapeHtml(option.grade === "good" ? "좋음" : option.grade === "warn" ? "주의" : option.grade === "bad" ? "불가" : "가능")}</div>` : "";
          return `<td class="${cellClasses.join(" ")}" ${attrs}>${renderCellContent(cell, mode)}${note}</td>`;
        })
        .join("");
      return `<tr><th>${escapeHtml(period)}교시</th>${cells}</tr>`;
    })
    .join("");
  els.scheduleBoard.innerHTML = `<table class="schedule-table">${header}${rows}</table>`;
};

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
    Object.keys(schedule.classes || {}).sort((a, b) => String(schedule.classes[a].name || a).localeCompare(String(schedule.classes[b].name || b), "ko")),
    (classCode) => schedule.classes[classCode].name || classCode
  );
  fillSelect(els.moveFromDay, schedule.days || []);
  fillSelect(els.moveToDay, schedule.days || []);
}

async function handleScheduleCellClick(event) {
  const cell = event.target.closest("td[data-day]");
  if (!cell || cell.dataset.source === "fixed") return;
  const quickOption = state.quickMoveActive ? findQuickMoveOption(cell.dataset.day, Number(cell.dataset.period)) : null;
  if (quickOption) {
    await applyQuickMoveOption(quickOption);
    return;
  }
  if (!cell.dataset.classCode) {
    setQuickEditStatus("교사표의 빈 칸은 수업을 선택한 뒤 후보로 사용할 수 있습니다.", "error");
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
  if (!state.quickMoveSource) {
    setQuickEditStatus("이동할 수업 칸을 먼저 선택하세요.", "error");
    return;
  }
  const source = { ...state.quickMoveSource };
  if (!(await ensureScheduleForManual())) return;
  state.quickMoveSource = source;
  setQuickEditStatus("이동 후보 계산 중");
  try {
    const result = await api("/schedules/move-options", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        schedule: state.selectedCandidate.schedule,
        from: source,
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
  if (!(await ensureScheduleForManual())) return;
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
        recordSignature: state.scheduleResult?.recordSignature || "",
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
    loadInsights(false).catch((error) => log(error.message));
  } catch (error) {
    log(error.message);
    alert(error.message);
  }
}

function closeChangePreview() {
  state.pendingMovePreview = null;
  state.pendingScheduleProposal = null;
  state.pendingPreviewKind = "";
  if (els.changePreviewModal?.close) {
    els.changePreviewModal.close();
  } else {
    els.changePreviewModal?.classList.add("hidden");
    els.changePreviewModal?.removeAttribute("open");
  }
}

function cellKey(cell) {
  return `${cell.day}::${Number(cell.period)}`;
}

function collectTeacherCells(schedule, teacherCode) {
  const cells = [];
  for (const [classCode, classData] of Object.entries(schedule?.classes || {})) {
    for (const day of schedule?.days || []) {
      for (const period of schedule?.periods || []) {
        const cell = classData.grid?.[day]?.[String(period)];
        if (!cell || cell.teacherCode !== teacherCode) continue;
        cells.push({
          classCode,
          className: classData.name || classCode,
          day,
          period: Number(period),
          subjectName: cell.subjectName || cell.subjectCode || "",
          label: `${cell.subjectName || cell.subjectCode || ""} ${classData.name || classCode}`.trim(),
        });
      }
    }
  }
  return cells;
}

function collectTeacherNames(schedule) {
  const names = {};
  for (const classData of Object.values(schedule?.classes || {})) {
    for (const day of schedule?.days || []) {
      for (const period of schedule?.periods || []) {
        const cell = classData.grid?.[day]?.[String(period)];
        if (cell?.teacherCode) names[cell.teacherCode] = cell.teacherName || cell.teacherCode;
      }
    }
  }
  return names;
}

function buildProposalPreview(scheduleResult) {
  const beforeSchedule = state.selectedCandidate?.schedule || null;
  const afterSchedule = scheduleResult?.selected?.schedule || null;
  if (!beforeSchedule || !afterSchedule) {
    return {
      message: "AI가 시간표 변경안을 만들었습니다. 승인하면 현재 후보 시간표로 반영됩니다.",
      affectedTeachers: [],
    };
  }
  const names = { ...collectTeacherNames(beforeSchedule), ...collectTeacherNames(afterSchedule) };
  const teacherCodes = new Set(Object.keys(names));
  const affectedTeachers = [];
  for (const teacherCode of teacherCodes) {
    const beforeCells = collectTeacherCells(beforeSchedule, teacherCode);
    const afterCells = collectTeacherCells(afterSchedule, teacherCode);
    const beforeSig = JSON.stringify(beforeCells.map((item) => `${cellKey(item)}:${item.label}`).sort());
    const afterSig = JSON.stringify(afterCells.map((item) => `${cellKey(item)}:${item.label}`).sort());
    if (beforeSig !== afterSig) {
      affectedTeachers.push({
        teacherCode,
        teacherName: names[teacherCode] || teacherCode,
        beforeCells,
        afterCells,
      });
    }
  }
  return {
    message: `AI 변경안입니다. 영향 교사 ${affectedTeachers.length}명, 승인 후 적용됩니다.`,
    affectedTeachers: affectedTeachers
      .sort((a, b) => String(a.teacherName || a.teacherCode || "").localeCompare(String(b.teacherName || b.teacherCode || ""), "ko"))
      .slice(0, 8),
  };
}

function renderPreviewTable(cells = [], changedKeys = new Set()) {
  const schedule = state.selectedCandidate?.schedule;
  const days = schedule?.days || ["월", "화", "수", "목", "금"];
  const periods = schedule?.periods || [1, 2, 3, 4, 5, 6, 7];
  const byKey = new Map(cells.map((cell) => [cellKey(cell), cell]));
  const header = `<tr><th>교시</th>${days.map((day) => `<th>${escapeHtml(day)}</th>`).join("")}</tr>`;
  const rows = periods
    .map((period) => {
      const tds = days
        .map((day) => {
          const key = `${day}::${Number(period)}`;
          const cell = byKey.get(key);
          const changed = changedKeys.has(key) ? "changed" : "";
          return `<td class="${changed}">${escapeHtml(cell?.label || "")}</td>`;
        })
        .join("");
      return `<tr><th>${period}</th>${tds}</tr>`;
    })
    .join("");
  return `<table class="preview-table">${header}${rows}</table>`;
}

function renderAffectedTeachers(teachers = []) {
  if (!teachers.length) {
    return `<div class="empty-state compact">비교할 교사 변경 내역이 없습니다. 승인하면 후보 시간표가 반영됩니다.</div>`;
  }
  return `<div class="preview-teacher-grid">${[...teachers]
    .sort((a, b) => String(a.teacherName || a.teacherCode || "").localeCompare(String(b.teacherName || b.teacherCode || ""), "ko"))
    .map((teacher) => {
      const beforeMap = new Map((teacher.beforeCells || []).map((cell) => [cellKey(cell), cell.label]));
      const afterMap = new Map((teacher.afterCells || []).map((cell) => [cellKey(cell), cell.label]));
      const keys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
      const changedKeys = new Set([...keys].filter((key) => beforeMap.get(key) !== afterMap.get(key)));
      return `
        <div class="preview-teacher">
          <strong>${escapeHtml(teacher.teacherName || teacher.teacherCode)}</strong>
          <span class="status-line">수정 전</span>
          ${renderPreviewTable(teacher.beforeCells || [], changedKeys)}
          <span class="status-line">수정 후</span>
          ${renderPreviewTable(teacher.afterCells || [], changedKeys)}
        </div>
      `;
    })
    .join("")}</div>`;
}

function openChangePreview({ title, preview, kind, proposal = null }) {
  state.pendingPreviewKind = kind;
  if (kind === "proposal") state.pendingScheduleProposal = proposal;
  const validation = preview?.validation || {};
  const errors = (validation.violations || []).filter((item) => item.severity === "error").length;
  const summary = `
    <div class="preview-summary">
      <strong>${escapeHtml(preview?.message || "변경안을 확인하세요.")}</strong>
      <span>검증 오류 ${errors}건 · 승인 전에는 시간표에 저장되지 않습니다.</span>
    </div>
  `;
  els.changePreviewTitle.textContent = title || "변경 미리보기";
  els.changePreviewBody.innerHTML = `${summary}${renderAffectedTeachers(preview?.affectedTeachers || [])}`;
  if (els.changePreviewModal?.showModal) {
    els.changePreviewModal.showModal();
  } else {
    els.changePreviewModal?.classList.remove("hidden");
    els.changePreviewModal?.setAttribute("open", "open");
  }
}

async function previewManualMove(move) {
  if (!(await ensureScheduleForManual())) return;
  setQuickEditStatus("변경 미리보기 계산 중");
  try {
    const preview = await api("/schedules/move-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        schedule: state.selectedCandidate.schedule,
        move,
      }),
    });
    state.pendingMovePreview = { move, preview };
    openChangePreview({ title: "수동수정 미리보기", preview, kind: "manual" });
    setQuickEditStatus("미리보기를 확인하고 승인하세요", preview.ok ? "ok" : "error");
  } catch (error) {
    setQuickEditStatus(error.message, "error");
    log(error.message);
  }
}

async function confirmChangePreview() {
  if (state.pendingPreviewKind === "proposal" && state.pendingScheduleProposal) {
    try {
      const result = await api("/schedules/proposals/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestBasePayload(),
          proposal: state.pendingScheduleProposal,
        }),
      });
      if (result.scheduleResult) {
        applyScheduleResult(result.scheduleResult, "AI 변경안을 승인 적용했습니다.");
        appendChat("assistant", "승인한 AI 변경안을 시간표에 반영했습니다.");
      }
      closeChangePreview();
    } catch (error) {
      log(error.message);
      alert(error.message);
    }
    return;
  }
  if (state.pendingMovePreview?.move) {
    const move = state.pendingMovePreview.move;
    closeChangePreview();
    await submitManualMove(move);
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
  await previewManualMove(move);
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
  await previewManualMove(move);
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
  if (item.engineSupported === false) {
    return `${item.description || item.rawText || "메모형 제약"} · 메모형 제약, 엔진 미반영`;
  }
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
    "rawText",
    "description",
    "engineSupported",
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
      <div class="constraint-draft pending ${item.engineSupported === false ? "memo" : ""}">
        <span>${escapeHtml(constraintLabel(item))}</span>
        <button class="mini-button ${item.engineSupported === false ? "ghost" : ""}" type="button" data-apply-constraint="${index}">${item.engineSupported === false ? "메모" : "적용"}</button>
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

async function applyConstraintDraft(index) {
  const draft = state.pendingConstraintDrafts[index];
  if (!draft) return;
  if (!state.chatConstraints.some((item) => sameConstraint(item, draft))) {
    state.chatConstraints.push(draft);
  }
  state.pendingConstraintDrafts.splice(index, 1);
  renderChatConstraints();
  updateSolveAvailability();
  if (draft.engineSupported === false) {
    log(`메모형 제약 저장: ${constraintLabel(draft)}`);
    appendChat("assistant", `이 조건은 메모형으로 저장했습니다. 아직 배정 엔진에는 직접 반영되지 않습니다.\n${constraintLabel(draft)}`);
    return;
  }
  log(`대화 제약 적용: ${constraintLabel(draft)}`);
  if (state.selectedCandidate) {
    appendChat("assistant", `제약조건을 적용했습니다. ${constraintLabel(draft)} 조건으로 다시 배정합니다.`);
    await solveSchedule();
  }
}

function removeChatConstraint(index) {
  const removed = state.chatConstraints.splice(index, 1)[0];
  renderChatConstraints();
  if (removed) log(`대화 제약 해제: ${constraintLabel(removed)}`);
}

async function createInitialConstraintDraft() {
  const message = els.initialConstraintText?.value.trim() || "";
  if (!message) {
    setStartStep("preferences");
    return;
  }
  if (els.initialConstraintButton) els.initialConstraintButton.disabled = true;
  if (els.initialConstraintStatus) els.initialConstraintStatus.textContent = "AI 제약 초안 생성 중";
  try {
    const response = await api("/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...requestBasePayload(),
        message,
        aiConfig: getAiConfig(),
        apiValidated: state.apiValidated,
        solveOptions: getSolveOptions(),
      }),
    });
    if (response.constraintDrafts?.length) {
      state.pendingConstraintDrafts = response.constraintDrafts;
      renderChatConstraints();
      appendChat("assistant", "시작 단계에서 입력한 조건으로 AI 제약 초안을 만들었습니다. 오른쪽 목록에서 적용할 수 있습니다.");
      if (els.initialConstraintStatus) els.initialConstraintStatus.textContent = `제약 초안 ${response.constraintDrafts.length}개 생성`;
    } else if (els.initialConstraintStatus) {
      els.initialConstraintStatus.textContent = "적용 가능한 제약 초안을 찾지 못했습니다. 선호도 설정으로 이동합니다.";
    }
    setStartStep("preferences");
  } catch (error) {
    if (els.initialConstraintStatus) els.initialConstraintStatus.textContent = error.message;
    log(error.message);
  } finally {
    if (els.initialConstraintButton) els.initialConstraintButton.disabled = false;
  }
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
        solveOptions: getSolveOptions(),
      }),
    });
    const suggestionText = (response.suggestions || [])
      .map((item) => {
        const body = item.explanation || (item.steps ? item.steps.join(" → ") : JSON.stringify(item.draft));
        return `${item.title}: ${body}`;
      })
      .join("\n");
    const lines = [response.privacy];
    if (response.remote?.ok) {
      lines.push(`[원격 AI 응답] ${response.remote.provider || "AI"} ${response.remote.model || ""}`.trim());
    } else if (response.remoteFailure) {
      const remote = response.remoteFailure;
      lines.push(`[원격 AI 실패] ${remote.provider || "AI"} ${remote.status || ""}: ${remote.message || "응답을 받지 못했습니다."}`);
    }
    if (response.advice?.summary) lines.push(response.advice.summary);
    if (suggestionText) lines.push(suggestionText);
    if (response.remoteFailure && response.localAdvice?.summary && response.localAdvice.summary !== response.advice?.summary) {
      lines.push(`[보조 진단] ${response.localAdvice.summary}`);
      const localText = (response.localAdvice.suggestions || [])
        .map((item) => `${item.title}: ${item.explanation || (item.steps || []).join(" → ")}`)
        .join("\n");
      if (localText) lines.push(localText);
    }
    appendChat("assistant", lines.filter(Boolean).join("\n"), response.maskedPayload);
    if (response.constraintDrafts?.length) {
      state.pendingConstraintDrafts = response.constraintDrafts;
      renderChatConstraints();
      setActiveTab("diagnostics");
    }
    if (response.scheduleProposal?.scheduleResult) {
      const proposal = response.scheduleProposal;
      const preview = buildProposalPreview(proposal.scheduleResult);
      if (proposal.message) preview.message = proposal.message;
      openChangePreview({ title: "AI 변경안 미리보기", preview, kind: "proposal", proposal });
      appendChat("assistant", "AI 변경안을 만들었습니다. 변경 미리보기에서 승인하면 시간표에 반영됩니다.");
    }
    log("AI 제안 생성 완료");
  } catch (error) {
    appendChat("assistant", error.message);
    log(error.message);
  } finally {
    els.chatButton.disabled = false;
  }
}

function chatRequestPayload(message) {
  return {
    ...requestBasePayload(),
    message,
    aiConfig: getAiConfig(),
    apiValidated: state.apiValidated,
    schedule: state.selectedCandidate?.schedule || null,
    unassigned: state.selectedCandidate?.unassigned || [],
    effectiveConfig: state.selectedCandidate?.effectiveConfig || null,
    solveOptions: getSolveOptions(),
  };
}

function showChatPending(message = "AI가 답변을 준비하고 있습니다.", showLocalButton = false) {
  els.chatPendingBox?.classList.remove("hidden");
  if (els.chatPendingMessage) els.chatPendingMessage.textContent = message;
  els.chatUseLocalButton?.classList.toggle("hidden", !showLocalButton);
}

function hideChatPending() {
  els.chatPendingBox?.classList.add("hidden");
  els.chatUseLocalButton?.classList.add("hidden");
}

function formatChatResponse(response, sourceLabel = "") {
  const suggestionText = (response.suggestions || [])
    .map((item) => {
      const body = item.explanation || (item.steps ? item.steps.join(" →") : JSON.stringify(item.draft));
      return `${item.title}: ${body}`;
    })
    .join("\n");
  const lines = [];
  if (sourceLabel) lines.push(`[${sourceLabel}]`);
  if (response.privacy) lines.push(response.privacy);
  if (response.remote?.ok) {
    lines.push(`[원격 AI 응답] ${response.remote.provider || "AI"} ${response.remote.model || ""}`.trim());
  } else if (response.remoteFailure) {
    const remote = response.remoteFailure;
    lines.push(`[원격 AI 실패] ${remote.provider || "AI"} ${remote.status || ""}: ${remote.message || "응답을 받지 못했습니다."}`);
  }
  if (response.advice?.summary) lines.push(response.advice.summary);
  if (suggestionText) lines.push(suggestionText);
  if (response.remoteFailure && response.localAdvice?.summary && response.localAdvice.summary !== response.advice?.summary) {
    lines.push(`[보조 진단] ${response.localAdvice.summary}`);
    const localText = (response.localAdvice.suggestions || [])
      .map((item) => `${item.title}: ${item.explanation || (item.steps || []).join(" →")}`)
      .join("\n");
    if (localText) lines.push(localText);
  }
  return lines.filter(Boolean).join("\n");
}

function handleChatResponse(response, sourceLabel = "") {
  appendChat("assistant", formatChatResponse(response, sourceLabel), response.maskedPayload);
  if (response.constraintDrafts?.length) {
    state.pendingConstraintDrafts = response.constraintDrafts;
    renderChatConstraints();
    setActiveTab("diagnostics");
  }
  if (response.scheduleProposal?.scheduleResult) {
    const proposal = response.scheduleProposal;
    const preview = buildProposalPreview(proposal.scheduleResult);
    if (proposal.message) preview.message = proposal.message;
    openChangePreview({ title: "AI 변경안 미리보기", preview, kind: "proposal", proposal });
    appendChat("assistant", "AI 변경안을 만들었습니다. 변경 미리보기에서 승인하면 시간표에 반영합니다.");
  }
}

function useLocalChatNow() {
  if (!state.chatLocalResponse) {
    showChatPending("로컬 보조 답변을 준비하는 중입니다. 잠시만 기다려주세요.", false);
    return;
  }
  if (!state.chatLocalDisplayed) {
    state.chatLocalDisplayed = true;
    handleChatResponse(state.chatLocalResponse, "보조 진단 먼저 보기");
  }
  showChatPending("원격 AI가 더 깊게 검토 중입니다. 늦게 도착하면 이어서 표시합니다.", false);
  els.chatButton.disabled = false;
}

async function sendChatProgressive() {
  const message = els.chatMessage.value.trim();
  if (!message) return;
  appendChat("user", message);
  els.chatMessage.value = "";
  els.chatButton.disabled = true;
  const requestId = ++state.chatPendingRemoteId;
  state.chatLocalResponse = null;
  state.chatLocalDisplayed = false;
  showChatPending("AI가 답변을 준비하고 있습니다.", false);
  const payload = chatRequestPayload(message);
  let remoteDone = false;
  window.setTimeout(() => {
    if (state.chatPendingRemoteId === requestId && !remoteDone) {
      showChatPending("원격 AI가 계속 생각 중입니다. 지금 로컬 보조 답변을 먼저 볼 수 있습니다.", true);
    }
  }, 20000);
  const localPromise = api("/ai/chat/local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then((response) => {
      if (state.chatPendingRemoteId !== requestId) return null;
      state.chatLocalResponse = response;
      return response;
    })
    .catch((error) => {
      log(error.message);
      return null;
    });
  try {
    const response = await api("/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    remoteDone = true;
    if (state.chatPendingRemoteId !== requestId) return;
    hideChatPending();
    handleChatResponse(response, state.chatLocalDisplayed ? "원격 AI 응답 도착" : "");
    log("AI 제안 생성 완료");
  } catch (error) {
    remoteDone = true;
    if (state.chatPendingRemoteId !== requestId) return;
    const local = await localPromise;
    hideChatPending();
    if (local && !state.chatLocalDisplayed) {
      handleChatResponse(local, "원격 실패 후 보조 진단");
    }
    appendChat("assistant", `원격 AI 요청 실패: ${error.message}`);
    log(error.message);
  } finally {
    if (state.chatPendingRemoteId === requestId) {
      els.chatButton.disabled = false;
    }
  }
}

async function validateApiKey() {
  els.apiCheckButton.disabled = true;
  els.apiStatus.textContent = `${providerLabel()} API 키 검증 중`;
  const inputConfig = readAiConfig();
  try {
    const result = await api("/ai/validate-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ aiConfig: inputConfig }),
    });
    state.apiValidated = Boolean(result.ok);
    state.validatedAiConfig = result.aiConfig || null;
    state.sessionAiConfig = result.ok ? { ...inputConfig, validated: true } : null;
    els.apiStatus.textContent = result.ok ? result.message : `${result.message} (${providerLabel(inputConfig.provider)} / ${inputConfig.model || "모델코드 없음"})`;
    els.apiStatus.classList.toggle("ok", Boolean(result.ok));
    els.apiStatus.classList.toggle("error", !result.ok);
    els.apiProviderBadge.textContent = result.ok ? `${providerLabel()} 연결됨` : "미검증";
    els.apiProviderBadge.classList.toggle("muted", !result.ok);
    if (els.chatAiStatus) {
      els.chatAiStatus.textContent = result.ok ? `${providerLabel()} 연결이 검증되었습니다.` : "왼쪽 시작 패널에서 AI 키를 먼저 검증하세요.";
    }
    if (result.ok) setStartStep("excel");
    log(result.message);
    updateSolveAvailability();
  } catch (error) {
    state.apiValidated = false;
    state.sessionAiConfig = null;
    els.apiStatus.textContent = `${error.message} (${providerLabel(inputConfig.provider)} / ${inputConfig.model || "모델코드 없음"})`;
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

async function loadRecentLogs() {
  try {
    const response = await api("/logs/recent");
    const logs = response.logs || [];
    if (!logs.length) {
      log("최근 오류 로그가 없습니다.");
      return;
    }
    for (const item of logs.slice(-12).reverse()) {
      const payload = item.payload || {};
      const summary = payload.message || payload.path || payload.provider || payload.runId || JSON.stringify(payload);
      log(`[${item.event}] ${summary}`);
    }
  } catch (error) {
    log(error.message);
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
  els.solveButton.addEventListener("click", () => openSolvePreferences("workspace"));
  els.startSolveButton?.addEventListener("click", solveScheduleFromSetup);
  els.solvePreferenceClose?.addEventListener("click", closeSolvePreferences);
  els.solvePreferenceCancel?.addEventListener("click", closeSolvePreferences);
  els.solvePreferenceConfirm?.addEventListener("click", confirmSolvePreferences);
  els.retrySolveButton?.addEventListener("click", () => solveSchedule(state.solveLaunchContext || "setup"));
  els.editSolvePreferenceButton?.addEventListener("click", () => openSolvePreferences(state.solveLaunchContext || "setup"));
  els.acceptBestSolveButton?.addEventListener("click", requestAcceptBestSolve);
  els.acceptBestSolveOverlayButton?.addEventListener("click", requestAcceptBestSolve);
  els.changePreviewClose?.addEventListener("click", closeChangePreview);
  els.changePreviewCancel?.addEventListener("click", closeChangePreview);
  els.changePreviewConfirm?.addEventListener("click", confirmChangePreview);
  els.initialConstraintButton?.addEventListener("click", createInitialConstraintDraft);
  els.skipConstraintButton?.addEventListener("click", () => setStartStep("preferences"));
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
    loadInsights(false).catch((error) => log(error.message));
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
  els.aiModelSelect?.addEventListener("change", () => {
    handleModelSelectionChange();
    resetApiValidation(`${providerLabel()} API 키를 다시 검증하세요.`);
  });
  els.aiModelCustom?.addEventListener("input", () => {
    syncModelValueFromControls();
    resetApiValidation(`${providerLabel()} API 키를 다시 검증하세요.`);
  });
  for (const input of [els.apiKey, els.aiBaseUrl]) {
    input.addEventListener("input", () => resetApiValidation(`${providerLabel()} API 키를 다시 검증하세요.`));
  }
  els.recentLogsButton?.addEventListener("click", loadRecentLogs);
  els.refreshInsightsButton?.addEventListener("click", () => loadInsights(true).catch((error) => log(error.message)));
  els.saveScenarioButton?.addEventListener("click", () => saveCurrentScenario().catch((error) => log(error.message)));
  els.scenarioList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-load-scenario]");
    if (!button) return;
    loadScenario(button.dataset.loadScenario).catch((error) => log(error.message));
  });
  els.chatUseLocalButton?.addEventListener("click", useLocalChatNow);
  els.chatButton.addEventListener("click", sendChatProgressive);
  els.chatMessage.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "Enter") {
      sendChatProgressive();
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
  renderInsights(null);
  setActiveTab("overview");
  setStartStep("api");
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
