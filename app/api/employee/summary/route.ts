import { ensureDatabase, getD1, getSessionFromRequest, restoreEmployeeDevice } from "../../../../db/runtime";
import {
  approvedCorrectionMatchesField,
  parseAttendanceTimestamp,
  reconcileAttendanceRows,
  type AttendanceRow,
} from "../../../../db/attendance-reconciliation";

const TIME_ZONE = "Asia/Kuala_Lumpur";

export async function GET(request: Request) {
  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (session?.role !== "employee" || !session.employee_id) {
    return json(request, { error: "Employee login is required." }, 401);
  }

  const employee = await db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.department_id, e.position, e.phone,
              e.leave_entitlement_days,
              COALESCE(leave_totals.taken_days, 0) AS leave_taken_days,
              (e.leave_entitlement_days - COALESCE(leave_totals.taken_days, 0)) AS leave_remaining_days,
              d.device_model, d.status AS device_status
       FROM employees e
       LEFT JOIN devices d ON d.employee_id = e.id AND d.status = 'registered'
       LEFT JOIN (
         SELECT employee_id,
                SUM(CASE duration WHEN 'half_day' THEN 0.5 ELSE 1 END) AS taken_days
         FROM leave_requests
         WHERE status = 'approved' AND leave_type = 'leave'
         GROUP BY employee_id
       ) leave_totals ON leave_totals.employee_id = e.id
       WHERE e.id = ? AND e.status = 'active'`,
    )
    .bind(session.employee_id)
    .first<Record<string, string | null>>();

  if (!employee) {
    return json(request, { error: "Employee account was deleted by HR." }, 401);
  }

  const deviceFingerprint = request.headers.get("x-device-fingerprint")?.trim();
  if (deviceFingerprint) {
    await restoreEmployeeDevice(db, employee, deviceFingerprint, String(employee.device_model || "Restored phone session"));
  }

  const [rawAttendance, corrections, leaveRequests] = await Promise.all([
    db
      .prepare(
        `SELECT *
         FROM attendance
         WHERE employee_id = ? AND source <> 'admin_report_edit_archived'
         ORDER BY work_date DESC, datetime(updated_at) DESC, datetime(created_at) DESC, id DESC`,
      )
      .bind(session.employee_id)
      .all(),
    db
      .prepare(
        `SELECT id, requested_date, missing_type, requested_clock_in_at, requested_clock_out_at, reason, status,
                original_record_json, created_at, reviewed_at
         FROM attendance_corrections
         WHERE employee_id = ?
         ORDER BY COALESCE(reviewed_at, created_at) DESC, created_at DESC`,
      )
      .bind(session.employee_id)
      .all(),
    db
      .prepare(
        `SELECT id, leave_type, leave_date, duration, reason, status, admin_note, created_at
         FROM leave_requests
         WHERE employee_id = ?
         ORDER BY COALESCE(reviewed_at, created_at) DESC, created_at DESC`,
      )
      .bind(session.employee_id)
      .all(),
  ]);

  const correctionRows = (corrections.results || []) as AttendanceRow[];
  const approvedHalfLeaveDates = approvedHalfLeaveDateSet((leaveRequests.results || []) as AttendanceRow[]);
  const attendanceRows = reconcileAttendanceRows((rawAttendance.results || []) as AttendanceRow[]).map((row) => ({
    ...row,
    report_short_minutes: reportShortMinutes(row, approvedHalfLeaveDates),
    report_clock_in_mark: reportClockMark(row, "clock_in", correctionRows),
    report_clock_out_mark: reportClockMark(row, "clock_out", correctionRows),
  }));
  const attendanceByDate = new Map(attendanceRows.map((row) => [String(row.work_date || ""), row]));
  const correctionsWithReportTimes = correctionRows.map((row) => {
    const reportRow = attendanceByDate.get(String(row.requested_date || ""));
    return {
      ...row,
      report_clock_in_at: reportRow?.clock_in_at || null,
      report_clock_out_at: reportRow?.clock_out_at || null,
    };
  });

  return json(request, {
    employee,
    attendance: attendanceRows,
    corrections: correctionsWithReportTimes,
    leaveRequests: leaveRequests.results,
  });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function reportClockMark(row: AttendanceRow, field: "clock_in" | "clock_out", corrections: AttendanceRow[]) {
  const dateKey = String(row.work_date || "");
  const valueKey = field === "clock_in" ? "clock_in_at" : "clock_out_at";
  const editedKey = field === "clock_in" ? "report_edited_clock_in" : "report_edited_clock_out";
  const requestKey = field === "clock_in" ? "requested_clock_in_at" : "requested_clock_out_at";
  const correction = corrections
    .filter((item) => (
      String(item.requested_date || "") === dateKey &&
      String(item.status || "").toLowerCase() === "approved" &&
      Boolean(item[requestKey])
    ))
    .sort((left, right) => (
      parseAttendanceTimestamp(String(right.reviewed_at || right.created_at || "")) -
      parseAttendanceTimestamp(String(left.reviewed_at || left.created_at || ""))
    ))[0];

  if (correction && approvedCorrectionMatchesField(row, correction, field)) return "corrected";
  return Number(row[editedKey] || 0) && row[valueKey] ? "edited" : "";
}

function approvedHalfLeaveDateSet(rows: AttendanceRow[]) {
  return new Set(
    rows
      .filter((row) => (
        String(row.status || "").toLowerCase() === "approved" &&
        String(row.duration || "").toLowerCase() === "half_day"
      ))
      .map((row) => String(row.leave_date || "")),
  );
}

function reportShortMinutes(row: AttendanceRow, approvedHalfLeaveDates: Set<string>) {
  const dateKey = String(row.work_date || "");
  const day = localDayOfWeek(dateKey);
  if (!row.clock_in_at || day === 0) return 0;

  const inMinutes = malaysiaClockMinutes(String(row.clock_in_at));
  if (inMinutes == null) return 0;

  const start = 9 * 60;
  const end = day === 6 ? 13 * 60 : 18 * 60;
  let lateShort = Math.max(0, inMinutes - start);
  if (inMinutes <= start + 10) lateShort = 0;

  if (approvedHalfLeaveDates.has(dateKey)) {
    if (day === 6) return 0;
    const workShort = Math.max(0, 240 - reportWorkingWindowMinutes(row, day));
    return Math.min(240, workShort);
  }

  const outMs = parseAttendanceTimestamp(String(row.clock_out_at || ""));
  const endMs = Date.parse(`${dateKey}T${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00+08:00`);
  const earlyOut = outMs && !Number.isNaN(endMs) ? Math.max(0, Math.round((endMs - outMs) / 60000)) : 0;
  const requiredMinutes = day === 6 ? 240 : 480;
  const actualMinutes = reportPaidWorkMinutes(row, day);
  const workShort = Math.max(0, requiredMinutes - actualMinutes);
  return Math.min(requiredMinutes, Math.max(lateShort, earlyOut, workShort));
}

function reportPaidWorkMinutes(row: AttendanceRow, day: number) {
  if (!row.clock_in_at || !row.clock_out_at) return 0;
  const elapsed = Math.max(0, Math.round((parseAttendanceTimestamp(String(row.clock_out_at)) - parseAttendanceTimestamp(String(row.clock_in_at))) / 60000));
  if (!elapsed) return 0;
  if (day === 0) return elapsed;

  const overtime = reportOvertimeFromTimes(row, day);
  const cap = day === 6 ? 240 : 480;
  if (row.break_at && row.resume_at) {
    const segmentTotal = Math.max(0, Math.round((parseAttendanceTimestamp(String(row.break_at)) - parseAttendanceTimestamp(String(row.clock_in_at))) / 60000)) +
      Math.max(0, Math.round((parseAttendanceTimestamp(String(row.clock_out_at)) - parseAttendanceTimestamp(String(row.resume_at))) / 60000));
    return Math.min(Math.max(0, segmentTotal - overtime), cap) + overtime;
  }

  const end = day === 6 ? 13 * 60 : 18 * 60;
  const inMs = parseAttendanceTimestamp(String(row.clock_in_at));
  const outMs = parseAttendanceTimestamp(String(row.clock_out_at));
  const regularStartMs = regularWindowStartMs(String(row.work_date || ""), inMs);
  const regularEndMs = Date.parse(`${String(row.work_date || "")}T${String(Math.floor((end + 15) / 60)).padStart(2, "0")}:${String((end + 15) % 60).padStart(2, "0")}:00+08:00`);
  const regularSpan = Math.max(0, Math.round((Math.min(outMs, regularEndMs) - regularStartMs) / 60000));
  const breakDeduction = day >= 1 && day <= 5 && regularSpan >= 300 ? 60 : 0;
  return Math.min(Math.max(0, regularSpan - breakDeduction), cap) + overtime;
}

function reportWorkingWindowMinutes(row: AttendanceRow, day: number) {
  if (!row.clock_in_at || !row.clock_out_at || day === 0) return 0;
  const dateKey = String(row.work_date || "");
  const inMs = parseAttendanceTimestamp(String(row.clock_in_at));
  const outMs = parseAttendanceTimestamp(String(row.clock_out_at));
  if (!dateKey || Number.isNaN(inMs) || Number.isNaN(outMs)) return 0;
  const end = day === 6 ? 13 * 60 : 18 * 60;
  const startMs = regularWindowStartMs(dateKey, inMs);
  const endMs = Date.parse(`${dateKey}T${String(Math.floor((end + 15) / 60)).padStart(2, "0")}:${String((end + 15) % 60).padStart(2, "0")}:00+08:00`);
  return Math.max(0, Math.round((Math.min(outMs, endMs) - startMs) / 60000));
}

function reportOvertimeFromTimes(row: AttendanceRow, day: number) {
  if (!row.clock_out_at) return 0;
  const clockInMs = parseAttendanceTimestamp(String(row.clock_in_at || ""));
  const clockOutMs = parseAttendanceTimestamp(String(row.clock_out_at || ""));
  if (!clockInMs || !clockOutMs || clockOutMs <= clockInMs) return 0;
  if (day === 0) return Math.max(0, Math.round((clockOutMs - clockInMs) / 60000));

  const dateKey = String(row.work_date || "");
  const end = day === 6 ? 13 * 60 : 18 * 60;
  const earlyOtStartMs = Date.parse(`${dateKey}T08:00:00+08:00`);
  const normalEndMs = Date.parse(`${dateKey}T${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}:00+08:00`);
  const lateOtStartMs = normalEndMs + 16 * 60000;
  const earlyOt = clockInMs < earlyOtStartMs ? Math.max(0, Math.round((earlyOtStartMs - clockInMs) / 60000)) : 0;
  const lateOt = clockOutMs >= lateOtStartMs ? Math.max(0, Math.round((clockOutMs - Math.max(clockInMs, normalEndMs)) / 60000)) : 0;
  return earlyOt + lateOt;
}

function regularWindowStartMs(dateKey: string, clockInMs: number) {
  const startMs = Date.parse(`${dateKey}T09:00:00+08:00`);
  const earlyStartMs = Date.parse(`${dateKey}T08:00:00+08:00`);
  const graceEndMs = startMs + 10 * 60000;
  return clockInMs >= earlyStartMs && clockInMs <= graceEndMs ? startMs : Math.max(clockInMs, earlyStartMs);
}

function malaysiaClockMinutes(value: string) {
  const timestamp = parseAttendanceTimestamp(value);
  if (!timestamp) return null;
  const date = new Date(timestamp);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function localDayOfWeek(dateKey: string) {
  return new Date(`${dateKey}T12:00:00+08:00`).getUTCDay();
}

function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": requestHeaders || "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
