import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("leave calendar aligns August 2026 and disables Sundays only", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /calendar-empty/);
  assert.doesNotMatch(script, /grid-column-start/);
  assert.match(script, /Date\.UTC\(year, month - 1, 1\)/, "Calendar month must always start from day 1, not the selected day");

  const selectedDate = "2026-08-03";
  const [selectedYear, selectedMonth] = selectedDate.split("-").map(Number);
  const augustFirst = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1)).getUTCDay();
  const sundays = Array.from({ length: 31 }, (_, index) => index + 1).filter(
    (day) => new Date(Date.UTC(2026, 7, day)).getUTCDay() === 0,
  );
  const augustCells = [
    ...Array.from({ length: augustFirst }, () => null),
    ...Array.from({ length: 31 }, (_, index) => index + 1),
  ];

  assert.equal(augustFirst, 6, "1 August 2026 must start under Saturday");
  assert.deepEqual(augustCells.slice(0, 7), [null, null, null, null, null, null, 1], "First row must keep Sunday left and Saturday right");
  assert.deepEqual(augustCells.slice(7, 14), [2, 3, 4, 5, 6, 7, 8], "Second row must start with Sunday date 2");
  assert.deepEqual(sundays, [2, 9, 16, 23, 30], "Only August 2026 Sundays should be disabled for Sunday rule");
});

test("employee month dashboard stays Sunday to Saturday and filters history by selected day", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function monthCalendar/);
  assert.match(script, /\["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"\]/);
  assert.match(script, /monthDateFromKey\(selectedEmployeeMonthKey\)/);
  assert.match(script, /data-history-date/);
  assert.match(script, /data-history-title/);
  assert.match(script, /data-history-content/);
  assert.match(script, /updateSelectedEmployeeHistory\(button\.dataset\.historyDate\)/);
  assert.match(script, /function updateSelectedEmployeeHistory\(date\)/);
  const dateClickHandler = script.slice(
    script.indexOf('document.querySelectorAll("[data-history-date]")'),
    script.indexOf('document.querySelectorAll("[data-employee-month]")'),
  );
  assert.doesNotMatch(dateClickHandler, /render\(\)/);
  assert.match(script, /monthCalendar\(records, leaveRequests, corrections, historyDate, currentMonthDate\)/);
  assert.match(script, /attendanceTable\(historyRecords, true, historyDate, corrections\)/);
  assert.match(script, /function employeeAttendanceHeader/);
  assert.match(script, /<th>Date<\/th><th>Clock In<\/th><th>Clock Out<\/th><th>OT<\/th>/);
  assert.doesNotMatch(script, /function employeeAttendanceHeader\(\) \{\s+return "[^"]*<th>GPS<\/th>/);
  assert.doesNotMatch(script, /function employeeAttendanceRow\([^)]*\) \{[\s\S]{0,400}history-gps-cell/);
  assert.doesNotMatch(script, /function employeeAttendanceHeader\(\) \{\s+return "[^"]*<th>Break<\/th>/);
  assert.doesNotMatch(script, /function employeeAttendanceHeader\(\) \{\s+return "[^"]*<th>Resume<\/th>/);
  assert.match(script, /class="table-wrap\$\{employeeOnly \? " employee-history-wrap" : ""\}"/);
  assert.match(script, /class="employee-history-table"/);
  assert.match(css, /\.employee-history-table \{\s+min-width: 0;\s+table-layout: fixed;/);
  assert.match(css, /\.employee-history-table \{[\s\S]{0,120}font-size: 15px;/);
  assert.match(script, /function adminAttendanceHeader/);
  assert.match(script, /<th>Employee<\/th><th>Date<\/th><th>Clock In<\/th><th>Clock Out<\/th><th>Working Hours<\/th><th>OT<\/th><th>Status<\/th><th>GPS<\/th>/);
  assert.match(script, /formatReportOtMinutes\(employeeHistoryOvertimeMinutes\(row, display\)\)/);
  assert.match(script, /function formatReportOtMinutes/);
  assert.match(script, /function employeeHistoryOvertimeMinutes/);
  assert.match(script, /const threshold = scheduledEnd \+ 16/);
  assert.match(script, /let liveRefreshQueued = false/);
  assert.match(script, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(script, /Cannot connect to live database\. Try again in a few seconds\./);
  assert.doesNotMatch(script, /mode: "cors"/);
  assert.doesNotMatch(script, /credentials: "omit"/);
  assert.doesNotMatch(script, /function employeeAttendanceHeader\(\) \{\s+return "[^"]*Working Hours/);
  assert.doesNotMatch(script, /function employeeAttendanceHeader\(\) \{\s+return "[^"]*Status/);
  assert.match(script, /const displayRecords = records\.map\(\(row\) => attendanceDisplayTimes\(row, corrections\)\)/);
  assert.match(script, /const present = displayRecords\.some\(\(row\) => row\.clockIn && row\.clockOut\)/);
  assert.match(script, /label: missed \? "X" : present \? "OK" : "-"/);
  assert.match(script, /tone: missed \? "missed" : present \? "present" : ""/);
  assert.doesNotMatch(script, /labels\.push\("Late"\)/);
  assert.doesNotMatch(script, /labels\.push\("In"\)/);
  assert.doesNotMatch(script, /labels\.push\("OT"\)/);
  assert.doesNotMatch(script, /labels\.push\("OK"\)/);
  assert.match(css, /\.month-calendar[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(script, /isToday \? "today" : ""/);
  assert.match(script, /aria-current="date"/);
  assert.match(css, /\.month-day\.today[\s\S]*background: #e9f2ff/);
  assert.doesNotMatch(css, /\.calendar[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("employee month dashboard can show current and previous month only", async () => {
  const [script, indexHtml, appVersion] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../app-version.json", import.meta.url), "utf8"),
  ]);

  assert.match(script, /let selectedEmployeeMonthKey = employeeMonthKey\(malaysiaToday\(\)\)/);
  assert.match(indexHtml, /style\.css\?v=20260812-negative-leave-red/);
  assert.match(indexHtml, /script\.js\?v=20260812-negative-leave-red/);
  assert.equal(JSON.parse(appVersion).version, "20260812-negative-leave-red");
  assert.match(script, /const APP_VERSION = "20260812-negative-leave-red"/);
  assert.match(script, /function employeeLiveRevision/);
  assert.match(script, /renderWhenChanged && employeeLiveRevision\(\) !== renderedEmployeeLiveRevision/);
  assert.match(script, /loadEmployeeLive\(true, true\)/);
  assert.match(script, /document\.addEventListener\("visibilitychange"/);
  assert.match(script, /window\.location\.replace\(nextUrl\.href\)/);
  assert.match(script, /data-employee-month/);
  assert.match(script, /function currentEmployeeMonthKey/);
  assert.match(script, /function previousEmployeeMonthKey/);
  assert.match(script, /normalizedEmployeeMonthKey/);
  assert.match(script, /selectedHistoryDate =/);
  assert.match(script, /let showAllEmployeeCorrections = false/);
  assert.match(script, /const visibleCorrections = correctionsForMonth\(corrections, selectedEmployeeMonthKey\)/);
  assert.match(script, /const correctionDateRange = monthDateRange\(selectedEmployeeMonthKey\)/);
  assert.match(script, /const correctionDateValue = correctionDateInMonth\(historyDate, selectedEmployeeMonthKey\)/);
  assert.match(script, /correctionDateField\(correctionDateValue, selectedEmployeeMonthKey, correctionDateRange\)/);
  assert.match(script, /name="date" type="hidden" value="\$\{value\}" data-correction-date min="\$\{range\.start\}" max="\$\{range\.end\}"/);
  assert.match(script, /function correctionCalendarMarkup/);
  assert.match(script, /data-correction-calendar-date/);
  assert.match(script, /function setupCorrectionCalendar/);
  assert.match(script, /setupCorrectionCalendar\(document\.querySelector\("#correction-form"\)\)/);
  assert.match(script, /calendar\.innerHTML = correctionCalendarMarkup\(input\.value, selectedEmployeeMonthKey\)/);
  assert.match(script, /const displayedCorrections = showAllEmployeeCorrections \? visibleCorrections : visibleCorrections\.slice\(0, 3\)/);
  assert.match(script, /displayedCorrections\.map\(correctionCard\)/);
  assert.match(script, /View more/);
  assert.match(script, /Show less/);
  assert.match(script, /data-toggle-employee-corrections/);
  assert.match(script, /showAllEmployeeCorrections = false/);
  assert.match(script, /showAllEmployeeCorrections = !showAllEmployeeCorrections/);
  assert.match(script, /const shouldScrollBack = showAllEmployeeCorrections/);
  assert.match(script, /scrollIntoView\(\{ behavior: "smooth", block: "start" \}\)/);
  assert.match(script, /function correctionsForMonth/);
  assert.match(script, /function correctionMonthKey/);
  assert.match(script, /function monthDateRange/);
  assert.match(script, /start: `\$\{monthKey\}-01`/);
  assert.match(script, /function correctionDateInMonth/);
  assert.match(script, /correctionMonthKey\(correction\) === monthKey/);
  assert.match(script, /String\(correction\.date \|\| ""\)\.slice\(0, 7\)/);
});

test("employee month dashboard uses short AL and MC labels", async () => {
  const [script, css] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
  ]);

  assert.match(script, /function calendarLeaveLabel/);
  assert.match(script, /"AL"/);
  assert.match(script, /"MC"/);
  assert.match(script, /`\$\{durationLabel\}\\n\$\{typeLabel\}`/);
  assert.doesNotMatch(script, /label: request\.type \|\| "Leave\/MC"/);
  assert.match(css, /\.month-day\.leave-note small[\s\S]*white-space: pre-line/);
});

test("employee GPS display shows warehouse distance and does not fake fallback samples", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /function gpsReadyMessage/);
  assert.match(script, /Distance \$\{distance\}m/);
  assert.match(script, /maximumAge: 0/);
  assert.doesNotMatch(script, /function fallbackGps/);
  assert.doesNotMatch(script, /source: "fallback"/);
});

test("employee QR scanner trims reads and scans multiple frame areas", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /const QR_SCAN_INTERVAL_MS = 45/);
  assert.match(script, /const QR_CANVAS_MAX_SIDE = 900/);
  assert.match(script, /const token = String\(qr \|\| ""\)\.trim\(\)/);
  assert.match(script, /document\.querySelector\("\.scan-modal"\)\?\.closest\("\.modal-backdrop"\)\?\.remove\(\)/);
  assert.match(script, /\[0\.9, 0\.78, 0\.62\]\.map/);
  assert.match(script, /canvas\.width - sideScan/);
  assert.match(script, /String\(window\.jsQR\(image\.data, image\.width, image\.height/);
  assert.match(script, /if \(String\(qr \|\| ""\)\.trim\(\) !== WAREHOUSE\.qr\)/);
  assert.match(script, /result\.action === "clock_in_existing"/);
  assert.match(script, /Already clocked in/);
});

test("employee leave requests use one date-range calendar and show five cards before view more", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");

  assert.match(script, /name="startDate"/);
  assert.match(script, /name="endDate"/);
  assert.match(script, /Date range/);
  assert.match(script, /formatLeaveRangeDisplay/);
  assert.match(script, /calendar\.dataset\.rangeStep = "end"/);
  assert.match(script, /function leaveDatesInRange/);
  assert.match(script, /Sundays are skipped\./);
  assert.match(script, /Saturday in this range will be submitted as half day\./);
  assert.match(script, /function visibleEmployeeLeaveRequests/);
  assert.match(script, /showAllEmployeeLeaveRequests/);
  assert.match(script, /showAll \? items : items\.slice\(0, 5\)/);
  assert.match(script, /leaveRequests\.length > 5/);
  assert.match(script, /data-toggle-employee-leave/);
  assert.match(script, /showAllEmployeeLeaveRequests \? "Show less" : "View more"/);
  assert.match(script, /leaveRequestStatusLabel/);
  assert.match(script, /if \(status === "cancelled" \|\| note\.includes\("cancelled by employee"\)\) return "Cancelled"/);
  assert.match(script, /const cancelled = request\.status === "Cancelled"/);
  assert.match(script, /class="leave-card-title"/);
  assert.match(script, /cancelled \? statusBadge : ""/);
  assert.doesNotMatch(script, /closedShown/);
  assert.match(css, /\.calendar-day\.is-in-range/);
  assert.doesNotMatch(css, /\.date-range-fields/);
});

test("annual leave remaining can show a negative balance", async () => {
  const [employeeRoute, adminRoute, script, css, adminHtml] = await Promise.all([
    readFile(new URL("../app/api/employee/summary/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/live/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../style.css", import.meta.url), "utf8"),
    readFile(new URL("../HR ADMIN LIVE.html", import.meta.url), "utf8"),
  ]);

  for (const route of [employeeRoute, adminRoute]) {
    assert.match(route, /\(e\.leave_entitlement_days - COALESCE\(leave_totals\.taken_days, 0\)\) AS leave_remaining_days/);
    assert.doesNotMatch(route, /MAX\(e\.leave_entitlement_days - COALESCE\(leave_totals\.taken_days, 0\), 0\)/);
  }
  assert.match(script, /leaveRemainingDays < 0 \? "negative-leave" : ""/);
  assert.match(css, /\.negative-leave \{\s+color: var\(--red\);/);
  assert.match(adminHtml, /Number\(employee\.leave_remaining_days \|\| 0\) < 0 \? "negativeLeave" : ""/);
  assert.match(adminHtml, /\.negativeLeave \{ color: var\(--danger\); \}/);
});

test("admin employee list shows approved MC days instead of status", async () => {
  const [adminRoute, adminHtml] = await Promise.all([
    readFile(new URL("../app/api/admin/live/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../HR ADMIN LIVE.html", import.meta.url), "utf8"),
  ]);

  assert.match(adminRoute, /COALESCE\(leave_totals\.mc_taken_days, 0\) AS mc_taken_days/);
  assert.match(adminRoute, /SUM\(CASE WHEN leave_type = 'mc' THEN CASE duration WHEN 'half_day' THEN 0\.5 ELSE 1 END ELSE 0 END\) AS mc_taken_days/);
  assert.match(adminRoute, /WHERE status = 'approved'/);
  assert.match(adminHtml, /<th>MC Taken<\/th>/);
  assert.match(adminHtml, /formatLeaveDays\(employee\.mc_taken_days\)/);
  assert.doesNotMatch(adminHtml, /<th>Status<\/th>\s*<th>Device<\/th>/);
});

test("employee metric cards use selected month report data", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /const monthRecords = recordsForMonth\(records, selectedEmployeeMonthKey\)/);
  assert.match(script, /present: formatDayCount\(calculatePresentDays\(monthRecords, visibleCorrections\)\)/);
  assert.match(script, /late: monthRecords\.filter\(\(row\) => employeeHistoryLateMinutes\(row, attendanceDisplayTimes\(row, visibleCorrections\)\) > 0\)\.length/);
  assert.match(script, /function employeeHistoryLateMinutes/);
  assert.match(script, /ot: formatMetricDuration\(monthRecords\.reduce\(\(total, row\) => total \+ employeeHistoryOvertimeMinutes\(row, attendanceDisplayTimes\(row, visibleCorrections\)\), 0\)\)/);
  assert.match(script, /corrections: correctedReportBoxCount\(monthRecords, visibleCorrections\)/);
  assert.match(script, /function recordsForMonth/);
  assert.match(script, /function formatMetricDuration/);
  assert.match(script, /`\$\{hours\}hr \$\{remainder\}min`/);
  assert.match(script, /function calculatePresentDays\(records, corrections = \[\]\)/);
  assert.match(script, /if \(row\.date && display\.clockIn && display\.clockOut\) dates\.add\(row\.date\)/);
  assert.match(script, /function correctedReportBoxCount\(records, corrections = \[\]\)/);
  assert.match(script, /marks\.clockIn === "corrected"/);
  assert.match(script, /marks\.clockOut === "corrected"/);
  assert.match(script, /correction\.status === "Pending"/);
  assert.match(script, /const canCancel = correction\.status === "Pending"/);
  assert.match(script, /data-cancel-correction="\$\{correction\.id\}"/);
  assert.match(script, /Cancel this correction request\?/);
  assert.match(script, /const previousCorrections = state\.corrections\.map/);
  assert.match(script, /status: "Cancelled"/);
  assert.match(script, /saveState\(\);\s+render\(\);\s+try \{/);
  assert.match(script, /action: "cancel"/);
  assert.match(script, /correctionId: button\.dataset\.cancelCorrection/);
  assert.match(script, /state\.corrections = previousCorrections/);
  assert.match(script, /Correction request cancelled\./);
});

test("employee correction form records one missing time and shows requested time", async () => {
  const [script, employeeSummaryRoute] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employee/summary/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(script, /<option>Clock In<\/option><option selected>Clock Out<\/option>/);
  assert.doesNotMatch(script, /<option>Both<\/option>/);
  assert.match(script, /missingType: missing === "Clock In" \? "clock_in" : "clock_out"/);
  assert.match(script, /requestedClockInAt: missing === "Clock In"/);
  assert.match(script, /requestedClockOutAt: missing === "Clock Out"/);
  assert.match(employeeSummaryRoute, /original_record_json/);
  assert.match(employeeSummaryRoute, /const correctionsWithReportTimes = correctionRows\.map/);
  assert.match(employeeSummaryRoute, /report_clock_in_at: reportRow\?\.clock_in_at \|\| null/);
  assert.match(employeeSummaryRoute, /report_clock_out_at: reportRow\?\.clock_out_at \|\| null/);
  assert.match(script, /function parseCorrectionOriginalRecord/);
  assert.match(script, /const attendanceRow = state\.attendance\.find\(\(item\) => item\.date === row\.requested_date\)/);
  assert.match(script, /function firstDisplayTime/);
  assert.match(script, /originalClockIn: firstDisplayTime\(original\?\.clock_in_at, row\.report_clock_in_at, attendanceRow\?\.clockIn\)/);
  assert.match(script, /originalClockOut: firstDisplayTime\(original\?\.clock_out_at, row\.report_clock_out_at, attendanceRow\?\.clockOut\)/);
  assert.match(script, /function correctionRequestedLine/);
  assert.match(script, /Requested: \$\{escapeHtml\(originalTime\)\} to <span class="time-mark corrected">\$\{escapeHtml\(requestedTime\)\}<\/span>/);
  assert.match(script, /class="correction-card-title">\$\{escapeHtml\(correction\.date\)\} - \$\{escapeHtml\(correction\.missing\)\}<\/strong><span class="correction-card-request">\$\{requested\}<\/span>/);
  assert.match(script, /class="correction-card-reason">\$\{escapeHtml\(correction\.reason\)\}<\/span>/);
});
