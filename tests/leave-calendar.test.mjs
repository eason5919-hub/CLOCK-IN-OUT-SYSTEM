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
  assert.match(script, /monthCalendar\(records, leaveRequests, corrections, historyDate, currentMonthDate\)/);
  assert.match(script, /attendanceTable\(historyRecords, true, historyDate, corrections\)/);
  assert.match(script, /function employeeAttendanceHeader/);
  assert.match(script, /<th>Date<\/th><th>Clock In<\/th><th>Clock Out<\/th><th>OT<\/th><th>GPS<\/th>/);
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
  assert.doesNotMatch(css, /\.calendar[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("employee month dashboard can show current and previous month only", async () => {
  const [script, indexHtml] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);

  assert.match(script, /let selectedEmployeeMonthKey = employeeMonthKey\(malaysiaToday\(\)\)/);
  assert.match(indexHtml, /script\.js\?v=20260805-cancel-correction/);
  assert.match(script, /data-employee-month/);
  assert.match(script, /function currentEmployeeMonthKey/);
  assert.match(script, /function previousEmployeeMonthKey/);
  assert.match(script, /normalizedEmployeeMonthKey/);
  assert.match(script, /selectedHistoryDate =/);
  assert.match(script, /let showAllEmployeeCorrections = false/);
  assert.match(script, /const visibleCorrections = correctionsForMonth\(corrections, selectedEmployeeMonthKey\)/);
  assert.match(script, /const correctionDateRange = monthDateRange\(selectedEmployeeMonthKey\)/);
  assert.match(script, /const correctionDateValue = correctionDateInMonth\(historyDate, selectedEmployeeMonthKey\)/);
  assert.match(script, /min="\$\{correctionDateRange\.start\}" max="\$\{correctionDateRange\.end\}" value="\$\{correctionDateValue\}"/);
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

test("employee leave requests use one date-range calendar and limit closed cards without reordering", async () => {
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
  assert.match(script, /closedShown <= 5/);
  assert.match(script, /\["cancelled", "rejected"\]/);
  assert.doesNotMatch(script, /cancelledRequests\.slice/);
  assert.match(css, /\.calendar-day\.is-in-range/);
  assert.doesNotMatch(css, /\.date-range-fields/);
});

test("employee correction metric counts pending requests only", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /corrections: pendingCorrectionCount\(corrections\)/);
  assert.match(script, /function pendingCorrectionCount/);
  assert.match(script, /correction\.status === "Pending"/);
  assert.match(script, /const canCancel = correction\.status === "Pending"/);
  assert.match(script, /data-cancel-correction="\$\{correction\.id\}"/);
  assert.match(script, /Cancel this correction request\?/);
  assert.match(script, /action: "cancel"/);
  assert.match(script, /correctionId: button\.dataset\.cancelCorrection/);
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
});
