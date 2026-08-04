import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("correction requests save Malaysia time and clock-out approvals target open rows", async () => {
  const [script, employeeRoute, adminRoute, adminHtml] = await Promise.all([
    readFile(new URL("../script.js", import.meta.url), "utf8"),
    readFile(new URL("../app/api/corrections/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/admin/live/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../HR ADMIN LIVE.html", import.meta.url), "utf8"),
  ]);

  assert.match(script, /`\$\{date\}T\$\{time\}:00\+08:00`/);
  assert.match(employeeRoute, /function findTargetAttendanceForCorrection/);
  assert.match(employeeRoute, /clock_in_at IS NOT NULL AND clock_out_at IS NULL/);
  assert.match(employeeRoute, /ORDER BY clock_in_at DESC, updated_at DESC/);
  assert.doesNotMatch(employeeRoute, /SELECT \* FROM attendance WHERE employee_id = \? AND work_date = \?"/);
  assert.match(adminRoute, /const existingRecord = await findTargetAttendanceForCorrection\(db, correction\)/);
  assert.match(adminRoute, /SET attendance_id = \?, status = \?/);
  assert.match(adminRoute, /let reviewedAttendanceId = correction\.attendance_id/);
  assert.match(adminHtml, /function approvedCorrectionTimes/);
  assert.match(adminHtml, /clockOut: approved\.find\(item => item\.requested_clock_out_at\)\?\.requested_clock_out_at/);
  assert.match(adminHtml, /const lastOut = approvedTimes\.clockOut \|\| outTimes\[outTimes\.length - 1\] \|\| ""/);
  assert.match(adminHtml, /function reportPaidWorkMinutes/);
  assert.match(adminHtml, /const regularCap = day === 6 \? 240 : 480/);
  assert.match(adminHtml, /Math\.min\(Math\.max\(0, elapsed - overtime\), regularCap\) \+ overtime/);
  assert.match(adminHtml, /20260804-paid-work-report/);
});
