import { ensureDatabase, getD1, getSessionFromRequest } from "../../../db/runtime";

type LeavePayload = {
  employeeId?: string;
  leaveType?: "leave" | "mc";
  leaveDate?: string;
  duration?: "half_day" | "full_day";
  reason?: string;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as LeavePayload;
    const validation = validatePayload(payload);
    if (validation) return json(request, { error: validation }, 400);

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return json(request, { error: "Employee login is required." }, 401);
    }
    if (payload.employeeId && payload.employeeId !== session.employee_id) {
      return json(request, { error: "Employees can only apply for their own leave." }, 403);
    }

    const employee = await db
      .prepare("SELECT id FROM employees WHERE id = ? AND status = 'active'")
      .bind(session.employee_id)
      .first<{ id: string }>();
    if (!employee) return json(request, { error: "Employee account was deleted by HR." }, 401);

    const duplicate = await db
      .prepare(
        `SELECT id
         FROM leave_requests
         WHERE employee_id = ? AND leave_date = ? AND status <> 'rejected'
         LIMIT 1`,
      )
      .bind(session.employee_id, payload.leaveDate)
      .first<{ id: string }>();
    if (duplicate) {
      return json(request, { error: "Leave/MC request already exists for this date." }, 409);
    }

    const id = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO leave_requests
         (id, employee_id, leave_type, leave_date, duration, reason)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        session.employee_id,
        payload.leaveType,
        payload.leaveDate,
        payload.duration,
        payload.reason?.trim() || null,
      )
      .run();

    return json(request, { ok: true, leaveRequestId: id }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function validatePayload(payload: LeavePayload) {
  if (payload.leaveType !== "leave" && payload.leaveType !== "mc") return "Select Leave or MC.";
  if (!payload.leaveDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.leaveDate)) return "Select leave date.";
  if (payload.duration !== "half_day" && payload.duration !== "full_day") return "Select half day or full day.";
  return null;
}

function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
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
