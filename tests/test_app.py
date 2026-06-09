import json
import os
import unittest
from collections import defaultdict
from unittest.mock import patch

from legacy import legacy_app as app_module
from legacy.legacy_app import SPECS_BY_NAME, ai_chat, append_operation_log, create_template_workbook, move_preview, move_schedule, operation_logs_text, parse_days, quick_move_options, routed_request_path, save_moved_schedule_result, solve_schedule, teacher_balance_penalty, teacher_issue_summary, validate_ai_key, validate_schedule, validate_workbook


def append_named_row(workbook, sheet_name, values):
    headers = SPECS_BY_NAME[sheet_name]
    workbook[sheet_name].append([values.get(header, "") for header in headers])


def set_config_value(workbook, key, value):
    sheet = workbook["기본설정"]
    for row in range(2, sheet.max_row + 1):
        if sheet.cell(row=row, column=1).value == key:
            sheet.cell(row=row, column=2).value = value
            return
    sheet.append([key, value, ""])


class TimetableAppTests(unittest.TestCase):
    def test_blank_template_passes_structure_validation(self):
        workbook = create_template_workbook()
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        self.assertEqual(validation["stats"]["loadCount"], 0)

    def test_template_has_name_based_dropdowns(self):
        workbook = create_template_workbook()
        sheet = workbook["교사별 시수표"]
        formulas = {validation.formula1 for validation in sheet.data_validations.dataValidation}
        self.assertIn("'교사'!$A$2:$A$200", formulas)
        self.assertIn("'과목'!$A$2:$A$200", formulas)
        self.assertIn("'학급-계열'!$A$2:$A$200", formulas)
        headers = [sheet.cell(1, column).value for column in range(1, len(SPECS_BY_NAME["교사별 시수표"]) + 1)]
        self.assertEqual(headers[:2], ["교사명", "과목명"])
        self.assertEqual(sheet.cell(1, len(SPECS_BY_NAME["교사별 시수표"]) + 1).value, "1-1")
        self.assertEqual(workbook["학급-계열"]["A2"].border.left.style, "thin")

    def test_api_connection_controls_are_before_excel_upload_in_start_panel(self):
        html = (app_module.ROOT / "web" / "index.html").read_text(encoding="utf-8")
        styles = (app_module.ROOT / "web" / "styles.css").read_text(encoding="utf-8")
        start_index = html.index("start-panel")
        provider_index = html.index('id="aiProvider"')
        key_index = html.index('id="apiKey"')
        drop_index = html.index('class="file-drop"')
        solve_status_index = html.index('id="solveStatus"')
        self.assertGreater(provider_index, start_index)
        self.assertLess(provider_index, drop_index)
        self.assertLess(key_index, drop_index)
        self.assertGreater(solve_status_index, drop_index)
        self.assertIn('data-start-step="api"', html)
        self.assertIn('data-start-step="excel"', html)
        self.assertIn('data-start-step="constraints"', html)
        self.assertIn('data-start-step="preferences"', html)
        self.assertIn('data-start-step="solving"', html)
        self.assertIn('id="initialConstraintText"', html)
        self.assertIn('id="startSolveButton"', html)
        self.assertIn('class="loading-spinner"', html)
        self.assertIn("position: fixed", styles)
        self.assertIn(".start-panel.completed", styles)
        self.assertIn("@keyframes spin", styles)

    def test_solve_preferences_and_manual_edit_are_visible(self):
        html = (app_module.ROOT / "web" / "index.html").read_text(encoding="utf-8")
        script = (app_module.ROOT / "web" / "app.js").read_text(encoding="utf-8")
        styles = (app_module.ROOT / "web" / "styles.css").read_text(encoding="utf-8")
        preference_index = html.index("자동배정 선호도")
        manual_link_index = html.index('href="#manualEditPanel"')
        manual_panel_index = html.index('id="manualEditPanel"')
        self.assertIn('id="solveMethod"', html)
        self.assertIn('id="solvePreferenceModal"', html)
        self.assertIn('id="searchStrength"', html)
        self.assertIn('id="variationMode"', html)
        self.assertIn('id="solveOverlay"', html)
        self.assertIn('id="preferenceOrder"', html)
        self.assertIn('id="allowRelaxForUnassigned"', html)
        self.assertIn('<input id="allowRelaxForUnassigned" type="checkbox" />', html)
        self.assertIn('id="quickEditStatus"', html)
        self.assertIn('id="quickMoveList"', html)
        self.assertIn('id="teacherIssuePanel"', html)
        self.assertIn('class="workspace-tabs"', html)
        self.assertIn('class="ai-dock"', html)
        self.assertIn('id="chatConstraintList"', html)
        self.assertEqual(html.count('<option value="안배>'), 2)
        self.assertEqual(html.count('<option value="연강>'), 2)
        self.assertEqual(html.count('<option value="식사시간>'), 2)
        self.assertLess(preference_index, manual_panel_index)
        self.assertLess(manual_link_index, manual_panel_index)
        self.assertIn("function getSolveOptions()", script)
        self.assertIn("solveOptions: getSolveOptions()", script)
        self.assertIn("function loadQuickMoveOptions()", script)
        self.assertIn("function setActiveTab", script)
        self.assertIn("chatConstraints: state.chatConstraints", script)
        self.assertIn("fallbackLatestImport: true", script)
        self.assertIn("fallbackLastSchedule: true", script)
        self.assertIn('api("/schedules/current")', script)
        self.assertIn("function ensureScheduleForManual()", script)
        self.assertIn("function setStartStep", script)
        self.assertIn("function completeSetup()", script)
        self.assertIn("function solveScheduleFromSetup()", script)
        self.assertIn("function openSolvePreferences", script)
        self.assertIn("function confirmSolvePreferences", script)
        self.assertIn("openSolvePreferences(\"workspace\")", script)
        self.assertIn("openSolvePreferences(\"setup\")", script)
        self.assertIn('setStartStep("solving")', script)
        self.assertIn('setStartStep("preferences")', script)
        self.assertIn("createInitialConstraintDraft", script)
        self.assertIn("response.scheduleProposal", script)
        self.assertIn("openChangePreview", script)
        self.assertIn("/schedules/move-preview", script)
        self.assertIn("/schedules/proposals/apply", script)
        self.assertIn("/schedules/solve/start", script)
        self.assertIn("/schedules/solve/continue", script)
        self.assertIn("/schedules/solve/accept", script)
        self.assertIn('data-tab-target="analysis"', html)
        self.assertIn('id="refreshInsightsButton"', html)
        self.assertIn('id="saveScenarioButton"', html)
        self.assertIn('id="unassignedDashboard"', html)
        self.assertIn('id="relaxationSimulator"', html)
        self.assertIn('id="candidateComparison"', html)
        self.assertIn('id="syncGroupVisualization"', html)
        self.assertIn('id="neisPrecheck"', html)
        self.assertIn("/schedules/insights", script)
        self.assertIn("/scenarios/save", script)
        self.assertIn("function renderInsights", script)
        self.assertIn(".analysis-card", styles)
        self.assertIn("requireCpSat", script)
        self.assertIn("function acceptBestSolveNow", script)
        self.assertIn("function buildSolveReviewLines", script)
        self.assertIn("function applyRelaxationPreset", script)
        self.assertIn("원격 AI는 진행형 탐색 중에는 호출하지 않았습니다", script)
        self.assertIn("실제 후보군이 아니라", script)
        self.assertIn("stagnationCount", script)
        self.assertIn("structuralBlockers", script)
        self.assertIn("solve-progress-details", styles)
        self.assertIn("function requestBasePayloadForSolve()", script)
        self.assertIn("function scheduleResultImportId", script)
        self.assertIn("await requestBasePayloadForSolve()", script)
        self.assertIn("/ai/chat/local", script)
        self.assertIn('id="acceptBestSolveButton"', html)
        self.assertIn('id="acceptBestSolveOverlayButton"', html)
        self.assertIn('id="chatUseLocalButton"', html)
        self.assertIn("현재 최선안 사용", html)
        self.assertIn("지금 답변하기", html)
        self.assertNotIn("timeBudgetSeconds", script)
        self.assertNotIn("skipped_timeout_guard", script)
        self.assertIn("document.addEventListener(\"keydown\", handleQuickEditKeydown)", script)
        self.assertNotIn("유전탐색", script)

    def test_schedule_insights_returns_analysis_sections(self):
        records = {
            "config": {"요일": "월,화", "교시수": "2"},
            "teachers": {"T1": {"교사명": "김교사"}},
            "classes": {"C1": {"학급명": "1-1", "_dayLimits": {"월": 2, "화": 2}}},
            "subjects": {"S1": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T1", "subjectCode": "S1", "classCode": "C1", "weeklyHours": 1}],
            "fixedPeriods": [],
            "constraints": [],
            "neis": [],
            "syncBundles": [],
        }
        candidate = {
            "strategy": "test",
            "score": 0,
            "schedule": app_module.empty_schedule(records),
            "unassigned": [{"teacherCode": "T1", "subjectCode": "S1", "classCode": "C1", "hours": 1}],
            "validation": {"violations": []},
            "teacherIssues": [],
        }
        result = {"selected": candidate, "candidates": [candidate]}
        insights = app_module.schedule_insights(records, result, candidate, include_simulation=False)

        self.assertTrue(insights["ok"])
        self.assertEqual(insights["summary"]["unassigned"], 1)
        self.assertIn("risk", insights)
        self.assertIn("unassigned", insights)
        self.assertIn("candidateComparison", insights)
        self.assertIn("manualRecommendations", insights)
        self.assertIn("neis", insights)
        self.assertIn("queue", insights)

    def test_progress_summary_counts_teacher_issue_tags(self):
        result = {
            "selected": {
                "unassigned": [],
                "validation": {"violations": []},
                "teacherIssues": [
                    {"teacherName": "A", "issues": ["\uc2dd\uc0ac"]},
                    {"teacherName": "B", "issues": ["3\uc5f0\uac15", "\uc548\ubc30"]},
                    {"teacherName": "C", "issues": ["\uc548\ubc30"]},
                ],
                "schedule": {},
            }
        }
        summary = app_module.solve_best_summary(result)

        self.assertEqual(summary["lunchShortage"], 1)
        self.assertEqual(summary["consecutive"], 1)
        self.assertEqual(summary["imbalance"], 2)
        self.assertEqual(summary["teacherIssueCount"], 3)

    def test_now_iso_uses_korean_timezone(self):
        self.assertRegex(app_module.now_iso(), r"\+09:00$")

    def test_cp_sat_dependency_and_missing_status_are_declared(self):
        requirements = (app_module.ROOT / "legacy" / "requirements.txt").read_text(encoding="utf-8")
        self.assertIn("ortools", requirements)
        candidate, stats = app_module.solve_cp_sat_candidate({"classes": {}, "loads": [], "config": {}})
        if app_module.cp_sat_available():
            self.assertIsNotNone(candidate)
            self.assertIn(stats["cpStatus"], {"optimal", "feasible", "infeasible", "not-run"})
        else:
            self.assertIsNone(candidate)
            self.assertEqual(stats["cpStatus"], "not-run")
            self.assertIn("CP-SAT", stats["message"])

    def test_progressive_solve_session_accept_persists_best_only_on_accept(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 1
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        with patch.object(app_module, "save_last_schedule") as save_last_schedule:
            started = app_module.start_solve_session(validation["records"], {"iterations": 12, "searchStrength": "fast"}, import_id="import-abc")
            self.assertTrue(started["ok"])
            self.assertTrue(started["canAccept"])
            continued = app_module.continue_solve_session(validation["records"], started["sessionId"])
            self.assertTrue(continued["ok"])
            self.assertIn("lastResultSummary", continued)
            self.assertIn("bestChangedAt", continued)
            self.assertIn("stagnationCount", continued)
            self.assertIn("activeProfiles", continued)
            self.assertIn("structuralBlockers", continued)
            self.assertIn("aiRepairAdvice", continued)
            save_last_schedule.assert_not_called()
            accepted = app_module.accept_solve_session(started["sessionId"])
            self.assertIn("selected", accepted)
            self.assertIn("solveSession", accepted)
            self.assertEqual(accepted["importId"], "import-abc")
            self.assertEqual(accepted["solveSession"]["importId"], "import-abc")
            save_last_schedule.assert_called_once()

    def test_progressive_solve_chunk_stage_escalates_repair_mode(self):
        self.assertEqual(app_module.solve_chunk_stage(0)["repairMode"], "constraint")
        self.assertEqual(app_module.solve_chunk_stage(2)["repairMode"], "relax")
        self.assertEqual(app_module.solve_chunk_stage(5)["repairMode"], "deep")
        self.assertEqual(app_module.solve_chunk_stage(1, elapsed_ms=21000)["repairMode"], "relax")
        self.assertEqual(app_module.solve_chunk_stage(1, stagnation_count=4)["repairMode"], "deep")

    def test_records_can_fallback_to_last_schedule_import_id_for_resolve(self):
        records = {"config": {}, "teachers": {}, "classes": {}, "subjects": {}, "rooms": {}, "loads": []}
        with patch.object(app_module, "load_last_schedule", return_value={"importId": "import-last"}), patch.object(app_module, "load_import", return_value={"records": records}):
            resolved = app_module.get_records_from_body({"fallbackLastSchedule": True, "fallbackLatestImport": True})
        self.assertIs(resolved, records)
        self.assertEqual(app_module.missing_records_message({"fallbackLastSchedule": True}), "이전 배정의 입력 엑셀 자료를 찾지 못했습니다. 엑셀을 다시 업로드하세요.")

    def test_sync_group_class_lane_hours_validate_and_move_together(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김세계"})
        append_named_row(workbook, "교사", {"교사명": "박세계"})
        append_named_row(workbook, "교사", {"교사명": "이물리"})
        append_named_row(workbook, "학급-계열", {"학급명": "2-1", "학년": "2", "계열": "공통", "담임교사명": "김세계", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "2-2", "학년": "2", "계열": "공통", "담임교사명": "박세계", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "2-3", "학년": "2", "계열": "공통", "담임교사명": "이물리", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "세계사", "단축명": "세", "NEIS과목명": "세계사"})
        append_named_row(workbook, "과목", {"과목명": "물리", "단축명": "물", "NEIS과목명": "물리"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김세계", "과목명": "세계사", "동시그룹": "G1"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "박세계", "과목명": "세계사", "동시그룹": "G1"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "이물리", "과목명": "물리", "동시그룹": "G1"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "2-1"
        load_sheet.cell(row=1, column=class_start + 1).value = "2-2"
        load_sheet.cell(row=1, column=class_start + 2).value = "2-3"
        load_sheet.cell(row=load_sheet.max_row - 2, column=class_start).value = 3
        load_sheet.cell(row=load_sheet.max_row - 1, column=class_start + 1).value = 3
        load_sheet.cell(row=load_sheet.max_row, column=class_start + 2).value = 3
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"], validation["issues"])
        self.assertEqual(len(validation["records"].get("syncBundles", [])), 1)
        self.assertEqual(validation["records"]["syncBundles"][0]["laneHours"], {"C001": 3, "C002": 3, "C003": 3})
        self.assertEqual(len(validation["records"]["syncBundles"][0]["occurrences"]), 3)
        selected = solve_schedule(validation["records"], solve_options={"iterations": 12, "searchStrength": "fast"})["selected"]
        by_occurrence = defaultdict(set)
        for class_data in selected["schedule"]["classes"].values():
            for day in selected["schedule"]["days"]:
                for period in selected["schedule"]["periods"]:
                    cell = class_data["grid"][day][str(period)]
                    if cell and cell.get("syncOccurrenceId"):
                        by_occurrence[cell["syncOccurrenceId"]].add((day, period))
        self.assertTrue(by_occurrence)
        self.assertTrue(all(len(slots) == 1 for slots in by_occurrence.values()))

        source = None
        source_occurrence = None
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                cell = selected["schedule"]["classes"]["C001"]["grid"][day][str(period)]
                if cell and cell.get("syncOccurrenceId"):
                    source = {"classCode": "C001", "day": day, "period": period}
                    source_occurrence = cell["syncOccurrenceId"]
                    break
            if source:
                break
        options = quick_move_options(validation["records"], selected["schedule"], source)
        move_option = next(item for item in options["options"] if item["mode"] == "move")
        moved = move_schedule(validation["records"], selected["schedule"], {
            "mode": "move",
            "from": source,
            "to": {"day": move_option["day"], "period": move_option["period"]},
        })
        self.assertIn("validation", moved)
        moved_slots = set()
        for class_data in moved["schedule"]["classes"].values():
            for day in moved["schedule"]["days"]:
                for period in moved["schedule"]["periods"]:
                    cell = class_data["grid"][day][str(period)]
                    if cell and cell.get("syncOccurrenceId") == source_occurrence:
                        moved_slots.add((day, period))
        self.assertEqual(moved_slots, {(move_option["day"], move_option["period"])})

    def test_sync_group_occurrences_are_recombined_to_avoid_teacher_duplication(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김중복"})
        append_named_row(workbook, "교사", {"교사명": "박대체"})
        append_named_row(workbook, "교사", {"교사명": "이대체"})
        append_named_row(workbook, "학급-계열", {"학급명": "3-1", "학년": "3", "계열": "공통", "담임교사명": "김중복", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "3-2", "학년": "3", "계열": "공통", "담임교사명": "박대체", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "언매", "단축명": "언", "NEIS과목명": "언매"})
        append_named_row(workbook, "과목", {"과목명": "화작", "단축명": "화", "NEIS과목명": "화작"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김중복", "과목명": "언매", "동시그룹": "G3"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "박대체", "과목명": "화작", "동시그룹": "G3"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김중복", "과목명": "언매", "동시그룹": "G3"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "이대체", "과목명": "화작", "동시그룹": "G3"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "3-1"
        load_sheet.cell(row=1, column=class_start + 1).value = "3-2"
        load_sheet.cell(row=load_sheet.max_row - 3, column=class_start).value = 1
        load_sheet.cell(row=load_sheet.max_row - 2, column=class_start).value = 1
        load_sheet.cell(row=load_sheet.max_row - 1, column=class_start + 1).value = 1
        load_sheet.cell(row=load_sheet.max_row, column=class_start + 1).value = 1
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"], validation["issues"])
        bundle = validation["records"]["syncBundles"][0]
        self.assertEqual(len(bundle["occurrences"]), 2)
        for occurrence in bundle["occurrences"]:
            self.assertFalse(app_module.sync_occurrence_teacher_conflicts(occurrence), occurrence)
        selected = solve_schedule(validation["records"], solve_options={"iterations": 8, "searchStrength": "fast"}, persist=False, advisor=False)["selected"]
        self.assertEqual(len(selected.get("unassigned", [])), 0)

    def test_sync_group_unavoidable_teacher_duplication_is_upload_error(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김중복"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김중복", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-2", "학년": "1", "계열": "공통", "담임교사명": "김중복", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김중복", "과목명": "국어", "동시그룹": "G1"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김중복", "과목명": "국어", "동시그룹": "G1"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=1, column=class_start + 1).value = "1-2"
        load_sheet.cell(row=load_sheet.max_row - 1, column=class_start).value = 1
        load_sheet.cell(row=load_sheet.max_row, column=class_start + 1).value = 1
        validation = validate_workbook(workbook)
        self.assertFalse(validation["ok"])
        issues_text = json.dumps(validation["issues"], ensure_ascii=False)
        self.assertIn("동시그룹", issues_text)
        self.assertIn("동시에 필요", issues_text)

    def test_sync_group_class_lane_hour_mismatch_is_upload_error(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김국어"})
        append_named_row(workbook, "교사", {"교사명": "박수학"})
        append_named_row(workbook, "교사", {"교사명": "이물리"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김국어", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-2", "학년": "1", "계열": "공통", "담임교사명": "박수학", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-3", "학년": "1", "계열": "공통", "담임교사명": "이물리", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "과목", {"과목명": "수학", "단축명": "수", "NEIS과목명": "수학"})
        append_named_row(workbook, "과목", {"과목명": "물리", "단축명": "물", "NEIS과목명": "물리"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김국어", "과목명": "국어", "동시그룹": "G1"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "박수학", "과목명": "수학", "동시그룹": "G1"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "이물리", "과목명": "물리", "동시그룹": "G1"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=1, column=class_start + 1).value = "1-2"
        load_sheet.cell(row=1, column=class_start + 2).value = "1-3"
        load_sheet.cell(row=load_sheet.max_row - 2, column=class_start).value = 3
        load_sheet.cell(row=load_sheet.max_row - 1, column=class_start + 1).value = 2
        load_sheet.cell(row=load_sheet.max_row, column=class_start + 2).value = 3
        validation = validate_workbook(workbook)
        self.assertFalse(validation["ok"])
        self.assertIn("동시그룹", json.dumps(validation["issues"], ensure_ascii=False))
        self.assertIn("학급별", json.dumps(validation["issues"], ensure_ascii=False))

    def test_legacy_python_entrypoint_is_not_exposed_to_vercel(self):
        vercel_config = json.loads((app_module.ROOT / "vercel.json").read_text(encoding="utf-8"))
        self.assertFalse((app_module.ROOT / "app.py").exists())
        self.assertTrue((app_module.ROOT / "legacy" / "legacy_app.py").exists())
        self.assertIs(app_module.handler, app_module.AppHandler)
        self.assertNotIn("functions", vercel_config)
        self.assertNotIn("rewrites", vercel_config)
        self.assertEqual(routed_request_path("/api?__path=api/health"), "/api/health")
        self.assertEqual(routed_request_path("/api?__path=templates/timetable-input.xlsx"), "/templates/timetable-input.xlsx")
        self.assertEqual(routed_request_path("/"), "/")

    def test_storage_mode_detects_vercel_storage_envs(self):
        storage_env = {
            "POSTGRES_URL": "postgres://example",
            "BLOB_READ_WRITE_TOKEN": "vercel_blob_token",
            "KV_REST_API_URL": "https://redis.example",
            "KV_REST_API_TOKEN": "redis-token",
        }
        with patch.dict(os.environ, storage_env, clear=True):
            self.assertEqual(app_module.storage_mode(), "postgres+redis+blob")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(app_module.storage_mode(), "local")

    def test_operation_logs_redact_api_keys(self):
        log_path = app_module.ROOT / "work" / "test-operation-log.jsonl"
        if log_path.exists():
            log_path.unlink()
        with patch.object(app_module, "OPERATION_LOG_FILE", log_path):
            append_operation_log("ai", {"path": "/ai/chat", "apiKey": "sk-test-secret", "nested": {"x-goog-api-key": "AIza-secret"}})
            text = operation_logs_text().decode("utf-8")
        self.assertNotIn("sk-test-secret", text)
        self.assertNotIn("AIza-secret", text)
        self.assertIn("[redacted]", text)
        if log_path.exists():
            log_path.unlink()

    def test_parse_days_accepts_common_weekday_formats(self):
        expected = ["월", "화", "수", "목", "금"]
        self.assertEqual(parse_days("월,화,수,목,금"), expected)
        self.assertEqual(parse_days("월화수목금"), expected)
        self.assertEqual(parse_days("월 화 수 목 금"), expected)
        self.assertEqual(parse_days("월~금"), expected)
        self.assertEqual(parse_days("1/3,1/4"), ["1/3", "1/4"])

    def test_invalid_name_references_are_reported(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사별 시수표", {
            "교사명": "없는교사",
            "과목명": "없는과목",
        })
        row = workbook["교사별 시수표"].max_row
        class_col = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        workbook["교사별 시수표"].cell(row=row, column=class_col).value = 3
        workbook["교사별 시수표"].cell(row=1, column=class_col).value = "없는학급"
        validation = validate_workbook(workbook)
        self.assertFalse(validation["ok"])
        messages = " ".join(item["message"] for item in validation["issues"])
        self.assertIn("없는교사", messages)
        self.assertIn("없는과목", messages)
        self.assertIn("없는학급", messages)

    def test_condition_priority_is_parsed_from_template(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "배정금지-희망조건", {
            "대상유형": "교사",
            "대상명": "김교사",
            "조건유형": "비선호",
            "요일": "월",
            "교시": "1",
            "강도": "soft",
            "우선순위": "9",
            "설명": "월요일 1교시 회피",
        })
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        self.assertEqual(validation["records"]["constraints"][0]["priority"], 9)
        self.assertEqual(validation["records"]["constraints"][0]["conditionType"], "비선호")

    def test_greedy_solver_assigns_name_based_dummy_data(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-2", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        load_row = load_sheet.max_row
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=1, column=class_start + 1).value = "1-2"
        load_sheet.cell(row=load_row, column=class_start).value = 3
        load_sheet.cell(row=load_row, column=class_start + 1).value = 2
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        self.assertEqual(validation["records"]["codeMapping"]["teachers"]["T001"], "김교사")
        self.assertEqual(validation["records"]["codeMapping"]["classes"]["C001"], "1-1")
        self.assertEqual(len(validation["records"]["loads"]), 2)

        result = solve_schedule(validation["records"])
        selected = result["selected"]
        expected_algorithm = "cp-sat-metaheuristic" if app_module.cp_sat_available() else "metaheuristic-genetic"
        self.assertEqual(result["solver"]["algorithm"], expected_algorithm)
        self.assertGreater(result["repairSummary"]["geneticCandidateCount"], 0)
        self.assertEqual(selected["unassigned"], [])
        assigned = 0
        for class_code in ["C001", "C002"]:
            for day in selected["schedule"]["days"]:
                for period in selected["schedule"]["periods"]:
                    if selected["schedule"]["classes"][class_code]["grid"][day][str(period)]:
                        assigned += 1
        self.assertEqual(assigned, 5)

    def test_class_day_hours_follow_configured_weekday_order(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {
            "학급명": "1-1",
            "학년": "1",
            "계열": "공통",
            "담임교사명": "김교사",
            "요일별시수": "7,7,6,7,7",
            "가상학급여부": "N",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        load_row = load_sheet.max_row
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_row, column=class_start).value = 34

        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        result = solve_schedule(validation["records"])
        selected = result["selected"]
        class_data = selected["schedule"]["classes"]["C001"]
        self.assertEqual(class_data["dayLimits"]["수"], 6)
        self.assertEqual(class_data["dayLimits"]["금"], 7)
        self.assertIsNone(class_data["grid"]["수"]["7"])
        auto_cells = [
            cell
            for day in selected["schedule"]["days"]
            for period in selected["schedule"]["periods"]
            for cell in [class_data["grid"][day][str(period)]]
            if cell and cell.get("source") == "auto"
        ]
        self.assertEqual(len(auto_cells), 34)

    def test_solver_respects_lunch_protection_and_max_consecutive(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간후교시", "4")
        set_config_value(workbook, "점심시간보호", "Y")
        set_config_value(workbook, "최대연강허용", "3")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {
            "학급명": "1-1",
            "학년": "1",
            "계열": "공통",
            "담임교사명": "김교사",
            "요일별시수": "5",
            "가상학급여부": "N",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        load_row = load_sheet.max_row
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_row, column=class_start).value = 20

        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        selected = solve_schedule(validation["records"])["selected"]
        self.assertEqual(selected["unassigned"], [])
        self.assertTrue(selected["validation"]["ok"])
        grid = selected["schedule"]["classes"]["C001"]["grid"]
        for day in selected["schedule"]["days"]:
            periods = {period for period in selected["schedule"]["periods"] if grid[day][str(period)]}
            self.assertFalse({4, 5}.issubset(periods))
            current = 0
            longest = 0
            for period in selected["schedule"]["periods"]:
                current = current + 1 if period in periods else 0
                longest = max(longest, current)
            self.assertLessEqual(longest, 3)

    def test_balance_condition_penalizes_lopsided_teacher_distribution(self):
        teacher_busy = defaultdict(set)
        teacher_busy["T001"].update({("월", 1), ("월", 2), ("화", 5)})
        settings = {"balanceStrength": "soft", "lunchAfter": 4, "days": ["월", "화", "수", "목", "금"]}
        soft_penalty = teacher_balance_penalty(teacher_busy, "T001", "월", 3, settings)
        off_penalty = teacher_balance_penalty(teacher_busy, "T001", "월", 3, {**settings, "balanceStrength": "off"})
        self.assertGreater(soft_penalty, 0)
        self.assertEqual(off_penalty, 0)

    def test_constraint_pressure_prioritizes_constrained_lessons(self):
        records = {
            "config": {"일일최대교시": "7"},
            "teachers": {"T001": {"교사명": "제약교사"}, "T002": {"교사명": "일반교사"}},
            "classes": {"C001": {"학급명": "1-1"}, "C002": {"학급명": "1-2"}},
            "subjects": {"S001": {"과목명": "물리"}, "S002": {"과목명": "국어"}},
            "rooms": {"R001": {"특별실명": "실험실"}},
            "loads": [
                {"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1, "roomCode": "R001"},
                {"teacherCode": "T002", "subjectCode": "S002", "classCode": "C002", "weeklyHours": 1, "roomCode": ""},
            ],
            "constraints": [{
                "targetType": "교사",
                "targetCode": "T001",
                "conditionType": "배정금지",
                "strength": "hard",
                "days": ["월", "화", "수", "목", "금"],
                "periodsText": "1,2,3,4,5",
                "priority": 10,
            }],
        }
        schedule = app_module.empty_schedule(records)
        teacher_busy = defaultdict(set)
        room_busy = defaultdict(set)
        forbidden = app_module.build_forbidden_index(records)
        _, max_period = app_module.schedule_dimensions(records)

        constrained = app_module.load_constraint_pressure(records, schedule, records["loads"][0], 1, teacher_busy, room_busy, forbidden, max_period)
        easy = app_module.load_constraint_pressure(records, schedule, records["loads"][1], 1, teacher_busy, room_busy, forbidden, max_period)
        self.assertGreater(constrained["score"], easy["score"])
        self.assertLess(constrained["availableSlots"], easy["availableSlots"])

        genes = app_module.initial_genes(records, rng=app_module.random.Random(1), seed_base=1, iterations=12)
        self.assertEqual(genes[0]["strategy"], "constraint-first")

    def test_metaheuristic_solver_spreads_teacher_load_across_weekdays(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 20
        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])

        result = solve_schedule(validation["records"], solve_options={
            "balanceStrength": "hard",
            "iterations": 18,
            "maxConsecutive": 7,
            "protectLunch": "N",
            "preferenceOrder": "안배>연강>식사시간",
        })
        selected = result["selected"]
        self.assertEqual(selected["unassigned"], [])
        grid = selected["schedule"]["classes"]["C001"]["grid"]
        counts = {
            day: sum(1 for period in selected["schedule"]["periods"] if grid[day][str(period)] and grid[day][str(period)].get("source") == "auto")
            for day in selected["schedule"]["days"]
        }
        self.assertEqual(set(day for day, count in counts.items() if count), set(selected["schedule"]["days"]))
        self.assertLessEqual(max(counts.values()) - min(counts.values()), 1)

    def test_solve_runs_use_fresh_seed_and_return_search_metadata(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 8
        records = validate_workbook(workbook)["records"]

        first = solve_schedule(records, solve_options={"iterations": 10, "searchStrength": "fast"})
        second = solve_schedule(records, solve_options={"iterations": 10, "searchStrength": "fast"})

        self.assertNotEqual(first["runId"], second["runId"])
        self.assertNotEqual(first["seed"], second["seed"])
        self.assertGreater(first["attemptCount"], 0)
        self.assertIn("bestSignature", first)
        self.assertIn("searchStats", first)
        self.assertEqual(first["searchStats"]["variationMode"], "quality-first")
        self.assertIn("cpStatus", first["searchStats"])
        self.assertIn("phase", first["searchStats"])
        self.assertEqual(first["recordSignature"], second["recordSignature"])
        self.assertEqual(second["recordSignature"], app_module.records_signature(app_module.apply_solve_options(records, {"iterations": 10, "searchStrength": "fast"})))

    def test_quality_first_keeps_previous_candidate_when_new_search_is_worse(self):
        records = {"classes": {"C001": {}}, "config": {}, "teachers": {}, "subjects": {}, "rooms": {}, "loads": [], "constraints": []}
        previous = {
            "recordSignature": app_module.records_signature(records),
            "selected": {
                "strategy": "previous",
                "schedule": {"days": ["월"], "periods": [1], "classes": {"C001": {"grid": {"월": {"1": None}}}}},
                "unassigned": [],
                "validation": {"violations": []},
                "score": 10,
                "diagnostics": [],
            },
        }
        worse = {
            "strategy": "worse",
            "schedule": {"days": ["월"], "periods": [1], "classes": {"C001": {"grid": {"월": {"1": None}}}}},
            "unassigned": [{"hours": 1}],
            "validation": {"violations": []},
            "score": 0,
        }

        selected, changed, source = app_module.select_quality_first_candidate(records, [worse], "quality-first", previous)

        self.assertFalse(changed)
        self.assertEqual(source, "previous-retained")
        self.assertEqual(selected["strategy"], "previous")

    def test_fixed_periods_block_auto_assignment_without_counting_load(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "고정 일과", {
            "대상유형": "학급",
            "대상명": "1-1",
            "교시": "1",
            "월": "HR",
            "유형": "HR",
            "임장교사명": "김교사",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        load_row = load_sheet.max_row
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_row, column=class_start).value = 3

        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        self.assertEqual(validation["stats"]["fixedPeriodCount"], 1)
        self.assertEqual(validation["stats"]["loadCount"], 1)

        result = solve_schedule(validation["records"])
        selected = result["selected"]
        grid = selected["schedule"]["classes"]["C001"]["grid"]
        self.assertEqual(grid["월"]["1"]["source"], "fixed")
        self.assertEqual(grid["월"]["1"]["subjectName"], "HR")
        auto_cells = [
            cell
            for day in selected["schedule"]["days"]
            for period in selected["schedule"]["periods"]
            for cell in [grid[day][str(period)]]
            if cell and cell.get("source") == "auto"
        ]
        self.assertEqual(len(auto_cells), 3)

    def test_ai_response_uses_masked_payload(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
        }
        response = ai_chat(records, "금요일 6교시는 피하고 싶어", api_key_present=True)
        payload = json.dumps(response["maskedPayload"], ensure_ascii=False)
        self.assertIn("T001", payload)
        self.assertNotIn("김교사", payload)
        self.assertNotIn("1-1", payload)
        self.assertEqual(response["externalApi"], "fallback-local-analysis")
        self.assertEqual(response["remote"]["status"], "not-configured")

    def test_ai_chat_creates_applicable_name_based_constraint_draft(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
            "_lookups": {"teachers": {"김교사": "T001"}, "classes": {"1-1": "C001"}, "subjects": {"국어": "S001"}, "rooms": {}},
        }
        response = ai_chat(records, "김교사 금요일 6교시는 배정하지 말아줘", api_key_present=False)
        draft = response["constraintDrafts"][0]
        self.assertEqual(draft["targetName"], "김교사")
        self.assertEqual(draft["targetCode"], "T001")
        self.assertEqual(draft["conditionType"], "배정금지")
        self.assertEqual(draft["days"], ["금"])
        self.assertEqual(draft["periodsText"], "6")

        updated = app_module.records_with_chat_constraints(records, [draft])
        self.assertEqual(len(updated["constraints"]), 1)
        self.assertEqual(updated["constraints"][0]["targetName"], "김교사")

    def test_ai_chat_masks_names_before_remote_constraint_advice(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
        }
        captured = {}
        original = app_module.call_ai_advisor
        try:
            def fake_call(ai_config, task, context):
                captured.update(context)
                return {"ok": False, "status": "mock-fallback", "provider": "OpenAI", "message": "mock"}

            app_module.call_ai_advisor = fake_call
            response = ai_chat(records, "김교사 금요일 6교시는 배정하지 말아줘", api_key_present=True, ai_config={"provider": "openai", "apiKey": "sk-test", "model": "test-model"})
        finally:
            app_module.call_ai_advisor = original

        self.assertEqual(response["constraintDrafts"][0]["targetName"], "김교사")
        payload = json.dumps(captured, ensure_ascii=False)
        self.assertIn("T001", payload)
        self.assertNotIn("김교사", payload)

    def test_ai_chat_reports_remote_failure_and_local_assist_separately(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
        }
        original = app_module.call_ai_advisor
        try:
            app_module.call_ai_advisor = lambda ai_config, task, context: {
                "ok": False,
                "status": "mock-error",
                "provider": "OpenAI",
                "message": "mock provider failure",
            }
            response = ai_chat(records, "미배정을 0건으로 만들어줘.", api_key_present=True, ai_config={"provider": "openai", "apiKey": "sk-test", "model": "test-model"})
        finally:
            app_module.call_ai_advisor = original

        self.assertEqual(response["remoteFailure"]["status"], "mock-error")
        self.assertEqual(response["localAdvice"]["summary"], "보조 진단입니다.")
        self.assertEqual(response["advice"]["summary"], "보조 진단입니다.")
        self.assertEqual(response["externalApi"], "fallback-local-analysis")

    def test_ai_chat_can_apply_repair_solve_action(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 3
        validation = validate_workbook(workbook)

        response = ai_chat(validation["records"], "미배정을 모두 없애줘", api_key_present=False, solve_options={"iterations": 12})
        self.assertEqual(response["scheduleAction"]["type"], "repair-solve")
        self.assertFalse(response["scheduleAction"]["applied"])
        self.assertTrue(response["scheduleAction"]["requiresApproval"])
        self.assertIn("scheduleProposal", response)
        self.assertTrue(response["scheduleProposal"]["requiresApproval"])
        self.assertIn("selected", response["scheduleProposal"]["scheduleResult"])
        self.assertEqual(response["scheduleProposal"]["scheduleResult"]["selected"]["unassigned"], [])

    def test_records_from_body_can_fallback_to_latest_import(self):
        records = {"config": {}, "teachers": {"T001": {"교사명": "김교사"}}, "classes": {}, "subjects": {}, "rooms": {}, "loads": [], "constraints": []}
        with patch.object(app_module, "list_imports", lambda: [{"id": "latest"}]):
            with patch.object(app_module, "load_import", lambda import_id: {"records": records} if import_id == "latest" else None):
                loaded = app_module.get_records_from_body({"fallbackLatestImport": True})
        self.assertEqual(loaded["teachers"]["T001"]["교사명"], "김교사")

    def test_schedule_from_body_can_fallback_to_last_schedule(self):
        schedule = {"days": ["월"], "periods": [1], "classes": {}}
        with patch.object(app_module, "load_last_schedule", lambda: {"selected": {"schedule": schedule}}):
            loaded = app_module.get_schedule_from_body({"fallbackLastSchedule": True})
        self.assertEqual(loaded["days"], ["월"])

    def test_ai_chat_uses_remote_advice_when_validated_key_is_sent(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
        }
        original = app_module.call_ai_advisor
        try:
            app_module.call_ai_advisor = lambda ai_config, task, context: {
                "ok": True,
                "status": "called",
                "responseId": "resp_chat",
                "model": "test-model",
                "provider": "OpenAI",
                "advice": {
                    "summary": "원격 AI 채팅 제안",
                    "suggestions": [{
                        "type": "remote_chat",
                        "title": "조건 조정",
                        "explanation": "마스킹된 시간표 자료로 생성했습니다.",
                        "steps": ["미배정 진단", "낮은 우선순위 조건 완화"],
                    }],
                },
            }
            response = ai_chat(records, "미배정을 줄여줘", api_key_present=True, ai_config={"provider": "openai", "apiKey": "sk-test", "model": "test-model"})
        finally:
            app_module.call_ai_advisor = original

        self.assertEqual(response["externalApi"], "called")
        self.assertEqual(response["remote"]["responseId"], "resp_chat")
        self.assertEqual(response["advice"]["summary"], "원격 AI 채팅 제안")
        self.assertEqual(response["suggestions"][0]["title"], "조건 조정")

    def test_api_key_validation_reports_success_for_2xx_response(self):
        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

        original = app_module.urlopen
        try:
            app_module.urlopen = lambda request, timeout=8: FakeResponse()
            response = validate_ai_key("sk-test")
        finally:
            app_module.urlopen = original

        self.assertTrue(response["ok"])
        self.assertEqual(response["status"], "verified")

    def test_gemini_validation_uses_generate_content_and_api_key_header(self):
        captured = {}

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

        original = app_module.urlopen
        try:
            def fake_urlopen(request, timeout=8):
                captured["url"] = request.full_url
                captured["headers"] = {key.lower(): value for key, value in request.headers.items()}
                return FakeResponse()

            app_module.urlopen = fake_urlopen
            response = validate_ai_key({"provider": "gemini", "apiKey": "gem-test", "model": "gemini-test"})
        finally:
            app_module.urlopen = original

        self.assertTrue(response["ok"])
        self.assertIn("generativelanguage.googleapis.com", captured["url"])
        self.assertIn("models/gemini-test:generateContent", captured["url"])
        self.assertEqual(captured["headers"].get("x-goog-api-key"), "gem-test")
        self.assertNotIn("authorization", captured["headers"])

    def test_gemini_advice_parses_candidates_text_json(self):
        records = {
            "config": {},
            "teachers": {"T001": {"교사명": "김교사"}},
            "classes": {"C001": {"학급명": "1-1"}},
            "subjects": {"S001": {"과목명": "국어"}},
            "rooms": {},
            "loads": [{"teacherCode": "T001", "subjectCode": "S001", "classCode": "C001", "weeklyHours": 1}],
            "constraints": [],
        }
        captured = {}
        advice_payload = {
            "summary": "Gemini 제안",
            "suggestions": [{
                "type": "gemini",
                "title": "Gemini 검토",
                "explanation": "구조화 응답",
                "steps": ["조건 확인"],
            }],
        }

        class FakeResponse:
            status = 200

            def __enter__(self):
                return self

            def __exit__(self, exc_type, exc, traceback):
                return False

            def read(self):
                return json.dumps({
                    "candidates": [{
                        "content": {"parts": [{"text": json.dumps(advice_payload, ensure_ascii=False)}]}
                    }]
                }, ensure_ascii=False).encode("utf-8")

        original = app_module.urlopen
        try:
            def fake_urlopen(request, timeout=15):
                captured["url"] = request.full_url
                captured["headers"] = {key.lower(): value for key, value in request.headers.items()}
                captured["body"] = json.loads(request.data.decode("utf-8"))
                return FakeResponse()

            app_module.urlopen = fake_urlopen
            response = ai_chat(records, "미배정을 줄여줘", api_key_present=True, ai_config={"provider": "gemini", "apiKey": "gem-test", "model": "gemini-test"})
        finally:
            app_module.urlopen = original

        self.assertEqual(response["externalApi"], "called")
        self.assertEqual(response["remote"]["provider"], "Gemini")
        self.assertEqual(response["advice"]["summary"], "Gemini 제안")
        self.assertEqual(captured["headers"].get("x-goog-api-key"), "gem-test")
        self.assertEqual(captured["body"]["generationConfig"]["responseMimeType"], "application/json")

    def test_custom_provider_requires_base_url(self):
        response = validate_ai_key({"provider": "custom", "apiKey": "custom-key", "model": "custom-model"})
        self.assertFalse(response["ok"])
        self.assertEqual(response["status"], "missing_base_url")

    def test_solve_uses_remote_ai_advisor_when_key_is_available(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 1
        validation = validate_workbook(workbook)

        original = app_module.call_ai_advisor
        try:
            app_module.call_ai_advisor = lambda ai_config, task, context: {
                "ok": True,
                "status": "called",
                "model": "test-model",
                "responseId": "resp_test",
                "provider": "OpenAI",
                "advice": {
                    "summary": "원격 AI 제안",
                    "suggestions": [{
                        "type": "remote",
                        "title": "검토",
                        "explanation": "마스킹 자료 기반",
                        "steps": ["검증 통과"],
                    }],
                },
            }
            result = solve_schedule(validation["records"], ai_config={"provider": "openai", "apiKey": "sk-test", "model": "test-model"})
        finally:
            app_module.call_ai_advisor = original

        self.assertEqual(result["aiAdvisor"]["mode"], "openai-advisor")
        self.assertEqual(result["aiAdvisor"]["remote"]["responseId"], "resp_test")
        payload = json.dumps(result["aiAdvisor"], ensure_ascii=False)
        self.assertNotIn("김교사", payload)

    def test_ai_api_key_is_not_saved_in_last_schedule(self):
        workbook = create_template_workbook()
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 1
        validation = validate_workbook(workbook)
        secret = "sk-secret-should-not-be-saved"
        original = app_module.call_ai_advisor
        try:
            app_module.call_ai_advisor = lambda ai_config, task, context: {
                "ok": True,
                "status": "called",
                "provider": "OpenAI",
                "model": "test-model",
                "responseId": "resp_secure",
                "advice": {"summary": "보안 테스트", "suggestions": []},
            }
            solve_schedule(validation["records"], ai_config={"provider": "openai", "apiKey": secret, "model": "test-model"})
        finally:
            app_module.call_ai_advisor = original

        saved_text = app_module.LAST_SCHEDULE_FILE.read_text(encoding="utf-8")
        self.assertNotIn(secret, saved_text)

    def test_ai_repair_candidates_reduce_unassigned_with_explicit_relaxations(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "수업요일", "월")
        set_config_value(workbook, "일일최대교시", "5")
        set_config_value(workbook, "점심시간후교시", "4")
        set_config_value(workbook, "점심시간보호", "Y")
        set_config_value(workbook, "미배정방지조건완화", "Y")
        set_config_value(workbook, "최대연강허용", "4")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {
            "학급명": "1-1",
            "학년": "1",
            "계열": "공통",
            "담임교사명": "김교사",
            "요일별시수": "5",
            "가상학급여부": "N",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 5

        validation = validate_workbook(workbook)
        self.assertTrue(validation["ok"])
        result = solve_schedule(validation["records"])
        self.assertGreater(result["repairSummary"]["repairCandidateCount"], 0)
        self.assertLessEqual(len(result["candidates"]), 4)
        self.assertTrue(all(candidate["algorithm"] in {"cp-sat-metaheuristic", "metaheuristic-genetic", "greedy-seed"} for candidate in result["candidates"]))
        self.assertTrue(all(candidate["strategy"].startswith(("cp-sat", "ga-", "ai-")) for candidate in result["candidates"]))
        selected = result["selected"]
        self.assertTrue(selected["aiGenerated"])
        self.assertEqual(selected["unassigned"], [])
        relaxations = " / ".join(selected["relaxations"])
        self.assertIn("점심보호 해제", relaxations)
        self.assertIn("연강 4→5", relaxations)
        serialized = json.dumps(result["candidates"], ensure_ascii=False)
        self.assertNotIn("미배정 방지를 위해", serialized)
        self.assertNotIn("완화했습니다", serialized)

    def test_repair_candidates_respect_relaxation_opt_in(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "수업요일", "월")
        set_config_value(workbook, "일일최대교시", "5")
        set_config_value(workbook, "점심시간후교시", "4")
        set_config_value(workbook, "점심시간보호", "Y")
        set_config_value(workbook, "미배정방지조건완화", "N")
        set_config_value(workbook, "최대연강허용", "4")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {
            "학급명": "1-1",
            "학년": "1",
            "계열": "공통",
            "담임교사명": "김교사",
            "요일별시수": "5",
            "가상학급여부": "N",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 5

        validation = validate_workbook(workbook)
        result = solve_schedule(validation["records"], solve_options={"allowRelaxForUnassigned": "N", "iterations": 12})

        self.assertEqual(result["repairSummary"]["repairCandidateCount"], 0)
        self.assertTrue(all(not candidate.get("relaxations") for candidate in result["candidates"]))

    def test_unassigned_diagnostics_show_names_instead_of_codes(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "수업요일", "월")
        set_config_value(workbook, "일일최대교시", "1")
        set_config_value(workbook, "미배정방지조건완화", "N")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {
            "학급명": "1-1",
            "학년": "1",
            "계열": "공통",
            "담임교사명": "김교사",
            "요일별시수": "1",
            "가상학급여부": "N",
        })
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 2
        validation = validate_workbook(workbook)
        result = solve_schedule(validation["records"], solve_options={"allowRelaxForUnassigned": "N", "iterations": 12})
        selected = result["selected"]
        self.assertGreater(len(selected["unassigned"]), 0)
        diagnostic_text = json.dumps(selected["diagnostics"], ensure_ascii=False)
        self.assertIn("김교사", diagnostic_text)
        self.assertIn("국어", diagnostic_text)
        self.assertIn("1-1", diagnostic_text)
        self.assertNotIn("T001 S001 C001", diagnostic_text)

    def test_manual_move_result_is_saved_for_exports(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 1
        validation = validate_workbook(workbook)
        result = solve_schedule(validation["records"])
        selected = result["selected"]

        source = None
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                if selected["schedule"]["classes"]["C001"]["grid"][day][str(period)]:
                    source = {"classCode": "C001", "day": day, "period": period}
                    break
            if source:
                break
        self.assertIsNotNone(source)
        destination = {"day": "금", "period": 7}
        moved = move_schedule(validation["records"], selected["schedule"], {"from": source, "to": destination})
        save_moved_schedule_result(moved, {
            "strategy": selected["strategy"],
            "effectiveConfig": selected.get("effectiveConfig", {}),
            "relaxations": selected.get("relaxations", []),
            "move": {"from": source, "to": destination},
        })
        saved = app_module.load_last_schedule()
        self.assertTrue(saved["selected"]["manualEdited"])
        self.assertIsNotNone(saved["selected"]["schedule"]["classes"]["C001"]["grid"]["금"]["7"])

    def test_quick_move_options_rank_available_slots(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 2
        validation = validate_workbook(workbook)
        selected = solve_schedule(validation["records"])["selected"]
        grid = selected["schedule"]["classes"]["C001"]["grid"]
        source = None
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                if grid[day][str(period)]:
                    source = {"classCode": "C001", "day": day, "period": period}
                    break
            if source:
                break

        options = quick_move_options(validation["records"], selected["schedule"], source)
        self.assertTrue(options["ok"])
        self.assertGreater(len(options["options"]), 0)
        self.assertIn(options["options"][0]["grade"], {"good", "ok", "warn", "bad"})
        self.assertIn(options["options"][0]["mode"], {"move", "swap"})
        self.assertIn("teacherIssues", options)

    def test_move_preview_returns_teacher_before_after_without_saving(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 2
        validation = validate_workbook(workbook)
        selected = solve_schedule(validation["records"], solve_options={"iterations": 12})["selected"]
        source = None
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                if selected["schedule"]["classes"]["C001"]["grid"][day][str(period)]:
                    source = {"classCode": "C001", "day": day, "period": period}
                    break
            if source:
                break
        options = quick_move_options(validation["records"], selected["schedule"], source)
        option = options["options"][0]
        move = {"mode": option["mode"], "from": source, "to": {"day": option["day"], "period": option["period"]}}
        with patch.object(app_module, "save_last_schedule") as save_last_schedule:
            preview = move_preview(validation["records"], selected["schedule"], move)
        save_last_schedule.assert_not_called()
        self.assertIn("affectedTeachers", preview)
        self.assertGreaterEqual(len(preview["affectedTeachers"]), 1)
        self.assertIn("beforeCells", preview["affectedTeachers"][0])
        self.assertIn("afterCells", preview["affectedTeachers"][0])

    def test_quick_move_options_do_not_mark_existing_errors_as_new_bad_moves(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "1")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 2
        validation = validate_workbook(workbook)
        records = validation["records"]
        schedule = app_module.empty_schedule(records)
        entry = app_module.entry_for_load(records["loads"][0], records, 1)
        schedule["classes"]["C001"]["grid"]["월"]["1"] = dict(entry)
        schedule["classes"]["C001"]["grid"]["월"]["2"] = dict(entry)

        options = quick_move_options(records, schedule, {"classCode": "C001", "day": "월", "period": 1})
        self.assertTrue(options["ok"])
        self.assertTrue(any(item.get("newErrorCount", 0) == 0 and item["grade"] != "bad" for item in options["options"]))

    def test_duplicate_load_rows_are_validated_against_aggregate_hours(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "조혜란"})
        append_named_row(workbook, "학급-계열", {"학급명": "2-3", "학년": "2", "계열": "공통", "담임교사명": "조혜란", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "현윤", "단축명": "현윤", "NEIS과목명": "현윤"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "조혜란", "과목명": "현윤"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "조혜란", "과목명": "현윤"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "2-3"
        load_sheet.cell(row=load_sheet.max_row - 1, column=class_start).value = 3
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 3
        validation = validate_workbook(workbook)
        selected = solve_schedule(validation["records"], solve_options={"iterations": 12})["selected"]
        messages = [item["message"] for item in selected["validation"]["violations"] if item.get("type") == "load_mismatch"]
        self.assertNotIn("시수 3 중 6시간", " ".join(messages))

    def test_teacher_issue_summary_flags_bad_teacher_distribution(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간후교시", "4")
        set_config_value(workbook, "점심시간보호", "Y")
        set_config_value(workbook, "최대연강허용", "2")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 5
        validation = validate_workbook(workbook)
        records = validation["records"]
        schedule = app_module.empty_schedule(records)
        entry = app_module.entry_for_load(records["loads"][0], records, 1)
        for period in range(1, 6):
            schedule["classes"]["C001"]["grid"]["월"][str(period)] = dict(entry)

        issues = teacher_issue_summary(records, schedule, validate_schedule(records, schedule))
        tags = issues[0]["issues"]
        self.assertIn("안배", tags)
        self.assertIn("3연강", tags)
        self.assertIn("식사", tags)

    def test_manual_move_mode_controls_move_and_swap(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 2
        validation = validate_workbook(workbook)
        selected = solve_schedule(validation["records"])["selected"]
        occupied = []
        empty = None
        grid = selected["schedule"]["classes"]["C001"]["grid"]
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                ref = {"classCode": "C001", "day": day, "period": period}
                if grid[day][str(period)]:
                    occupied.append(ref)
                elif empty is None:
                    empty = ref
        self.assertGreaterEqual(len(occupied), 2)
        self.assertIsNotNone(empty)

        rejected_move = move_schedule(validation["records"], selected["schedule"], {"mode": "move", "from": occupied[0], "to": occupied[1]})
        self.assertFalse(rejected_move["ok"])
        rejected_swap = move_schedule(validation["records"], selected["schedule"], {"mode": "swap", "from": occupied[0], "to": empty})
        self.assertFalse(rejected_swap["ok"])
        swapped = move_schedule(validation["records"], selected["schedule"], {"mode": "swap", "from": occupied[0], "to": occupied[1]})
        self.assertTrue(swapped["ok"])
        self.assertIn("맞교환", swapped["message"])

    def test_manual_move_to_unknown_day_is_rejected_without_exception(self):
        workbook = create_template_workbook()
        set_config_value(workbook, "점심시간보호", "N")
        set_config_value(workbook, "최대연강허용", "7")
        append_named_row(workbook, "교사", {"교사명": "김교사"})
        append_named_row(workbook, "학급-계열", {"학급명": "1-1", "학년": "1", "계열": "공통", "담임교사명": "김교사", "가상학급여부": "N"})
        append_named_row(workbook, "과목", {"과목명": "국어", "단축명": "국", "NEIS과목명": "국어"})
        append_named_row(workbook, "교사별 시수표", {"교사명": "김교사", "과목명": "국어"})
        load_sheet = workbook["교사별 시수표"]
        class_start = len(SPECS_BY_NAME["교사별 시수표"]) + 1
        load_sheet.cell(row=1, column=class_start).value = "1-1"
        load_sheet.cell(row=load_sheet.max_row, column=class_start).value = 1
        validation = validate_workbook(workbook)
        result = solve_schedule(validation["records"])
        selected = result["selected"]
        source = None
        for day in selected["schedule"]["days"]:
            for period in selected["schedule"]["periods"]:
                if selected["schedule"]["classes"]["C001"]["grid"][day][str(period)]:
                    source = {"classCode": "C001", "day": day, "period": period}
                    break
            if source:
                break

        moved = move_schedule(validation["records"], selected["schedule"], {"from": source, "to": {"day": "일", "period": 1}})
        self.assertFalse(moved["ok"])
        self.assertNotIn("validation", moved)


    def test_operational_next_rebuild_scaffold_exists(self):
        package = json.loads((app_module.ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertIn("next", package["dependencies"])
        self.assertIn("exceljs", package["dependencies"])
        self.assertEqual(package["scripts"]["dev"], "next dev -p 8765")
        required_files = [
            "src/app/page.tsx",
            "src/app/layout.tsx",
            "src/components/OperationalApp.tsx",
            "src/lib/auth.ts",
            "src/lib/storage.ts",
            "src/solver/types.ts",
            "src/solver/workbook.ts",
            "src/solver/core.ts",
            "src/solver/aiClient.ts",
            "src/workers/solver.worker.ts",
            "src/app/api/imports/timetable-input/route.ts",
            "src/app/api/solve/jobs/route.ts",
            "src/app/api/solve/jobs/[id]/tick/route.ts",
            "src/app/api/solve/jobs/[id]/accept/route.ts",
            "src/app/api/ai/chat/route.ts",
            "src/app/api/schedules/[id]/move-preview/route.ts",
            "src/app/api/scenarios/[id]/route.ts",
        ]
        for relative in required_files:
            self.assertTrue((app_module.ROOT / relative).exists(), relative)
        page = (app_module.ROOT / "src/app/page.tsx").read_text(encoding="utf-8")
        self.assertIn('dynamic = "force-dynamic"', page)

    def test_operational_auth_and_internal_legacy_proxy_are_configured(self):
        auth = (app_module.ROOT / "src/lib/auth.ts").read_text(encoding="utf-8")
        proxy = (app_module.ROOT / "src/lib/legacyProxy.ts").read_text(encoding="utf-8")
        source = (app_module.ROOT / "legacy/legacy_app.py").read_text(encoding="utf-8")
        self.assertIn("ADMIN_EMAIL", auth)
        self.assertIn("ADMIN_PASSWORD_HASH", auth)
        self.assertIn("AUTH_SECRET", auth)
        self.assertIn("X-Internal-Auth", proxy)
        self.assertIn("legacy_internal_authorized", source)
        self.assertIn("hmac.compare_digest", source)

    def test_browser_solver_has_tabu_post_optimization(self):
        core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        types = (app_module.ROOT / "src/solver/types.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        self.assertIn("postOptimizeCandidate", core)
        self.assertIn("tabuKey", core)
        self.assertIn("tabu-post-optimize", types)
        self.assertIn("tabu-search", core)
        self.assertIn("후처리 최적화", core)
        self.assertIn("후처리 개선", ui)
        self.assertIn("postOptimizeSoftPenalty", ui)

    def test_browser_solver_has_chain_moves_continuous_patterns_and_day_limits(self):
        core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        types = (app_module.ROOT / "src/solver/types.ts").read_text(encoding="utf-8")
        workbook = (app_module.ROOT / "src/solver/workbook.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        styles = (app_module.ROOT / "src/app/globals.css").read_text(encoding="utf-8")
        self.assertIn("chainMoveOptions", core)
        self.assertIn("buildDisplacementChain", core)
        self.assertIn("classMaxPeriodForDay", core)
        self.assertIn("teacherDailyLoadRatio", core)
        self.assertIn("continuous-block", core)
        self.assertIn("continuousBlocks", types)
        self.assertIn("ManualMoveStep", types)
        self.assertIn("affectedTeachers", types)
        self.assertIn("parseContinuousBlocks", workbook)
        self.assertIn("연속패턴", workbook)
        self.assertIn("selectedManualFrom", ui)
        self.assertIn("수동수정 선택을 취소했습니다", ui)
        self.assertIn("chain-badge", styles)
        self.assertIn("no-class-time", styles)

    def test_browser_solver_has_ai_soft_repair_and_atomic_sync_moves(self):
        core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        types = (app_module.ROOT / "src/solver/types.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        worker = (app_module.ROOT / "src/workers/solver.worker.ts").read_text(encoding="utf-8")
        styles = (app_module.ROOT / "src/app/globals.css").read_text(encoding="utf-8")
        self.assertIn("MoveSubject", types)
        self.assertIn("MoveProposal", types)
        self.assertIn("AiRepairRecommendation", types)
        self.assertIn("repairOptions", core)
        self.assertIn("moveSubject", core)
        self.assertIn("cell.syncOccurrenceId ? cell.classCode", core)
        self.assertIn("repairApply", worker)
        self.assertIn("AI 보정안 찾기", ui)
        self.assertIn("maskedRepairPrompt", ui)
        self.assertIn("parseAiRepairRecommendation", ui)
        self.assertIn("autoRepairUsedRef", ui)
        self.assertIn("동시수업 전체 이동", ui)
        self.assertIn("repair-list", styles)

    def test_browser_solver_prioritizes_sync_groups_with_matching_and_beam(self):
        core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        self.assertIn("pickSyncOccurrence", core)
        self.assertIn("pickSyncOccurrenceVariants", core)
        self.assertIn("solveSyncGroupOccurrences", core)
        self.assertIn("syncCohortGroups", core)
        self.assertIn("placeSyncCohorts", core)
        self.assertIn("cohort sync pack", core)
        self.assertIn("greedySyncOccurrence", core)
        self.assertIn("placeSyncUnitsWithBeam", core)
        self.assertIn("syncBeamWidth", core)
        self.assertIn("tryRepairSyncUnit", core)
        self.assertIn("syncForwardPenalty", core)
        self.assertIn("sameSubjectSameDay: false", ui)
        self.assertIn("sync-first beam + relocation", core)
        self.assertIn("회차 내부 교사/특별실 중복", core)
        self.assertIn("공통 슬롯 부족", core)
        self.assertIn("공통 슬롯을 소진", core)

    def test_browser_worker_ai_flow_does_not_store_api_keys(self):
        storage = (app_module.ROOT / "src/lib/storage.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        worker = (app_module.ROOT / "src/workers/solver.worker.ts").read_text(encoding="utf-8")
        ai_client = (app_module.ROOT / "src/solver/aiClient.ts").read_text(encoding="utf-8")
        workbook = (app_module.ROOT / "src/solver/workbook.ts").read_text(encoding="utf-8")
        solver_core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        solver_types = (app_module.ROOT / "src/solver/types.ts").read_text(encoding="utf-8")
        scenario_route = (app_module.ROOT / "src/app/api/scenarios/route.ts").read_text(encoding="utf-8")
        scenario_item_route = (app_module.ROOT / "src/app/api/scenarios/[id]/route.ts").read_text(encoding="utf-8")
        storage = (app_module.ROOT / "src/lib/storage.ts").read_text(encoding="utf-8")
        template_route = (app_module.ROOT / "src/app/api/templates/timetable-input/route.ts").read_text(encoding="utf-8")
        start_route = (app_module.ROOT / "src/app/api/solve/jobs/route.ts").read_text(encoding="utf-8")
        tick_route = (app_module.ROOT / "src/app/api/solve/jobs/[id]/tick/route.ts").read_text(encoding="utf-8")
        self.assertIn("apikey", storage.lower())
        self.assertIn("new Worker", ui)
        self.assertIn("validateClientAiKey", ui)
        self.assertIn("aiValidationLoading", ui)
        self.assertIn("검증 중...", ui)
        self.assertIn("ImportIssuesPanel", ui)
        self.assertIn("파일 읽기 오류", ui)
        self.assertIn("downloadTemplate", ui)
        self.assertIn("handleWorkbookDrop", ui)
        self.assertIn("handleWorkbookFile", ui)
        self.assertIn("handleProjectFile", ui)
        self.assertIn("handleProjectDrop", ui)
        self.assertIn("PROJECT_FILE_FORMAT", ui)
        self.assertIn(".aitimetable.json", ui)
        self.assertIn("saveProjectFile", ui)
        self.assertIn("generateAiText", ui)
        self.assertIn("parseWorkbookBuffer", ui)
        self.assertIn("selectWorkbookFile", ui)
        self.assertIn("fileBuffer", ui)
        self.assertIn("solveLoopActiveRef", ui)
        self.assertIn("chunkInFlightRef", ui)
        self.assertIn("scheduleNextSolveChunk", ui)
        self.assertIn("candidateRef.current", ui)
        self.assertIn("LOCAL_SCENARIOS_KEY", ui)
        self.assertIn("saveScenario", ui)
        self.assertIn("refreshScenarioList", ui)
        self.assertIn("loadScenario", ui)
        self.assertIn("새 작업 만들기", ui)
        self.assertIn("저장된 시간표 불러오기", ui)
        self.assertIn("저장 필요", ui)
        self.assertNotIn("window.setInterval(() => workerRef.current?.postMessage", ui)
        self.assertIn("postMessage", worker)
        self.assertIn("acceptBest", worker)
        self.assertIn("VALIDATION_TIMEOUT_MS = 15000", ai_client)
        self.assertIn("AbortController", ai_client)
        self.assertIn("friendlyHttpError", ai_client)
        self.assertIn("maxConcurrent: 1", ai_client)
        self.assertIn("minIntervalMs: 6000", ai_client)
        self.assertIn("Retry-After", ai_client)
        self.assertIn("makeBatches", ai_client)
        self.assertIn("eachRow", workbook)
        self.assertIn("parseWorkbookBuffer", workbook)
        self.assertIn("buildWorkUnits", solver_core)
        self.assertIn("forward-checking", solver_core)
        self.assertIn("tryDisplaceClassCell", solver_core)
        self.assertIn("tryDisplaceTeacherCell", solver_core)
        self.assertIn("hard-safe-local-search", solver_core)
        self.assertIn("teacher-conflict", solver_core)
        self.assertIn("bottleneck-csp", solver_types)
        self.assertIn("saveTimetableScenario", storage)
        self.assertIn("listTimetableScenarios", storage)
        self.assertIn("deleteTimetableScenario", storage)
        self.assertIn("records jsonb", storage)
        self.assertIn("server storage unavailable", scenario_route)
        self.assertIn("saveTimetableScenario", scenario_route)
        self.assertNotIn("proxyLegacyRequest", scenario_route)
        self.assertIn("deleteTimetableScenario", scenario_item_route)
        self.assertIn("getTimetableScenario", scenario_item_route)
        self.assertIn("exceljs", template_route)
        self.assertIn("Content-Disposition", template_route)
        self.assertIn("작성 예시 영역", template_route)
        self.assertIn('"비고"', template_route)
        self.assertIn('spec.name === "기본설정"', template_route)
        self.assertNotIn("proxyLegacyRequest", template_route)
        self.assertIn("browser-worker", start_route)
        self.assertIn("browser-worker", tick_route)
        self.assertNotIn("proxyLegacyJson", start_route)
        self.assertNotIn("proxyLegacyJson", tick_route)

    def test_browser_solver_ai_approval_filters_and_same_day_scope(self):
        core = (app_module.ROOT / "src/solver/core.ts").read_text(encoding="utf-8")
        types = (app_module.ROOT / "src/solver/types.ts").read_text(encoding="utf-8")
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        styles = (app_module.ROOT / "src/app/globals.css").read_text(encoding="utf-8")
        self.assertIn('aiRepairApplyMode?: "approval"', types)
        self.assertIn('lunchProtectionLevel?: "off" | "normal" | "high" | "hard"', types)
        self.assertIn('consecutiveStrictMode?: "off" | "three-plus" | "over-max"', types)
        self.assertIn("subjectSameDayScope(cell.syncGroup)", core)
        self.assertIn("wouldCreateHardConsecutive", core)
        self.assertIn("wouldCreateHardLunch", core)
        self.assertIn("consecutiveRuns(periods, warnThreshold)", core)
        self.assertIn("current.length >= threshold", core)
        self.assertIn("lunchProtectionLevel === \"hard\"", core)
        self.assertIn("isRepairExecutionIntent", ui)
        self.assertIn("runAiRepair(\"chat\", candidate)", ui)
        self.assertIn("openRepairPreview(best)", ui)
        self.assertIn("renderIssueFilterControls", ui)
        self.assertIn("filteredTeacherIssues", ui)
        self.assertIn("visibleManualTeacherCode", ui)
        self.assertIn("점심시간 확보 강도", ui)
        self.assertIn("3연강 처리", ui)
        self.assertIn("연쇄수정 최대 깊이", ui)
        self.assertIn("AI 수정 적용", ui)
        self.assertIn("cellLabel(cell)", ui)
        self.assertIn("탐색이 중지되었습니다", ui)
        self.assertIn(".filter-row", styles)

    def test_vercel_config_uses_next_without_python_function_detection(self):
        config = json.loads((app_module.ROOT / "vercel.json").read_text(encoding="utf-8"))
        self.assertNotIn("functions", config)
        self.assertFalse((app_module.ROOT / "api" / "index.py").exists())
        rewrites = json.dumps(config.get("rewrites", []), ensure_ascii=False)
        self.assertNotIn("/:path*", rewrites)

    def test_operational_ui_exposes_relaxation_as_explicit_opt_in_and_kst(self):
        ui = (app_module.ROOT / "src/components/OperationalApp.tsx").read_text(encoding="utf-8")
        login_route = (app_module.ROOT / "src/app/api/auth/login/route.ts").read_text(encoding="utf-8")
        ai_route = (app_module.ROOT / "src/app/api/ai/chat/route.ts").read_text(encoding="utf-8")
        self.assertIn("Asia/Seoul", ui)
        self.assertIn("allowRelaxation", ui)
        self.assertIn("allowRelaxForUnassigned", ui)
        self.assertIn("allowRelaxation ? \"Y\"", ui)
        self.assertIn("조건 완화 미리보기", ui)
        self.assertIn("API 키는 브라우저 메모리에만 보관", ui)
        self.assertIn("Vercel 서버는 계산하지 않습니다", ui)
        self.assertIn("429", ui)
        self.assertIn('method="post"', ui)
        self.assertIn('action="/api/auth/login"', ui)
        self.assertIn('name="email"', ui)
        self.assertIn('name="password"', ui)
        self.assertIn("browser-direct-ai", ai_route)
        self.assertIn("application/x-www-form-urlencoded", login_route)
        self.assertIn("Response.redirect", login_route)


if __name__ == "__main__":
    unittest.main()
