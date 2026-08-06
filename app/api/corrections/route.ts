import { ensureDatabase, getD1, getSessionFromRequest, isAdminSession } from "../../../db/runtime";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      action?: "cancel";
      correctionId?: string;
      employeeId?: string;
      requestedDate?: string;
      missingType?: CorrectionMissingType;
      requestedClockInAt?: string;
      requestedClockOutAt?: string;
      reason?: string;
    };

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return json(request, { error: "Employee login is required." }, 401);
    }

    if (payload.action === "cancel") {
      if (!payload.correctionId) {
        return json(request, { error: "Correction request is required." }, 400);
      }
      const result = await db
        .prepare(
          `UPDATE attendance_corrections
           SET status = 'cancelled',
               admin_note = 'Cancelled by employee',
               reviewed_at = CURRENT_TIMESTAMP
           WHERE id = ? AND employee_id = ? AND status = 'pending'`,
        )
        .bind(payload.correctionId, session.employee_id)
        .run();
      if (!result.meta.changes) {
        return json(request, { error: "Pending correction request was not found." }, 404);
      }
      return json(request, { ok: true });
    }

    if (!payload.employeeId || !payload.requestedDate || !payload.missingType || !payload.reason) {
      return json(request, { error: "employeeId, requestedDate, missingType and reason are required." }, 400);
    }

    if (payload.employeeId !== session.employee_id) {
      return json(request, { error: "Employees can only submit their own corrections." }, 403);
    }
    const existing = await findTargetAttendanceForCorrection(
      db,
      payload.employeeId,
      payload.requestedDate,
      payload.missingType,
    );
    const id = crypto.randomUUID();

    await db
      .prepare(
        `INSERT INTO attendance_corrections
         (id, attendance_id, employee_id, requested_date, missing_type, requested_clock_in_at,
          requested_clock_out_at, reason, original_record_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        existing?.id ?? null,
        payload.employeeId,
        payload.requestedDate,
        payload.missingType,
        payload.requestedClockInAt ?? null,
        payload.requestedClockOutAt ?? null,
        payload.reason,
        existing ? JSON.stringify(existing) : null,
      )
      .run();

    return json(request, { ok: true, correctionId: id }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      correctionId?: string;
      status?: "approved" | "rejected";
      adminUserId?: string;
      adminNote?: string;
    };

    if (!payload.correctionId || !payload.status || !payload.adminUserId) {
      return json(request, { error: "correctionId, status and adminUserId are required." }, 400);
    }

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (!isAdminSession(session)) {
      return json(request, { error: "Admin login is required." }, 401);
    }
    const correction = await db
      .prepare("SELECT * FROM attendance_corrections WHERE id = ? AND status = 'pending'")
      .bind(payload.correctionId)
      .first<Record<string, string | null>>();

    if (!correction) {
      return json(request, { error: "Pending correction was not found." }, 404);
    }

    const reviewedCorrection = {
      ...correction,
      status: payload.status,
      reviewed_by_user_id: payload.adminUserId,
      admin_note: payload.adminNote ?? null,
    };

    await db
      .prepare(
        `UPDATE attendance_corrections
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
             admin_note = ?, new_record_json = NULL
         WHERE id = ?`,
      )
      .bind(payload.status, payload.adminUserId, payload.adminNote ?? null, payload.correctionId)
      .run();

    await db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        payload.adminUserId,
        `correction_${payload.status}`,
        "attendance_corrections",
        payload.correctionId,
        JSON.stringify(correction),
        JSON.stringify(reviewedCorrection),
      )
      .run();

    return json(request, { ok: true, attendanceChanged: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

type CorrectionMissingType = "clock_in" | "clock_out" | "both";

async function findTargetAttendanceForCorrection(
  db: D1Database,
  employeeId: string,
  requestedDate: string,
  missingType: CorrectionMissingType,
) {
  if (missingType === "clock_out" || missingType === "both") {
    const openRecord = await db
      .prepare(
        `SELECT *
         FROM attendance
         WHERE employee_id = ? AND work_date = ?
           AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
         ORDER BY clock_in_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(employeeId, requestedDate)
      .first<Record<string, unknown>>();
    if (openRecord) return openRecord;
  }

  if (missingType === "clock_in" || missingType === "both") {
    const missingInRecord = await db
      .prepare(
        `SELECT *
         FROM attendance
         WHERE employee_id = ? AND work_date = ?
           AND clock_in_at IS NULL AND clock_out_at IS NOT NULL
         ORDER BY clock_out_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(employeeId, requestedDate)
      .first<Record<string, unknown>>();
    if (missingInRecord) return missingInRecord;
  }

  return db
    .prepare(
      `SELECT *
       FROM attendance
       WHERE employee_id = ? AND work_date = ?
       ORDER BY updated_at DESC, clock_in_at DESC, clock_out_at DESC
       LIMIT 1`,
    )
    .bind(employeeId, requestedDate)
    .first<Record<string, unknown>>();
}

function json(request: Request, data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders(request) });
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") || "*";
  const requestHeaders = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, PATCH, OPTIONS",
    "access-control-allow-headers": requestHeaders || "Content-Type, Authorization",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
