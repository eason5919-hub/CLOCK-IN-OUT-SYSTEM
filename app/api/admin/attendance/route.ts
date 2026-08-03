import { ensureDatabase, getD1 } from "../../../../db/runtime";

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as {
      attendanceId?: string;
      adminUserId?: string;
      clockInAt?: string | null;
      clockOutAt?: string | null;
      reason?: string;
    };

    if (!payload.attendanceId || !payload.adminUserId || !payload.reason) {
      return Response.json({ error: "attendanceId, adminUserId and reason are required." }, { status: 400 });
    }

    const db = getD1();
    await ensureDatabase(db);
    const before = await db
      .prepare("SELECT * FROM attendance WHERE id = ?")
      .bind(payload.attendanceId)
      .first<Record<string, unknown>>();

    if (!before) {
      return Response.json({ error: "Attendance record was not found." }, { status: 404 });
    }

    await db
      .prepare(
        `UPDATE attendance
         SET clock_in_at = COALESCE(?, clock_in_at),
             clock_out_at = COALESCE(?, clock_out_at),
             source = 'admin_adjustment',
             status = 'pending_review',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(payload.clockInAt ?? null, payload.clockOutAt ?? null, payload.attendanceId)
      .run();

    const after = await db
      .prepare("SELECT * FROM attendance WHERE id = ?")
      .bind(payload.attendanceId)
      .first<Record<string, unknown>>();

    await db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        payload.adminUserId,
        "manual_attendance_edit",
        "attendance",
        payload.attendanceId,
        JSON.stringify({ ...before, reason: payload.reason }),
        JSON.stringify(after),
      )
      .run();

    return Response.json({ ok: true, attendance: after });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}
