import { ensureDatabase, getD1, isAdminSession } from "../../../../db/runtime";

type AdminAction =
  | {
      action: "add_employee";
      employeeCode?: string;
      fullName?: string;
      phone?: string;
      department?: string;
      position?: string;
      email?: string;
    }
  | {
      action: "edit_employee";
      employeeId?: string;
      employeeCode?: string;
      fullName?: string;
      phone?: string;
      department?: string;
      position?: string;
    }
  | { action: "deactivate_employee"; employeeId?: string }
  | { action: "delete_employee"; employeeId?: string }
  | { action: "unlink_device"; deviceId?: string };

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const db = getD1();
    await ensureDatabase(db);
    const auth = await requireAdmin(db, request);
    if ("error" in auth) return json(request, { error: auth.error }, auth.status);

    const [employees, attendance, corrections, auditLogs] = await Promise.all([
      db
        .prepare(
          `SELECT e.id, e.employee_code, e.full_name, e.department_id, e.position, e.phone,
                  e.email, e.status, e.created_at,
                  d.id AS device_id, d.device_model, d.status AS device_status,
                  d.registered_at, d.last_seen_at
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
           ORDER BY a.work_date DESC, a.updated_at DESC, e.employee_code`,
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

    return json(request, {
      employees: employees.results ?? [],
      attendance: attendance.results ?? [],
      corrections: corrections.results ?? [],
      auditLogs: auditLogs.results ?? [],
      qrToken: "WAREHOUSE-MAIN-QR",
      warehouse: {
        latitude: 2.9850965,
        longitude: 101.7700882,
        radiusMeters: 100,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

export async function POST(request: Request) {
  try {
    const db = getD1();
    await ensureDatabase(db);
    const auth = await requireAdmin(db, request);
    if ("error" in auth) return json(request, { error: auth.error }, auth.status);

    const payload = (await request.json()) as AdminAction;
    if (payload.action === "add_employee") {
      return addEmployee(db, request, payload);
    }
    if (payload.action === "edit_employee") {
      return editEmployee(db, request, payload, auth.userId);
    }
    if (payload.action === "deactivate_employee") {
      return deactivateEmployee(db, request, payload.employeeId, auth.userId);
    }
    if (payload.action === "delete_employee") {
      return deactivateEmployee(db, request, payload.employeeId, auth.userId);
    }
    if (payload.action === "unlink_device") {
      return unlinkDevice(db, request, payload.deviceId, auth.userId);
    }

    return json(request, { error: "Unknown admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

async function addEmployee(db: D1Database, request: Request, payload: Extract<AdminAction, { action: "add_employee" }>) {
  const code = payload.employeeCode?.trim().toUpperCase();
  const name = payload.fullName?.trim();
  const phone = payload.phone?.trim();
  if (!code || !name || !phone) {
    return json(request, { error: "Employee code, name and phone are required." }, 400);
  }

  const employeeId = crypto.randomUUID();
  const email = payload.email?.trim() || `${code.toLowerCase()}@warehouse.local`;
  const existing = await db
    .prepare("SELECT id FROM employees WHERE UPPER(employee_code) = ?")
    .bind(code)
    .first<{ id: string }>();
  if (existing) {
    return json(request, { error: "This employee code already exists. Use Edit instead." }, 409);
  }

  await db.batch([
    db
      .prepare(
        "INSERT INTO employees (id, employee_code, full_name, department_id, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')",
      )
      .bind(employeeId, code, name, payload.department?.trim() || null, payload.position?.trim() || "Warehouse Associate", phone, email),
    db
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, employee_id, is_active) VALUES (?, ?, ?, 'employee', ?, 1)",
      )
      .bind(crypto.randomUUID(), email, "employee-phone-login", employeeId),
  ]);

  return json(request, { ok: true, employeeId }, 201);
}

async function editEmployee(
  db: D1Database,
  request: Request,
  payload: Extract<AdminAction, { action: "edit_employee" }>,
  adminUserId: string,
) {
  const employeeId = payload.employeeId;
  const code = payload.employeeCode?.trim().toUpperCase();
  const name = payload.fullName?.trim();
  const phone = payload.phone?.trim();
  if (!employeeId || !code || !name || !phone) {
    return json(request, { error: "Employee ID, code, name and phone are required." }, 400);
  }

  const before = await db.prepare("SELECT * FROM employees WHERE id = ?").bind(employeeId).first();
  if (!before) return json(request, { error: "Employee was not found." }, 404);

  const duplicate = await db
    .prepare("SELECT id FROM employees WHERE UPPER(employee_code) = ? AND id <> ?")
    .bind(code, employeeId)
    .first<{ id: string }>();
  if (duplicate) return json(request, { error: "This employee code already exists." }, 409);

  await db.batch([
    db
      .prepare(
        "UPDATE employees SET employee_code = ?, full_name = ?, phone = ?, department_id = ?, position = ? WHERE id = ?",
      )
      .bind(code, name, phone, payload.department?.trim() || null, payload.position?.trim() || "Warehouse Associate", employeeId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        adminUserId,
        "edit_employee",
        "employee",
        employeeId,
        JSON.stringify(before),
        JSON.stringify({ employee_code: code, full_name: name, phone, department_id: payload.department, position: payload.position }),
      ),
  ]);

  return json(request, { ok: true });
}

async function deactivateEmployee(db: D1Database, request: Request, employeeId: string | undefined, adminUserId: string) {
  if (!employeeId) return json(request, { error: "Employee ID is required." }, 400);

  const before = await db.prepare("SELECT * FROM employees WHERE id = ?").bind(employeeId).first();
  if (!before) return json(request, { error: "Employee was not found." }, 404);

  await db.batch([
    db.prepare("UPDATE employees SET status = 'inactive' WHERE id = ?").bind(employeeId),
    db.prepare("UPDATE users SET is_active = 0 WHERE employee_id = ? AND role = 'employee'").bind(employeeId),
    db.prepare("UPDATE devices SET status = 'reset', reset_by_user_id = ?, reset_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND status = 'registered'").bind(adminUserId, employeeId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), adminUserId, "deactivate_employee", "employee", employeeId, JSON.stringify(before), JSON.stringify({ status: "inactive" })),
  ]);

  return json(request, { ok: true });
}

async function unlinkDevice(db: D1Database, request: Request, deviceId: string | undefined, adminUserId: string) {
  if (!deviceId) return json(request, { error: "Device ID is required." }, 400);

  const before = await db.prepare("SELECT * FROM devices WHERE id = ?").bind(deviceId).first();
  if (!before) return json(request, { error: "Device was not found." }, 404);

  await db.batch([
    db
      .prepare("UPDATE devices SET status = 'reset', reset_by_user_id = ?, reset_at = CURRENT_TIMESTAMP WHERE id = ?")
      .bind(adminUserId, deviceId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), adminUserId, "unlink_device", "device", deviceId, JSON.stringify(before), JSON.stringify({ status: "reset" })),
  ]);

  return json(request, { ok: true });
}

async function requireAdmin(db: D1Database, request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return { error: "Admin login is required.", status: 401 as const };

  const session = await db
    .prepare(
      "SELECT id, user_id, role, employee_id, expires_at FROM sessions WHERE id = ? AND expires_at > ?",
    )
    .bind(token, new Date().toISOString())
    .first<{ id: string; user_id: string; role: "owner" | "hr" | "employee"; employee_id: string | null; expires_at: string }>();

  if (!isAdminSession(session ?? null)) return { error: "Admin login is required.", status: 401 as const };
  return { userId: session.user_id, role: session.role };
}

function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": requestHeaders || "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
