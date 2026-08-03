import { ensureDatabase, getD1, getSessionFromRequest, isAdminSession } from "../../../db/runtime";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      employeeId?: string;
      requestedDate?: string;
      missingType?: "clock_in" | "clock_out" | "both";
      requestedClockInAt?: string;
      requestedClockOutAt?: string;
      reason?: string;
    };

    if (!payload.employeeId || !payload.requestedDate || !payload.missingType || !payload.reason) {
      return Response.json({ error: "employeeId, requestedDate, missingType and reason are required." }, { status: 400 });
    }

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return Response.json({ error: "Employee login is required." }, { status: 401 });
    }
    if (payload.employeeId !== session.employee_id) {
      return Response.json({ error: "Employees can only submit their own corrections." }, { status: 403 });
    }
    const existing = await db
      .prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?")
      .bind(payload.employeeId, payload.requestedDate)
      .first<Record<string, unknown>>();
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

    return Response.json({ ok: true, correctionId: id }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
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
      return Response.json({ error: "correctionId, status and adminUserId are required." }, { status: 400 });
    }

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (!isAdminSession(session)) {
      return Response.json({ error: "Admin login is required." }, { status: 401 });
    }
    const correction = await db
      .prepare("SELECT * FROM attendance_corrections WHERE id = ? AND status = 'pending'")
      .bind(payload.correctionId)
      .first<Record<string, string | null>>();

    if (!correction) {
      return Response.json({ error: "Pending correction was not found." }, { status: 404 });
    }

    let newRecordJson: string | null = null;
    if (payload.status === "approved") {
      const attendanceId = correction.attendance_id ?? crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO attendance
           (id, employee_id, warehouse_id, work_date, clock_in_at, clock_out_at, source, status)
           VALUES (?, ?, 'wh-main', ?, ?, ?, 'admin_adjustment', 'pending_review')
           ON CONFLICT(employee_id, work_date) DO UPDATE SET
             clock_in_at = COALESCE(excluded.clock_in_at, attendance.clock_in_at),
             clock_out_at = COALESCE(excluded.clock_out_at, attendance.clock_out_at),
             source = 'admin_adjustment',
             status = 'pending_review',
             updated_at = CURRENT_TIMESTAMP`,
        )
        .bind(
          attendanceId,
          correction.employee_id,
          correction.requested_date,
          correction.requested_clock_in_at,
          correction.requested_clock_out_at,
        )
        .run();

      const updated = await db
        .prepare("SELECT * FROM attendance WHERE employee_id = ? AND work_date = ?")
        .bind(correction.employee_id, correction.requested_date)
        .first<Record<string, unknown>>();
      newRecordJson = updated ? JSON.stringify(updated) : null;
    }

    await db
      .prepare(
        `UPDATE attendance_corrections
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
             admin_note = ?, new_record_json = ?
         WHERE id = ?`,
      )
      .bind(payload.status, payload.adminUserId, payload.adminNote ?? null, newRecordJson, payload.correctionId)
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
        newRecordJson,
      )
      .run();

    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
