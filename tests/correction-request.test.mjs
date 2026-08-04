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
  assert.match(employeeSummaryRoute, /ORDER BY work_date DESC, updated_at DESC/);
  assert.match(employeeSummaryRoute, /created_at, reviewed_at/);
  assert.match(script, /sort\(compareAttendanceLatest\)/);
  assert.match(script, /function attendanceEditMarks/);
  assert.match(script, /row\.source === "admin_adjustment"/);
  assert.match(script, /class="time-mark corrected"/);
  assert.match(css, /\.time-mark\.edited/);
  assert.match(css, /\.time-mark\.corrected/);
  assert.match(adminRoute, /const existingRecord = await findTargetAttendanceForCorrection\(db, correction\)/);
  assert.match(adminRoute, /SET attendance_id = \?, status = \?/);
  assert.match(adminRoute, /let reviewedAttendanceId = correction\.attendance_id/);
  assert.match(adminHtml, /function approvedCorrectionTimes/);
  assert.match(adminHtml, /clockOut: approved\.find\(item => item\.requested_clock_out_at\)\?\.requested_clock_out_at/);
  assert.match(adminHtml, /const lastOut = approvedTimes\.clockOut \|\| outTimes\[outTimes\.length - 1\] \|\| ""/);
  assert.match(adminHtml, /manualEdit/);
  assert.match(adminHtml, /correctedTime/);
  assert.match(adminHtml, /class="highlightTime"/);
  assert.match(adminHtml, /function reportPaidWorkMinutes/);
  assert.match(adminHtml, /function normalizeReportTime/);
  assert.match(adminHtml, /function calculatedReportValues/);
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
  assert.match(adminHtml, /20260804-overnight-short-report/);
  assert.doesNotMatch(adminHtml, /<th>Sche<\/th>/);
  assert.doesNotMatch(adminHtml, /<th>Diff OT<\/th>/);
  assert.doesNotMatch(adminHtml, /editableReportCell\(employee\.id, dateKey, "schedule"/);
  assert.doesNotMatch(adminHtml, /editableReportCell\(employee\.id, dateKey, "diffOt"/);
});
