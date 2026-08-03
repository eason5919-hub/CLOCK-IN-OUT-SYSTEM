import { ensureDatabase, getD1, getSessionFromRequest } from "../../../../db/runtime";

export async function GET(request: Request) {
  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (session?.role !== "employee" || !session.employee_id) {
    return Response.json({ error: "Employee login is required." }, { status: 401 });
  }

  const employee = await db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.department_id, e.position, e.phone,
              d.device_model, d.status AS device_status
       FROM employees e
       LEFT JOIN devices d ON d.employee_id = e.id AND d.status = 'registered'
       WHERE e.id = ?`,
    )
    .bind(session.employee_id)
    .first<Record<string, string | null>>();

  const attendance = await db
    .prepare(
      `SELECT id, work_date, clock_in_at, clock_out_at, total_minutes, late_minutes,
              early_leave_minutes, overtime_minutes, status, clock_in_accuracy,
              clock_in_distance_meters, clock_out_accuracy, clock_out_distance_meters
       FROM attendance
       WHERE employee_id = ?
       ORDER BY work_date DESC`,
    )
    .bind(session.employee_id)
    .all();

  const corrections = await db
    .prepare(
      `SELECT id, requested_date, missing_type, requested_clock_in_at, requested_clock_out_at, reason, status
       FROM attendance_corrections
       WHERE employee_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(session.employee_id)
    .all();

  return Response.json({ employee, attendance: attendance.results, corrections: corrections.results });
}
