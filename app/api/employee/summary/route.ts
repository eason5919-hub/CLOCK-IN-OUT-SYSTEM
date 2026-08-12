import { ensureDatabase, getD1, getSessionFromRequest } from "../../../../db/runtime";
import {
  approvedCorrectionMatchesField,
  parseAttendanceTimestamp,
  reconcileAttendanceRows,
  type AttendanceRow,
} from "../../../../db/attendance-reconciliation";

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
    const device = await db
      .prepare("SELECT id FROM devices WHERE employee_id = ? AND status = 'registered'")
      .bind(session.employee_id)
      .first<{ id: string }>();
    if (!device) {
      return json(request, { error: "Employee phone access was deleted by HR." }, 401);
    }
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
  const attendanceRows = reconcileAttendanceRows((rawAttendance.results || []) as AttendanceRow[]).map((row) => ({
    ...row,
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
