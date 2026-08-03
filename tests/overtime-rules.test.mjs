import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadCalculations() {
  const source = await readFile(new URL("../db/attendance-calculations.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const file = join(tmpdir(), `attendance-calculations-${process.pid}-${Date.now()}.mjs`);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(file, output));
  return import(pathToFileURL(file).href);
}

test("weekday overtime uses grace for eligibility and scheduled end for counting", async () => {
  const { calculateAttendanceTotals, calculateOvertimeMinutes } = await loadCalculations();
  const weekday = {
    start_time: "09:00",
    end_time: "18:00",
    overtime_starts_at: "18:16",
    is_off_day: 0,
  };

  assert.equal(calculateOvertimeMinutes("2026-08-03T09:00:00+08:00", "2026-08-03T18:10:00+08:00", weekday), 0);
  assert.equal(calculateOvertimeMinutes("2026-08-03T09:00:00+08:00", "2026-08-03T18:15:00+08:00", weekday), 0);
  assert.equal(calculateOvertimeMinutes("2026-08-03T09:00:00+08:00", "2026-08-03T18:16:00+08:00", weekday), 16);
  assert.equal(calculateOvertimeMinutes("2026-08-03T09:00:00+08:00", "2026-08-03T18:30:00+08:00", weekday), 30);
  assert.equal(calculateOvertimeMinutes("2026-08-03T09:00:00+08:00", "2026-08-03T19:00:00+08:00", weekday), 60);
  assert.equal(calculateAttendanceTotals("2026-08-03T09:15:00+08:00", "2026-08-03T18:00:00+08:00", weekday).lateMinutes, 0);
  assert.equal(calculateAttendanceTotals("2026-08-03T09:16:00+08:00", "2026-08-03T18:00:00+08:00", weekday).lateMinutes, 16);
  assert.equal(calculateAttendanceTotals("2026-08-03T08:00:00+08:00", "2026-08-03T18:00:00+08:00", weekday).overtimeMinutes, 0);
  assert.equal(calculateAttendanceTotals("2026-08-03T07:59:00+08:00", "2026-08-03T18:00:00+08:00", weekday).overtimeMinutes, 1);
  assert.equal(calculateAttendanceTotals("2026-08-07T09:00:00+08:00", "2026-08-08T07:00:00+08:00", weekday).overtimeMinutes, 780);
});

test("saturday and sunday overtime rules are applied", async () => {
  const { calculateOvertimeMinutes } = await loadCalculations();
  const saturday = {
    start_time: "09:00",
    end_time: "13:00",
    overtime_starts_at: "13:16",
    is_off_day: 0,
  };
  const sunday = {
    start_time: null,
    end_time: null,
    overtime_starts_at: null,
    is_off_day: 1,
  };

  assert.equal(calculateOvertimeMinutes("2026-08-08T09:00:00+08:00", "2026-08-08T13:15:00+08:00", saturday), 0);
  assert.equal(calculateOvertimeMinutes("2026-08-08T09:00:00+08:00", "2026-08-08T13:16:00+08:00", saturday), 16);
  assert.equal(calculateOvertimeMinutes("2026-08-01T09:00:00+08:00", "2026-08-02T07:00:00+08:00", saturday), 1080);
  assert.equal(calculateOvertimeMinutes("2026-08-09T10:00:00+08:00", "2026-08-09T12:30:00+08:00", sunday), 150);
});

test("warehouse work date and weekday use Malaysia time", async () => {
  const { localDayOfWeek, localWorkDate } = await loadCalculations();

  assert.equal(localWorkDate("2026-08-03T16:30:00.000Z"), "2026-08-04");
  assert.equal(localDayOfWeek("2026-08-03T16:30:00.000Z"), 2);
});

test("open attendance stays active only until next day 08:00 Malaysia time", async () => {
  const { isOpenAttendanceStillActive } = await loadCalculations();

  assert.equal(isOpenAttendanceStillActive("2026-08-01", "2026-08-01T23:30:00+08:00"), true);
  assert.equal(isOpenAttendanceStillActive("2026-08-01", "2026-08-02T07:59:00+08:00"), true);
  assert.equal(isOpenAttendanceStillActive("2026-08-01", "2026-08-02T08:00:00+08:00"), false);
  assert.equal(isOpenAttendanceStillActive("2026-08-01", "2026-08-03T07:59:00+08:00"), false);
});
