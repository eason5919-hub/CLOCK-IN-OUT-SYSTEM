import { ensureDatabase, getD1, getSessionFromRequest } from "../../../../db/runtime";

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
              MAX(e.leave_entitlement_days - COALESCE(leave_totals.taken_days, 0), 0) AS leave_remaining_days,
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
      .prepare("SELECT id, device_fingerprint FROM devices WHERE employee_id = ? AND status = 'registered'")
      .bind(session.employee_id)
      .first<{ id: string; device_fingerprint: string }>();

    if (!device) {
      return json(request, { error: "Employee phone access was deleted by HR." }, 401);
    }
  }

  const attendance = await db
    .prepare(
      `WITH base_rows AS (
         SELECT MIN(id) AS id,
                work_date,
                MIN(clock_in_at) AS clock_in_at,
                MAX(clock_out_at) AS clock_out_at,
                SUM(COALESCE(total_minutes, 0)) AS total_minutes,
                MAX(COALESCE(late_minutes, 0)) AS late_minutes,
                MAX(COALESCE(early_leave_minutes, 0)) AS early_leave_minutes,
                SUM(COALESCE(overtime_minutes, 0)) AS overtime_minutes,
                CASE
                  WHEN MAX(COALESCE(late_minutes, 0)) > 0 THEN 'late'
                  WHEN MAX(COALESCE(early_leave_minutes, 0)) > 0 THEN 'early_leave'
                  WHEN SUM(COALESCE(overtime_minutes, 0)) > 0 THEN 'ot'
                  ELSE 'present'
                END AS status,
                MAX(clock_in_accuracy) AS clock_in_accuracy,
                MAX(clock_in_distance_meters) AS clock_in_distance_meters,
                MAX(clock_out_accuracy) AS clock_out_accuracy,
                MAX(clock_out_distance_meters) AS clock_out_distance_meters,
                MAX(source) AS source,
                MIN(created_at) AS created_at,
                MAX(updated_at) AS updated_at
         FROM attendance
         WHERE employee_id = ? AND source NOT LIKE 'admin_report_edit%'
         GROUP BY work_date
       ),
       report_rows AS (
         SELECT MIN(id) AS id,
                work_date,
                MIN(clock_in_at) AS clock_in_at,
                MAX(clock_out_at) AS clock_out_at,
                SUM(COALESCE(total_minutes, 0)) AS total_minutes,
                MAX(COALESCE(late_minutes, 0)) AS late_minutes,
                MAX(COALESCE(early_leave_minutes, 0)) AS early_leave_minutes,
                SUM(COALESCE(overtime_minutes, 0)) AS overtime_minutes,
                CASE
                  WHEN MAX(COALESCE(late_minutes, 0)) > 0 THEN 'late'
                  WHEN MAX(COALESCE(early_leave_minutes, 0)) > 0 THEN 'early_leave'
                  WHEN SUM(COALESCE(overtime_minutes, 0)) > 0 THEN 'ot'
                  ELSE 'present'
                END AS status,
                MAX(clock_in_accuracy) AS clock_in_accuracy,
                MAX(clock_in_distance_meters) AS clock_in_distance_meters,
                MAX(clock_out_accuracy) AS clock_out_accuracy,
                MAX(clock_out_distance_meters) AS clock_out_distance_meters,
                'admin_report_edit' AS source,
                MIN(created_at) AS created_at,
                MAX(updated_at) AS updated_at,
                MIN(CASE WHEN clock_in_at IS NOT NULL THEN updated_at END) AS clock_in_updated_at,
                MAX(CASE WHEN clock_out_at IS NOT NULL THEN updated_at END) AS clock_out_updated_at
         FROM attendance
         WHERE employee_id = ? AND source = 'admin_report_edit'
         GROUP BY work_date
       ),
       field_overrides AS (
         SELECT MIN(id) AS id,
                work_date,
                MAX(CASE WHEN source = 'admin_report_edit_in' THEN 1 ELSE 0 END) AS has_clock_in_override,
                MAX(CASE WHEN source = 'admin_report_edit_in' THEN clock_in_at END) AS override_clock_in_at,
                MAX(CASE WHEN source = 'admin_report_edit_in' THEN updated_at END) AS clock_in_override_updated_at,
                MAX(CASE WHEN source = 'admin_report_edit_out' THEN 1 ELSE 0 END) AS has_clock_out_override,
                MAX(CASE WHEN source = 'admin_report_edit_out' THEN clock_out_at END) AS override_clock_out_at,
                MAX(CASE WHEN source = 'admin_report_edit_out' THEN updated_at END) AS clock_out_override_updated_at,
                MIN(created_at) AS created_at,
                MAX(updated_at) AS updated_at
         FROM attendance
         WHERE employee_id = ? AND source IN ('admin_report_edit_in', 'admin_report_edit_out')
         GROUP BY work_date
       ),
       day_keys AS (
         SELECT work_date FROM base_rows
         UNION
         SELECT work_date FROM report_rows
         UNION
         SELECT work_date FROM field_overrides
       )
       SELECT id, work_date, clock_in_at, clock_out_at, total_minutes, late_minutes,
              early_leave_minutes, overtime_minutes, status, clock_in_accuracy,
              clock_in_distance_meters, clock_out_accuracy, clock_out_distance_meters,
              source, created_at, updated_at, clock_in_updated_at, clock_out_updated_at,
              report_edited_clock_in, report_edited_clock_out
       FROM (
         SELECT COALESCE(r.id, b.id, o.id) AS id,
                d.work_date,
                CASE WHEN COALESCE(o.has_clock_in_override, 0) = 1 THEN o.override_clock_in_at ELSE COALESCE(r.clock_in_at, b.clock_in_at) END AS clock_in_at,
                CASE WHEN COALESCE(o.has_clock_out_override, 0) = 1 THEN o.override_clock_out_at ELSE COALESCE(r.clock_out_at, b.clock_out_at) END AS clock_out_at,
                CASE
                  WHEN (COALESCE(o.has_clock_in_override, 0) = 1 AND o.override_clock_in_at IS NULL)
                    OR (COALESCE(o.has_clock_out_override, 0) = 1 AND o.override_clock_out_at IS NULL) THEN 0
                  WHEN r.clock_in_at IS NOT NULL AND r.clock_out_at IS NOT NULL THEN r.total_minutes
                  ELSE b.total_minutes
                END AS total_minutes,
                CASE
                  WHEN (COALESCE(o.has_clock_in_override, 0) = 1 AND o.override_clock_in_at IS NULL)
                    OR (COALESCE(o.has_clock_out_override, 0) = 1 AND o.override_clock_out_at IS NULL) THEN 0
                  WHEN r.clock_in_at IS NOT NULL AND r.clock_out_at IS NOT NULL THEN r.late_minutes
                  ELSE b.late_minutes
                END AS late_minutes,
                CASE
                  WHEN (COALESCE(o.has_clock_in_override, 0) = 1 AND o.override_clock_in_at IS NULL)
                    OR (COALESCE(o.has_clock_out_override, 0) = 1 AND o.override_clock_out_at IS NULL) THEN 0
                  WHEN r.clock_in_at IS NOT NULL AND r.clock_out_at IS NOT NULL THEN r.early_leave_minutes
                  ELSE b.early_leave_minutes
                END AS early_leave_minutes,
                CASE
                  WHEN (COALESCE(o.has_clock_in_override, 0) = 1 AND o.override_clock_in_at IS NULL)
                    OR (COALESCE(o.has_clock_out_override, 0) = 1 AND o.override_clock_out_at IS NULL) THEN 0
                  WHEN r.clock_in_at IS NOT NULL AND r.clock_out_at IS NOT NULL THEN r.overtime_minutes
                  ELSE b.overtime_minutes
                END AS overtime_minutes,
                CASE
                  WHEN (COALESCE(o.has_clock_in_override, 0) = 1 AND o.override_clock_in_at IS NULL)
                    OR (COALESCE(o.has_clock_out_override, 0) = 1 AND o.override_clock_out_at IS NULL) THEN 'pending_review'
                  WHEN r.clock_in_at IS NOT NULL AND r.clock_out_at IS NOT NULL THEN r.status
                  ELSE b.status
                END AS status,
                COALESCE(r.clock_in_accuracy, b.clock_in_accuracy) AS clock_in_accuracy,
                COALESCE(r.clock_in_distance_meters, b.clock_in_distance_meters) AS clock_in_distance_meters,
                COALESCE(r.clock_out_accuracy, b.clock_out_accuracy) AS clock_out_accuracy,
                COALESCE(r.clock_out_distance_meters, b.clock_out_distance_meters) AS clock_out_distance_meters,
                CASE WHEN r.work_date IS NOT NULL OR o.work_date IS NOT NULL THEN 'admin_report_edit' ELSE b.source END AS source,
                COALESCE(r.created_at, b.created_at, o.created_at) AS created_at,
                COALESCE(o.clock_in_override_updated_at, o.clock_out_override_updated_at, r.updated_at, b.updated_at, o.updated_at) AS updated_at,
                CASE WHEN COALESCE(o.has_clock_in_override, 0) = 1 THEN o.clock_in_override_updated_at ELSE COALESCE(r.clock_in_updated_at, b.updated_at) END AS clock_in_updated_at,
                CASE WHEN COALESCE(o.has_clock_out_override, 0) = 1 THEN o.clock_out_override_updated_at ELSE COALESCE(r.clock_out_updated_at, b.updated_at) END AS clock_out_updated_at,
                CASE WHEN r.clock_in_at IS NOT NULL OR COALESCE(o.has_clock_in_override, 0) = 1 THEN 1 ELSE 0 END AS report_edited_clock_in,
                CASE WHEN r.clock_out_at IS NOT NULL OR COALESCE(o.has_clock_out_override, 0) = 1 THEN 1 ELSE 0 END AS report_edited_clock_out
         FROM day_keys d
         LEFT JOIN base_rows b ON b.work_date = d.work_date
         LEFT JOIN report_rows r ON r.work_date = d.work_date
         LEFT JOIN field_overrides o ON o.work_date = d.work_date
       )
       ORDER BY work_date DESC, updated_at DESC, clock_in_at DESC, created_at DESC`,
    )
    .bind(session.employee_id, session.employee_id, session.employee_id)
    .all();

  const corrections = await db
    .prepare(
      `SELECT id, requested_date, missing_type, requested_clock_in_at, requested_clock_out_at, reason, status,
              created_at, reviewed_at
       FROM attendance_corrections
       WHERE employee_id = ?
       ORDER BY COALESCE(reviewed_at, created_at) DESC, created_at DESC`,
    )
    .bind(session.employee_id)
    .all();

  const leaveRequests = await db
    .prepare(
      `SELECT id, leave_type, leave_date, duration, reason, status, admin_note, created_at
       FROM leave_requests
       WHERE employee_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(session.employee_id)
    .all();

  return json(request, {
    employee,
    attendance: attendance.results,
    corrections: corrections.results,
    leaveRequests: leaveRequests.results,
  });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
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
