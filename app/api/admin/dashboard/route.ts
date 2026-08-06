import { ensureDatabase, getD1, getSessionFromRequest, isAdminSession } from "../../../../db/runtime";
import { reconcileAttendanceRows, type AttendanceRow } from "../../../../db/attendance-reconciliation";

export async function GET(request: Request) {
  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (!isAdminSession(session)) {
    return Response.json({ error: "Admin login is required." }, { status: 401 });
  }

  const [employees, attendance, corrections, auditLogs] = await Promise.all([
    db
      .prepare(
        `SELECT e.id, e.employee_code, e.full_name, e.department_id, e.position, e.phone,
                COALESCE(d.device_model, 'Not registered') AS device_model,
                COALESCE(d.status, 'not_registered') AS device_status
         FROM employees e
         LEFT JOIN devices d ON d.employee_id = e.id AND d.status = 'registered'
         ORDER BY e.employee_code`,
      )
      .all(),
    db
      .prepare(
        `SELECT a.*, e.employee_code, e.full_name
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.source <> 'admin_report_edit_archived'
         ORDER BY a.work_date DESC, a.clock_in_at DESC, e.employee_code`,
      )
      .all(),
    db
      .prepare(
        `SELECT c.*, e.employee_code, e.full_name
         FROM attendance_corrections c
         JOIN employees e ON e.id = c.employee_id
         ORDER BY c.created_at DESC`,
      )
      .all(),
    db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 30").all(),
  ]);

  const attendanceRows = reconcileAttendanceRows((attendance.results ?? []) as AttendanceRow[]);

  return Response.json({
    employees: employees.results,
    attendance: attendanceRows,
    corrections: corrections.results,
    auditLogs: auditLogs.results,
  });
}

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);
  const session = await getSessionFromRequest(db, request);
  if (!isAdminSession(session)) {
    return Response.json({ error: "Admin login is required." }, { status: 401 });
  }

  const payload = (await request.json()) as {
    employeeCode?: string;
    fullName?: string;
    phone?: string;
    departmentId?: string;
    position?: string;
    email?: string;
  };
  if (!payload.employeeCode || !payload.fullName || !payload.phone) {
    return Response.json({ error: "Employee code, name and phone are required." }, { status: 400 });
  }

  const employeeId = crypto.randomUUID();
  const email = payload.email?.trim() || `${payload.employeeCode.toLowerCase()}@warehouse.local`;
  await db.batch([
    db
      .prepare(
        "INSERT INTO employees (id, employee_code, full_name, department_id, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
      )
      .bind(
        employeeId,
        payload.employeeCode.trim().toUpperCase(),
        payload.fullName.trim(),
        payload.departmentId || null,
        payload.position || "Warehouse Associate",
        payload.phone.trim(),
        email,
      ),
    db
      .prepare("INSERT INTO users (id, email, password_hash, role, employee_id, is_active) VALUES (?, ?, ?, 'employee', ?, 1)")
      .bind(crypto.randomUUID(), email, "employee-phone-login", employeeId),
  ]);

  return Response.json({ ok: true, employeeId }, { status: 201 });
}
