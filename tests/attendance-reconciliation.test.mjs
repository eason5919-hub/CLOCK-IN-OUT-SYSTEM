import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

async function loadReconciliation() {
  const source = await readFile(new URL("../db/attendance-reconciliation.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const file = join(tmpdir(), `attendance-reconciliation-${process.pid}-${Date.now()}.mjs`);
  await writeFile(file, output);
  return import(pathToFileURL(file).href);
}

const baseRow = {
  id: "base-1",
  employee_id: "employee-1",
  employee_code: "WH-001",
  work_date: "2026-08-09",
  clock_in_at: "2026-08-09T02:00:00.000Z",
  clock_out_at: "2026-08-09T04:00:00.000Z",
  clock_in_accuracy: 12,
  clock_in_distance_meters: 8,
  total_minutes: 120,
  late_minutes: 0,
  early_leave_minutes: 0,
  overtime_minutes: 120,
  source: "qr_gps",
  created_at: "2026-08-09 04:00:00",
  updated_at: "2026-08-09 04:00:00",
};

test("newer report segments resolve to one day with break and resume", async () => {
  const { reconcileAttendanceDay } = await loadReconciliation();
  const rows = [
    baseRow,
    {
      ...baseRow,
      id: "report-1",
      clock_in_at: "2026-08-09T01:00:00.000Z",
      clock_out_at: "2026-08-09T03:00:00.000Z",
      total_minutes: 120,
      overtime_minutes: 120,
      source: "admin_report_edit",
      updated_at: "2026-08-09 05:00:00",
    },
    {
      ...baseRow,
      id: "report-2",
      clock_in_at: "2026-08-09T04:00:00.000Z",
      clock_out_at: "2026-08-09T06:00:00.000Z",
      total_minutes: 120,
      overtime_minutes: 120,
      source: "admin_report_edit",
      updated_at: "2026-08-09 05:00:00",
    },
  ];

  const resolved = reconcileAttendanceDay(rows);
  assert.equal(resolved.clock_in_at, "2026-08-09T01:00:00.000Z");
  assert.equal(resolved.break_at, "2026-08-09T03:00:00.000Z");
  assert.equal(resolved.resume_at, "2026-08-09T04:00:00.000Z");
  assert.equal(resolved.clock_out_at, "2026-08-09T06:00:00.000Z");
  assert.equal(resolved.overtime_minutes, 240);
  assert.equal(resolved.report_segments_effective, 1);
  assert.equal(resolved.clock_in_accuracy, 12);
  assert.equal(resolved.clock_in_distance_meters, 8);
});

test("a newer open base punch clears stale report out and break fields", async () => {
  const { reconcileAttendanceDay } = await loadReconciliation();
  const reportRows = [
    { ...baseRow, id: "report-1", source: "admin_report_edit", updated_at: "2026-08-09 05:00:00" },
    {
      ...baseRow,
      id: "report-2",
      clock_in_at: "2026-08-09T05:00:00.000Z",
      clock_out_at: "2026-08-09T06:00:00.000Z",
      source: "admin_report_edit",
      updated_at: "2026-08-09 05:00:00",
    },
  ];
  const openBase = {
    ...baseRow,
    id: "base-open",
    clock_in_at: "2026-08-09T07:00:00.000Z",
    clock_out_at: null,
    source: "qr_gps",
    updated_at: "2026-08-09 07:00:00",
  };

  const resolved = reconcileAttendanceDay([...reportRows, openBase]);
  assert.equal(resolved.clock_in_at, openBase.clock_in_at);
  assert.equal(resolved.clock_out_at, null);
  assert.equal(resolved.break_at, null);
  assert.equal(resolved.resume_at, null);
  assert.equal(resolved.report_segments_effective, 0);
  assert.equal(resolved.overtime_minutes, 0);
});

test("blank field overrides win deterministic timestamp ties", async () => {
  const { reconcileAttendanceDay } = await loadReconciliation();
  const report = {
    ...baseRow,
    id: "report",
    source: "admin_report_edit",
    updated_at: "2026-08-09 05:00:00",
  };
  const blankOut = {
    ...baseRow,
    id: "override",
    clock_in_at: null,
    clock_out_at: null,
    source: "admin_report_edit_out",
    updated_at: "2026-08-09 05:00:00",
  };

  const resolved = reconcileAttendanceDay([baseRow, report, blankOut]);
  assert.equal(resolved.clock_in_at, report.clock_in_at);
  assert.equal(resolved.clock_out_at, null);
  assert.equal(resolved.report_edited_clock_out, 1);
  assert.equal(resolved.overtime_minutes, 0);
});

test("reconciliation returns one ordered row per employee and date", async () => {
  const { reconcileAttendanceRows } = await loadReconciliation();
  const rows = reconcileAttendanceRows([
    baseRow,
    { ...baseRow, id: "employee-2", employee_id: "employee-2", employee_code: "WH-002" },
    { ...baseRow, id: "new-date", work_date: "2026-08-10" },
  ]);

  assert.equal(rows.length, 3);
  assert.equal(rows[0].work_date, "2026-08-10");
  assert.deepEqual(rows.slice(1).map((row) => row.employee_code), ["WH-001", "WH-002"]);
});
