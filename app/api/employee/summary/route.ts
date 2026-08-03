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
              d.device_model, d.status AS device_status
       FROM employees e
       LEFT JOIN devices d ON d.employee_id = e.id AND d.status = 'registered'
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
      .prepare("SELECT id FROM devices WHERE employee_id = ? AND device_fingerprint = ? AND status = 'registered'")
      .bind(session.employee_id, deviceFingerprint)
      .first<{ id: string }>();

    if (!device) {
      return json(request, { error: "Employee phone access was deleted by HR." }, 401);
    }
  }

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

  return json(request, { employee, attendance: attendance.results, corrections: corrections.results });
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
