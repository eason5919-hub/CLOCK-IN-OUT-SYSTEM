import { ensureDatabase, getD1, getSessionFromRequest, isAdminSession } from "../../../db/runtime";
import { calculateAttendanceTotals, localDayOfWeek } from "../../../db/attendance-calculations";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      employeeId?: string;
      requestedDate?: string;
      missingType?: CorrectionMissingType;
      requestedClockInAt?: string;
      requestedClockOutAt?: string;
      reason?: string;
    };

    if (!payload.employeeId || !payload.requestedDate || !payload.missingType || !payload.reason) {
      return json(request, { error: "employeeId, requestedDate, missingType and reason are required." }, 400);
    }

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return json(request, { error: "Employee login is required." }, 401);
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

    let newRecordJson: string | null = null;
    if (payload.status === "approved") {
      const attendanceId = correction.attendance_id ?? crypto.randomUUID();
      const existingRecord = correction.attendance_id
        ? await db.prepare("SELECT id FROM attendance WHERE id = ?").bind(correction.attendance_id).first()
        : null;

      if (existingRecord) {
        await db
          .prepare(
            `UPDATE attendance
             SET clock_in_at = COALESCE(?, clock_in_at),
                 clock_out_at = COALESCE(?, clock_out_at),
                 source = CASE WHEN source = 'admin_report_edit' THEN source ELSE 'admin_adjustment' END,
                 status = 'pending_review',
                 updated_at = CASE WHEN source = 'admin_report_edit' THEN updated_at ELSE CURRENT_TIMESTAMP END
             WHERE id = ?`,
          )
          .bind(correction.requested_clock_in_at, correction.requested_clock_out_at, attendanceId)
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO attendance
             (id, employee_id, warehouse_id, work_date, clock_in_at, clock_out_at, source, status)
             VALUES (?, ?, 'wh-main', ?, ?, ?, 'admin_adjustment', 'pending_review')`,
          )
          .bind(
            attendanceId,
            correction.employee_id,
            correction.requested_date,
            correction.requested_clock_in_at,
            correction.requested_clock_out_at,
          )
          .run();
      }

      const updated = await db
        .prepare(
          `SELECT a.*, w.timezone
           FROM attendance a
           JOIN warehouses w ON w.id = a.warehouse_id
           WHERE a.id = ?`,
        )
        .bind(attendanceId)
        .first<Record<string, string | number | null>>();
      if (updated?.clock_in_at && updated.clock_out_at) {
        const timeZone = String(updated.timezone || "Asia/Kuala_Lumpur");
        const schedule = await db
          .prepare(
            "SELECT start_time, end_time, overtime_starts_at, is_off_day FROM working_schedule WHERE warehouse_id = ? AND day_of_week = ?",
          )
          .bind(updated.warehouse_id, localDayOfWeek(`${correction.requested_date}T12:00:00+08:00`, timeZone))
          .first();
        const previousRegularMinutes = await getPreviousRegularMinutes(
          db,
          String(updated.employee_id),
          String(updated.work_date),
          String(updated.id),
        );
        const totals = calculateAttendanceTotals(String(updated.clock_in_at), String(updated.clock_out_at), schedule, timeZone, {
          previousRegularMinutes,
        });
        const status =
          totals.lateMinutes > 0 ? "late" : totals.earlyLeaveMinutes > 0 ? "early_leave" : "present";
        await db
          .prepare(
            `UPDATE attendance
             SET total_minutes = ?, late_minutes = ?, early_leave_minutes = ?,
                 overtime_minutes = ?, status = ?,
                 updated_at = CASE WHEN source = 'admin_report_edit' THEN updated_at ELSE CURRENT_TIMESTAMP END
             WHERE id = ?`,
          )
          .bind(
            totals.totalMinutes,
            totals.lateMinutes,
            totals.earlyLeaveMinutes,
            totals.overtimeMinutes,
            status,
            updated.id,
          )
          .run();
      }
      const recalculated = await db
        .prepare("SELECT * FROM attendance WHERE id = ?")
        .bind(attendanceId)
        .first<Record<string, unknown>>();
      newRecordJson = recalculated ? JSON.stringify(recalculated) : null;
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

    return json(request, { ok: true });
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

async function getPreviousRegularMinutes(
  db: D1Database,
  employeeId: string,
  workDate: string,
  currentAttendanceId: string,
) {
  const rows = await db
    .prepare(
      `SELECT total_minutes, overtime_minutes
       FROM attendance
       WHERE employee_id = ? AND work_date = ? AND id <> ? AND clock_out_at IS NOT NULL`,
    )
    .bind(employeeId, workDate, currentAttendanceId)
    .all<{ total_minutes: number; overtime_minutes: number }>();

  return (rows.results ?? []).reduce(
    (total, row) => total + Math.max(0, Number(row.total_minutes || 0) - Number(row.overtime_minutes || 0)),
    0,
  );
}
