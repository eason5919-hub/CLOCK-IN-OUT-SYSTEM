import { createSession, ensureDatabase, getD1, sessionCookie } from "../../../../db/runtime";

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);

  const payload = (await request.json()) as {
    employeeCode?: string;
    phone?: string;
    deviceFingerprint?: string;
    deviceModel?: string;
  };
  const code = payload.employeeCode?.trim().toUpperCase();
  const phone = normalizePhone(payload.phone ?? "");

  if (!code || !phone || !payload.deviceFingerprint || !payload.deviceModel) {
    return Response.json({ error: "Employee code, phone and device are required." }, { status: 400 });
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

  if (!employee || normalizePhone(employee.phone ?? "") !== phone) {
    return Response.json({ error: "Employee code and phone number do not match HR records." }, { status: 401 });
  }

  const linked = await db
    .prepare("SELECT id, device_fingerprint FROM devices WHERE employee_id = ? AND status = 'registered'")
    .bind(employee.id)
    .first<{ id: string; device_fingerprint: string }>();

  if (linked && linked.device_fingerprint !== payload.deviceFingerprint) {
    return Response.json(
      { error: "This employee account is already linked to another phone. Ask HR/Admin to reset the device." },
      { status: 403 },
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

  return Response.json(
    { user: toEmployeeUser(employee) },
    { headers: { "set-cookie": sessionCookie(session.id, session.expiresAt) } },
  );
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
