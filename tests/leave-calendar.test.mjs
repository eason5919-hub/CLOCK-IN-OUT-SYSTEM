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
  assert.match(script, /new Date\(Date\.UTC\(todayDate\.getUTCFullYear\(\), todayDate\.getUTCMonth\(\), 1\)\)/);
  assert.match(script, /data-history-date/);
  assert.match(script, /attendanceTable\(historyRecords, true, historyDate\)/);
  assert.match(script, /labels\.join\(" "\)/);
  assert.match(script, /hasLate\) labels\.push\("Late"\)/);
  assert.match(script, /hasOpenToday\) labels\.push\("In"\)/);
  assert.match(script, /hasMissingOut\) labels\.push\("Missed"\)/);
  assert.match(script, /hasOt\) labels\.push\("OT"\)/);
  assert.match(css, /\.month-calendar[\s\S]*grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /\.calendar[\s\S]*repeat\(4, minmax\(0, 1fr\)\)/);
});

test("employee GPS display shows warehouse distance and does not fake fallback samples", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");

  assert.match(script, /function gpsReadyMessage/);
  assert.match(script, /Distance \$\{distance\}m/);
  assert.match(script, /maximumAge: 0/);
  assert.doesNotMatch(script, /function fallbackGps/);
  assert.doesNotMatch(script, /source: "fallback"/);
});

test("employee leave requests use date range and only limit cancelled cards", async () => {
  const script = await readFile(new URL("../script.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../style.css", import.meta.url), "utf8");

  assert.match(script, /name="startDate"/);
  assert.match(script, /name="endDate"/);
  assert.match(script, /function leaveDatesInRange/);
  assert.match(script, /Sundays are skipped\./);
  assert.match(script, /Saturday in this range will be submitted as half day\./);
  assert.match(script, /function visibleEmployeeLeaveRequests/);
  assert.match(script, /cancelledRequests\.slice\(0, 3\)/);
  assert.match(script, /activeRequests\.push\(request\)/);
  assert.match(css, /\.date-range-fields/);
});
