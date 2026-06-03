import json
import os
import unittest
from collections import defaultdict
from unittest.mock import patch

import app as app_module
from app import SPECS_BY_NAME, ai_chat, create_template_workbook, move_schedule, parse_days, quick_move_options, routed_request_path, save_moved_schedule_result, solve_schedule, teacher_balance_penalty, teacher_issue_summary, validate_ai_key, validate_schedule, validate_workbook


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
        self.assertIn("response.scheduleResult", script)
        self.assertIn("applyScheduleResult(response.scheduleResult", script)
        self.assertIn("document.addEventListener(\"keydown\", handleQuickEditKeydown)", script)
        self.assertNotIn("유전탐색", script)

    def test_vercel_python_entrypoints_are_declared(self):
        api_index = (app_module.ROOT / "api" / "index.py").read_text(encoding="utf-8")
        vercel_config = json.loads((app_module.ROOT / "vercel.json").read_text(encoding="utf-8"))
        self.assertIs(app_module.handler, app_module.AppHandler)
        self.assertIn("class handler(AppHandler)", api_index)
        self.assertEqual(vercel_config["rewrites"][0]["destination"], "/api?__path=")
        self.assertEqual(vercel_config["rewrites"][1]["destination"], "/api?__path=:path*")
        self.assertNotIn("functions", vercel_config)
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
        self.assertEqual(result["solver"]["algorithm"], "metaheuristic-genetic")
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
        self.assertTrue(response["scheduleAction"]["applied"])
        self.assertIn("scheduleResult", response)
        self.assertIn("selected", response["scheduleResult"])
        self.assertEqual(response["scheduleResult"]["selected"]["unassigned"], [])

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
        self.assertTrue(all(candidate["algorithm"] == "metaheuristic-genetic" for candidate in result["candidates"]))
        self.assertTrue(all(candidate["strategy"].startswith("ga-") for candidate in result["candidates"]))
        selected = result["selected"]
        self.assertTrue(selected["aiGenerated"])
        self.assertEqual(selected["unassigned"], [])
        relaxations = " / ".join(selected["relaxations"])
        self.assertIn("점심보호 해제", relaxations)
        self.assertIn("연강 4→5", relaxations)
        serialized = json.dumps(result["candidates"], ensure_ascii=False)
        self.assertNotIn("미배정 방지를 위해", serialized)
        self.assertNotIn("완화했습니다", serialized)

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


if __name__ == "__main__":
    unittest.main()
