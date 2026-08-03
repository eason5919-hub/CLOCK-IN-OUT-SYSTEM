import { createSession, ensureDatabase, getD1, sessionCookie } from "../../../../db/runtime";

export async function POST(request: Request) {
  const db = getD1();
  await ensureDatabase(db);

  const payload = (await request.json()) as {
    employeeCode?: string;
    deviceFingerprint?: string;
  };
  const code = payload.employeeCode?.trim().toUpperCase();

  if (!code || !payload.deviceFingerprint) {
    return Response.json({ error: "Employee code and device are required." }, { status: 400 });
  }

  const employee = await db
    .prepare(
      `SELECT e.id, e.employee_code, e.full_name, e.department_id, e.position,
              u.id AS user_id
       FROM employees e
       JOIN users u ON u.employee_id = e.id
       WHERE UPPER(e.employee_code) = ? AND e.status = 'active'`,
    )
    .bind(code)
    .first<{
      id: string;
      employee_code: string;
      full_name: string;
      department_id: string | null;
      position: string;
      user_id: string;
    }>();

  if (!employee) {
    return Response.json({ error: "Employee code was not found." }, { status: 401 });
  }

  const device = await db
    .prepare("SELECT device_fingerprint, status FROM devices WHERE employee_id = ? AND status = 'registered'")
    .bind(employee.id)
    .first<{ device_fingerprint: string; status: string }>();

  if (!device) {
    return Response.json(
      { error: "This employee has not registered this phone yet. Use Register Official Phone first." },
      { status: 403 },
    );
  }
  if (device.device_fingerprint !== payload.deviceFingerprint) {
    return Response.json(
      { error: "This employee account is linked to another phone. Ask HR/Admin to reset the device." },
      { status: 403 },
    );
  }

  const session = await createSession(db, {
    id: employee.user_id,
    role: "employee",
    employee_id: employee.id,
  });

  return Response.json(
    {
      user: {
        role: "employee",
        employeeId: employee.id,
        employeeCode: employee.employee_code,
        name: employee.full_name,
        department: employee.department_id,
        position: employee.position,
      },
    },
    { headers: { "set-cookie": sessionCookie(session.id, session.expiresAt) } },
  );
}
