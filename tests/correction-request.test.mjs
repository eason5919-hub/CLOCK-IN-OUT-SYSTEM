import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("correction requests save Malaysia time and clock-out approvals target open rows", async () => {
  const [script, employeeRoute, employeeSummaryRoute, adminRoute, adminHtml, css] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/corrections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/live/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../HR ADMIN LIVE.html", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /`\$\{date\}T\$\{time\}:00\+08:00`/);
  assert.match(employeeRoute, /function findTargetAttendanceForCorrection/);
  assert.match(employeeRoute, /clock_in_at IS NOT NULL AND clock_out_at IS NULL/);
  assert.match(employeeRoute, /ORDER BY clock_in_at DESC, updated_at DESC/);
  assert.doesNotMatch(employeeRoute, /SELECT \* FROM attendance WHERE employee_id = \? AND work_date = \?"/);
  assert.match(employeeSummaryRoute, /source, created_at, updated_at/);
  assert.match(employeeSummaryRoute, /WITH report_days AS/);
  assert.match(employeeSummaryRoute, /report_rows AS/);
  assert.match(employeeSummaryRoute, /source = 'admin_report_edit'/);
  assert.match(employeeSummaryRoute, /MIN\(clock_in_at\) AS clock_in_at/);
  assert.match(employeeSummaryRoute, /MAX\(clock_out_at\) AS clock_out_at/);
  assert.match(employeeSummaryRoute, /SUM\(COALESCE\(total_minutes, 0\)\) AS total_minutes/);
  assert.match(employeeSummaryRoute, /UNION ALL/);
  assert.match(employeeSummaryRoute, /work_date NOT IN \(SELECT work_date FROM report_days\)/);
  assert.match(employeeSummaryRoute, /ORDER BY work_date DESC, updated_at DESC/);
  assert.match(employeeSummaryRoute, /created_at, reviewed_at/);
  assert.match(script, /sort\(compareAttendanceLatest\)/);
  assert.match(script, /function attendanceEditMarks/);
  assert.match(script, /function approvedCorrectionForField/);
  assert.match(script, /function attendanceDisplayTimes/);
  assert.match(script, /isSameOrNewer\(correction\.reviewedAt \|\| correction\.createdAt, row\.updatedAt \|\| row\.createdAt\)/);
  assert.match(script, /if \(row\.source === "admin_report_edit"\)/);
  assert.match(script, /clockOut: correctedOut \? "corrected" : row\.clockOut \? "edited" : ""/);
  assert.match(script, /const display = attendanceDisplayTimes\(row, corrections\)/);
  assert.match(script, /class="time-mark corrected"/);
  assert.match(css, /\.time-mark\.edited/);
  assert.match(css, /\.time-mark\.corrected/);
  assert.match(adminRoute, /const existingRecord = await findTargetAttendanceForCorrection\(db, correction\)/);
  assert.match(adminRoute, /action: "save_report_attendance_times"/);
  assert.match(adminRoute, /source = 'admin_report_edit'/);
  assert.match(adminRoute, /function reportTimeSegments/);
  assert.match(adminRoute, /monthly_report_time_edit/);
  assert.match(adminRoute, /monthly_report_time_restore/);
  assert.match(adminRoute, /SET attendance_id = \?, status = \?/);
  assert.match(adminRoute, /let reviewedAttendanceId = correction\.attendance_id/);
  assert.match(adminHtml, /function approvedCorrectionTimes/);
  assert.match(adminHtml, /const clockOut = approved\.find\(item => item\.requested_clock_out_at\)/);
  assert.match(adminHtml, /clockOut: clockOut\?\.requested_clock_out_at \|\| ""/);
  assert.match(adminHtml, /const lastOut = correctionOutWins \? approvedTimes\.clockOut : outTimes\[outTimes\.length - 1\] \|\| ""/);
  assert.match(adminHtml, /manualEdit/);
  assert.match(adminHtml, /correctedTime/);
  assert.match(adminHtml, /function reportCorrectionWins/);
  assert.match(adminHtml, /function isSameOrNewer/);
  assert.match(adminHtml, /const correctionInWins = Boolean\(approvedTimes\.clockIn\) && isSameOrNewer\(approvedTimes\.clockInReviewedAt, reportUpdatedAt\)/);
  assert.match(adminHtml, /const correctionOutWins = Boolean\(approvedTimes\.clockOut\) && isSameOrNewer\(approvedTimes\.clockOutReviewedAt, reportUpdatedAt\)/);
  assert.match(adminHtml, /class="highlightTime"/);
  assert.match(adminHtml, /function reportPaidWorkMinutes/);
  assert.match(adminHtml, /function normalizeReportTime/);
  assert.match(adminHtml, /function calculatedReportValues/);
  assert.match(adminHtml, /function isEditableReportField/);
  assert.match(adminHtml, /function reportHasTimeEdit/);
  assert.match(adminHtml, /if \(!isEditableReportField\(field\)\) return fallback/);
  assert.match(adminHtml, /if \(reportCorrectionWins\(employeeId, dateKey, field\)\) return fallback/);
  assert.match(adminHtml, /const manualEdit = editableField && !correctionWins && Object\.prototype\.hasOwnProperty\.call\(monthlyReportEdits, key\)/);
  assert.match(adminHtml, /if \(!isEditableReportField\(field\)\)/);
  assert.match(adminHtml, /const restoreRows = \[\.\.\.reportRows\.keys\(\)\]/);
  assert.match(adminHtml, /const liveRows = \[\.\.\.timeRows, \.\.\.restoreRows\]/);
  assert.match(adminHtml, /action: "save_report_attendance_times"/);
  assert.match(adminHtml, /action: "restore_report_attendance_times"/);
  assert.match(adminHtml, /row\.source === "admin_report_edit"/);
  assert.match(adminHtml, /REPORT_TIME_FIELDS = new Set\(\["in", "break", "resume", "out"\]\)/);
  assert.match(adminHtml, /contenteditable="\$\{editable \? "true" : "false"\}"/);
  assert.match(adminHtml, /refreshReportRow\(cell\.closest\("tr"\), false\)/);
  assert.match(adminHtml, /refreshReportRow\(cell\.closest\("tr"\), true\)/);
  assert.match(adminHtml, /function originalReportValue/);
  assert.match(adminHtml, /const regularSpan = Math\.max\(0, Math\.round/);
  assert.match(adminHtml, /const breakDeduction = day >= 1 && day <= 5 && regularSpan > 300 \? 60 : 0/);
  assert.match(adminHtml, /const regularCap = day === 6 \? 240 : 480/);
  assert.match(adminHtml, /Math\.min\(Math\.max\(0, regularSpan - breakDeduction\), regularCap\) \+ overtime/);
  assert.match(adminHtml, /const outMs = Date\.parse\(attendanceRow\.clockOut \|\| ""\)/);
  assert.match(adminHtml, /Math\.round\(\(endMs - outMs\) \/ 60000\)/);
  assert.doesNotMatch(adminHtml, /Math\.max\(0, end - outMinutes\)/);
  assert.match(adminHtml, /20260804-no-stale-calculated-report/);
  assert.doesNotMatch(adminHtml, /<th>Sche<\/th>/);
  assert.doesNotMatch(adminHtml, /<th>Diff OT<\/th>/);
  assert.doesNotMatch(adminHtml, /editableReportCell\(employee\.id, dateKey, "schedule"/);
  assert.doesNotMatch(adminHtml, /editableReportCell\(employee\.id, dateKey, "diffOt"/);
});
