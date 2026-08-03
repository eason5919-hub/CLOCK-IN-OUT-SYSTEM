import { createSession, ensureDatabase, getD1, sessionCookie } from "../../../../db/runtime";

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);

  const payload = (await request.json()) as {
    employeeCode?: string;
    fullName?: string;
    phone?: string;
    deviceFingerprint?: string;
    deviceModel?: string;
  };
  const code = payload.employeeCode?.trim().toUpperCase();
  const fullName = normalizeName(payload.fullName ?? "");
  const phone = normalizePhone(payload.phone ?? "");

  if (!code || !fullName || !phone || !payload.deviceFingerprint || !payload.deviceModel) {
    return json(request, { error: "Employee code, full name, phone and device are required." }, 400);
  }

  const employee = await db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.phone, e.department_id, e.position,
              u.id AS user_id, u.role
       FROM employees e
       JOIN users u ON u.employee_id = e.id
       WHERE UPPER(e.employee_code) = ? AND e.status = 'active'`,
    )
    .bind(code)
    .first<{
      id: string;
      employee_code: string;
      full_name: string;
      phone: string;
      department_id: string | null;
      position: string;
      user_id: string;
      role: "employee";
    }>();

  if (
    !employee ||
    normalizeName(employee.full_name ?? "") !== fullName ||
    normalizePhone(employee.phone ?? "") !== phone
  ) {
    return json(request, { error: "Employee code, full name and phone number do not match HR records." }, 401);
  }

  const linked = await db
    .prepare("SELECT id, device_fingerprint FROM devices WHERE employee_id = ? AND status = 'registered'")
    .bind(employee.id)
    .first<{ id: string; device_fingerprint: string }>();

  if (linked && linked.device_fingerprint !== payload.deviceFingerprint) {
    return json(
      request,
      { error: "This employee account is already linked to another phone. Ask HR/Admin to reset the device." },
      403,
    );
  }

  if (!linked) {
    await db
      .prepare(
        "INSERT INTO devices (id, employee_id, device_fingerprint, device_model, last_seen_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
      )
      .bind(crypto.randomUUID(), employee.id, payload.deviceFingerprint, payload.deviceModel)
      .run();
  }

  const session = await createSession(db, {
    id: employee.user_id,
    role: "employee",
    employee_id: employee.id,
  });

  return json(request, { user: toEmployeeUser(employee), token: session.id, expiresAt: session.expiresAt }, 200, {
    "set-cookie": sessionCookie(session.id, session.expiresAt),
  });
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function toEmployeeUser(employee: {
  id: string;
  employee_code: string;
  full_name: string;
  department_id: string | null;
  position: string;
}) {
  return {
    role: "employee",
    employeeId: employee.id,
    employeeCode: employee.employee_code,
    name: employee.full_name,
    department: employee.department_id,
    position: employee.position,
  };
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function json(request: Request, data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...corsHeaders(request), ...headers } });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": requestHeaders || "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
