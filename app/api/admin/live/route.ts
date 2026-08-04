import { ensureDatabase, getD1, isAdminSession } from "../../../../db/runtime";
import { calculateAttendanceTotals, localDayOfWeek } from "../../../../db/attendance-calculations";

type AdminAction =
  | {
      action: "add_employee";
      employeeCode?: string;
      fullName?: string;
      phone?: string;
      department?: string;
      position?: string;
      email?: string;
      leaveEntitlementDays?: number | string;
    }
  | {
      action: "edit_employee";
      employeeId?: string;
      employeeCode?: string;
      fullName?: string;
      phone?: string;
      department?: string;
      position?: string;
      leaveEntitlementDays?: number | string;
    }
  | { action: "deactivate_employee"; employeeId?: string }
  | { action: "delete_employee"; employeeId?: string }
  | { action: "unlink_device"; deviceId?: string }
  | { action: "review_leave_request"; requestId?: string; status?: "approved" | "rejected"; adminNote?: string }
  | { action: "review_correction"; requestId?: string; status?: "approved" | "rejected"; adminNote?: string }
  | {
      action: "save_report_attendance_times";
      employeeId?: string;
      rows?: Array<{ dateKey?: string; in?: string; break?: string; resume?: string; out?: string }>;
    }
  | { action: "restore_report_attendance_times"; employeeId?: string; monthKey?: string };

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export async function GET(request: Request) {
  try {
    const db = getD1();
    await ensureDatabase(db);
    const auth = await requireAdmin(db, request);
    if ("error" in auth) return json(request, { error: auth.error }, auth.status);

    const [employees, attendance, corrections, leaveRequests, auditLogs] = await Promise.all([
      db
        .prepare(
          `SELECT e.id, e.employee_code, e.full_name, e.department_id,
                  COALESCE(dep.name, e.department_id) AS department_name,
                  e.position, e.phone,
                  e.leave_entitlement_days,
                  COALESCE(leave_totals.taken_days, 0) AS leave_taken_days,
                  MAX(e.leave_entitlement_days - COALESCE(leave_totals.taken_days, 0), 0) AS leave_remaining_days,
                  e.email, e.status, e.created_at,
                  d.id AS device_id, d.device_model, d.status AS device_status,
                  d.registered_at, d.last_seen_at
           FROM employees e
           LEFT JOIN departments dep ON dep.id = e.department_id
           LEFT JOIN devices d ON d.employee_id = e.id AND d.status = 'registered'
           LEFT JOIN (
             SELECT employee_id,
                    SUM(CASE duration WHEN 'half_day' THEN 0.5 ELSE 1 END) AS taken_days
             FROM leave_requests
             WHERE status = 'approved' AND leave_type = 'leave'
             GROUP BY employee_id
           ) leave_totals ON leave_totals.employee_id = e.id
           WHERE e.status <> 'deleted'
           ORDER BY e.employee_code`,
        )
        .all(),
      db
        .prepare(
          `SELECT a.*, e.employee_code, e.full_name
           FROM attendance a
           JOIN employees e ON e.id = a.employee_id
           ORDER BY a.work_date DESC, a.clock_in_at DESC, a.updated_at DESC, e.employee_code`,
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
      db
        .prepare(
          `SELECT l.*, e.employee_code, e.full_name
           FROM leave_requests l
           JOIN employees e ON e.id = l.employee_id
           WHERE e.status <> 'deleted'
           ORDER BY l.created_at DESC`,
        )
        .all(),
      db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 30").all(),
    ]);

    return json(request, {
      employees: employees.results ?? [],
      attendance: attendance.results ?? [],
      corrections: corrections.results ?? [],
      leaveRequests: leaveRequests.results ?? [],
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
    if (payload.action === "review_leave_request") {
      return reviewLeaveRequest(db, request, payload, auth.userId);
    }
    if (payload.action === "review_correction") {
      return reviewCorrectionRequest(db, request, payload, auth.userId);
    }
    if (payload.action === "save_report_attendance_times") {
      return saveReportAttendanceTimes(db, request, payload, auth.userId);
    }
    if (payload.action === "restore_report_attendance_times") {
      return restoreReportAttendanceTimes(db, request, payload, auth.userId);
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
  const departmentId = await ensureDepartment(db, payload.department);
  const leaveEntitlementDays = normalizeLeaveDays(payload.leaveEntitlementDays ?? 0);
  const existing = await db
    .prepare("SELECT id, status FROM employees WHERE UPPER(employee_code) = ?")
    .bind(code)
    .first<{ id: string; status: string }>();
  if (existing && existing.status === "deleted") {
    await db.batch([
      db
        .prepare(
        "UPDATE employees SET full_name = ?, phone = ?, department_id = ?, position = ?, email = ?, leave_entitlement_days = ?, status = 'active' WHERE id = ?",
      )
        .bind(name, phone, departmentId, payload.position?.trim() || "Warehouse Associate", email, leaveEntitlementDays, existing.id),
      db.prepare("UPDATE users SET is_active = 1 WHERE employee_id = ? AND role = 'employee'").bind(existing.id),
    ]);
    return json(request, { ok: true, employeeId: existing.id }, 200);
  }
  if (existing) {
    return json(request, { error: "This employee code already exists. Use Edit instead." }, 409);
  }

  await db.batch([
    db
      .prepare(
        "INSERT INTO employees (id, employee_code, full_name, department_id, position, phone, email, leave_entitlement_days, status) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'active')",
      )
      .bind(employeeId, code, name, departmentId, payload.position?.trim() || "Warehouse Associate", phone, email, leaveEntitlementDays),
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

  const departmentId = await ensureDepartment(db, payload.department);
  const previousLeaveDays = Number((before as { leave_entitlement_days?: number }).leave_entitlement_days || 0);
  const leaveEntitlementDays = normalizeLeaveDays(payload.leaveEntitlementDays ?? previousLeaveDays);

  await db.batch([
    db
      .prepare(
        "UPDATE employees SET employee_code = ?, full_name = ?, phone = ?, department_id = ?, position = ?, leave_entitlement_days = ? WHERE id = ?",
      )
      .bind(code, name, phone, departmentId, payload.position?.trim() || "Warehouse Associate", leaveEntitlementDays, employeeId),
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
        JSON.stringify({ employee_code: code, full_name: name, phone, department_id: departmentId, position: payload.position, leave_entitlement_days: leaveEntitlementDays }),
      ),
  ]);

  return json(request, { ok: true });
}

async function ensureDepartment(db: D1Database, value: string | undefined) {
  const name = value?.trim();
  if (!name) return null;

  const id = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "DEPARTMENT";

  await db
    .prepare("INSERT OR IGNORE INTO departments (id, name) VALUES (?, ?)")
    .bind(id, name)
    .run();

  return id;
}

async function deactivateEmployee(db: D1Database, request: Request, employeeId: string | undefined, adminUserId: string) {
    if (!employeeId) return json(request, { error: "Employee ID is required." }, 400);

  const before = await db.prepare("SELECT * FROM employees WHERE id = ?").bind(employeeId).first();
  if (!before) return json(request, { error: "Employee was not found." }, 404);

  await db.batch([
    db.prepare("UPDATE employees SET status = 'deleted' WHERE id = ?").bind(employeeId),
    db.prepare("UPDATE users SET is_active = 0 WHERE employee_id = ? AND role = 'employee'").bind(employeeId),
    db.prepare("UPDATE devices SET status = 'reset', reset_by_user_id = ?, reset_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND status = 'registered'").bind(adminUserId, employeeId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(crypto.randomUUID(), adminUserId, "delete_employee", "employee", employeeId, JSON.stringify(before), JSON.stringify({ status: "deleted" })),
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

async function reviewLeaveRequest(
  db: D1Database,
  request: Request,
  payload: Extract<AdminAction, { action: "review_leave_request" }>,
  adminUserId: string,
) {
  if (!payload.requestId || (payload.status !== "approved" && payload.status !== "rejected")) {
    return json(request, { error: "Leave request and review status are required." }, 400);
  }

  const before = await db.prepare("SELECT * FROM leave_requests WHERE id = ?").bind(payload.requestId).first();
  if (!before) return json(request, { error: "Leave/MC request was not found." }, 404);
  const currentStatus = String((before as { status?: string }).status || "");
  if (currentStatus === "cancelled") {
    return json(request, { error: "Cancelled Leave/MC cannot be approved or rejected." }, 409);
  }

  await db.batch([
    db
      .prepare(
        `UPDATE leave_requests
         SET status = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP, admin_note = ?
         WHERE id = ?`,
      )
      .bind(payload.status, adminUserId, payload.adminNote?.trim() || null, payload.requestId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        adminUserId,
        `leave_${payload.status}`,
        "leave_request",
        payload.requestId,
        JSON.stringify(before),
        JSON.stringify({ status: payload.status }),
      ),
  ]);

  if (payload.status === "approved") {
    await applyHalfDayLeaveAttendanceRule(db, payload.requestId);
  }

  return json(request, { ok: true });
}

async function reviewCorrectionRequest(
  db: D1Database,
  request: Request,
  payload: Extract<AdminAction, { action: "review_correction" }>,
  adminUserId: string,
) {
  if (!payload.requestId || (payload.status !== "approved" && payload.status !== "rejected")) {
    return json(request, { error: "Correction request and review status are required." }, 400);
  }

  const correction = await db
    .prepare("SELECT * FROM attendance_corrections WHERE id = ? AND status = 'pending'")
    .bind(payload.requestId)
    .first<Record<string, string | null>>();
  if (!correction) return json(request, { error: "Pending correction was not found." }, 404);

  let newRecordJson: string | null = null;
  let reviewedAttendanceId = correction.attendance_id;
  if (payload.status === "approved") {
    const existingRecord = await findTargetAttendanceForCorrection(db, correction);
    const attendanceId = String(existingRecord?.id ?? correction.attendance_id ?? crypto.randomUUID());
    reviewedAttendanceId = attendanceId;

    if (existingRecord) {
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
      const status = totals.lateMinutes > 0 ? "late" : totals.earlyLeaveMinutes > 0 ? "early_leave" : "present";
      await db
        .prepare(
          `UPDATE attendance
           SET total_minutes = ?, late_minutes = ?, early_leave_minutes = ?,
               overtime_minutes = ?, status = ?, updated_at = CURRENT_TIMESTAMP
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

  await db.batch([
    db
      .prepare(
        `UPDATE attendance_corrections
         SET attendance_id = ?, status = ?, reviewed_by_user_id = ?, reviewed_at = CURRENT_TIMESTAMP,
             admin_note = ?, new_record_json = ?
         WHERE id = ?`,
      )
      .bind(reviewedAttendanceId, payload.status, adminUserId, payload.adminNote?.trim() || null, newRecordJson, payload.requestId),
    db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        adminUserId,
        `correction_${payload.status}`,
        "attendance_corrections",
        payload.requestId,
        JSON.stringify(correction),
        newRecordJson,
      ),
  ]);

  return json(request, { ok: true });
}

async function findTargetAttendanceForCorrection(db: D1Database, correction: Record<string, string | null>) {
  if ((correction.missing_type === "clock_out" || correction.missing_type === "both") && correction.requested_clock_out_at) {
    const openRecord = await db
      .prepare(
        `SELECT *
         FROM attendance
         WHERE employee_id = ? AND work_date = ?
           AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
         ORDER BY clock_in_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(correction.employee_id, correction.requested_date)
      .first<Record<string, string | number | null>>();
    if (openRecord) return openRecord;
  }

  if ((correction.missing_type === "clock_in" || correction.missing_type === "both") && correction.requested_clock_in_at) {
    const missingInRecord = await db
      .prepare(
        `SELECT *
         FROM attendance
         WHERE employee_id = ? AND work_date = ?
           AND clock_in_at IS NULL AND clock_out_at IS NOT NULL
         ORDER BY clock_out_at DESC, updated_at DESC
         LIMIT 1`,
      )
      .bind(correction.employee_id, correction.requested_date)
      .first<Record<string, string | number | null>>();
    if (missingInRecord) return missingInRecord;
  }

  if (correction.attendance_id) {
    const linkedRecord = await db
      .prepare("SELECT * FROM attendance WHERE id = ?")
      .bind(correction.attendance_id)
      .first<Record<string, string | number | null>>();
    if (linkedRecord) return linkedRecord;
  }

  return db
    .prepare(
      `SELECT *
       FROM attendance
       WHERE employee_id = ? AND work_date = ?
       ORDER BY updated_at DESC, clock_in_at DESC, clock_out_at DESC
       LIMIT 1`,
    )
    .bind(correction.employee_id, correction.requested_date)
    .first<Record<string, string | number | null>>();
}

async function saveReportAttendanceTimes(
  db: D1Database,
  request: Request,
  payload: Extract<AdminAction, { action: "save_report_attendance_times" }>,
  adminUserId: string,
) {
  if (!payload.employeeId || !Array.isArray(payload.rows)) {
    return json(request, { error: "Employee and report time rows are required." }, 400);
  }

  const employee = await db
    .prepare("SELECT id FROM employees WHERE id = ? AND status <> 'deleted'")
    .bind(payload.employeeId)
    .first<{ id: string }>();
  if (!employee) return json(request, { error: "Employee was not found." }, 404);

  for (const row of payload.rows) {
    const dateKey = row.dateKey?.trim();
    if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;

    await db
      .prepare("DELETE FROM attendance WHERE employee_id = ? AND work_date = ? AND source = 'admin_report_edit'")
      .bind(payload.employeeId, dateKey)
      .run();

    const segments = reportTimeSegments(dateKey, row);
    let previousRegularMinutes = await getPreviousRegularMinutesExcludingSource(
      db,
      payload.employeeId,
      dateKey,
      "admin_report_edit",
    );

    for (const segment of segments) {
      const schedule = await db
        .prepare(
          "SELECT start_time, end_time, overtime_starts_at, is_off_day FROM working_schedule WHERE warehouse_id = 'wh-main' AND day_of_week = ?",
        )
        .bind(localDayOfWeek(`${dateKey}T12:00:00+08:00`, "Asia/Kuala_Lumpur"))
        .first();
      const totals = calculateAttendanceTotals(segment.clockInAt, segment.clockOutAt, schedule, "Asia/Kuala_Lumpur", {
        previousRegularMinutes,
      });
      previousRegularMinutes += Math.max(0, totals.totalMinutes - totals.overtimeMinutes);
      const status = totals.lateMinutes > 0 ? "late" : totals.earlyLeaveMinutes > 0 ? "early_leave" : "present";
      await db
        .prepare(
          `INSERT INTO attendance
           (id, employee_id, warehouse_id, work_date, clock_in_at, clock_out_at,
            total_minutes, late_minutes, early_leave_minutes, overtime_minutes,
            status, source, updated_at)
           VALUES (?, ?, 'wh-main', ?, ?, ?, ?, ?, ?, ?, ?, 'admin_report_edit', CURRENT_TIMESTAMP)`,
        )
        .bind(
          crypto.randomUUID(),
          payload.employeeId,
          dateKey,
          segment.clockInAt,
          segment.clockOutAt,
          totals.totalMinutes,
          totals.lateMinutes,
          totals.earlyLeaveMinutes,
          totals.overtimeMinutes,
          status,
        )
        .run();
    }

    await db
      .prepare(
        "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        crypto.randomUUID(),
        adminUserId,
        "monthly_report_time_edit",
        "attendance",
        payload.employeeId,
        null,
        JSON.stringify({ dateKey, ...row, segments }),
      )
      .run();
  }

  return json(request, { ok: true });
}

async function restoreReportAttendanceTimes(
  db: D1Database,
  request: Request,
  payload: Extract<AdminAction, { action: "restore_report_attendance_times" }>,
  adminUserId: string,
) {
  if (!payload.employeeId || !payload.monthKey || !/^\d{4}-\d{2}$/.test(payload.monthKey)) {
    return json(request, { error: "Employee and report month are required." }, 400);
  }

  await db
    .prepare("DELETE FROM attendance WHERE employee_id = ? AND work_date LIKE ? AND source = 'admin_report_edit'")
    .bind(payload.employeeId, `${payload.monthKey}-%`)
    .run();

  await db
    .prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      adminUserId,
      "monthly_report_time_restore",
      "attendance",
      payload.employeeId,
      null,
      JSON.stringify({ monthKey: payload.monthKey }),
    )
    .run();

  return json(request, { ok: true });
}

function reportTimeSegments(
  dateKey: string,
  row: { in?: string; break?: string; resume?: string; out?: string },
) {
  const inMs = reportTimeToMs(dateKey, row.in);
  const breakMs = reportTimeToMs(dateKey, row.break, inMs);
  const resumeMs = reportTimeToMs(dateKey, row.resume, breakMs ?? inMs);
  const outMs = reportTimeToMs(dateKey, row.out, resumeMs ?? breakMs ?? inMs);
  const segments: Array<{ clockInAt: string; clockOutAt: string }> = [];
  if (inMs != null && breakMs != null && breakMs > inMs) {
    segments.push({ clockInAt: new Date(inMs).toISOString(), clockOutAt: new Date(breakMs).toISOString() });
  }
  if (resumeMs != null && outMs != null && outMs > resumeMs) {
    segments.push({ clockInAt: new Date(resumeMs).toISOString(), clockOutAt: new Date(outMs).toISOString() });
  }
  if (!segments.length && inMs != null && outMs != null && outMs > inMs) {
    segments.push({ clockInAt: new Date(inMs).toISOString(), clockOutAt: new Date(outMs).toISOString() });
  }
  return segments;
}

function reportTimeToMs(dateKey: string, value?: string, afterMs: number | null = null) {
  const normalized = normalizeReportTime(value);
  if (!normalized) return null;
  let ms = Date.parse(`${dateKey}T${normalized}:00+08:00`);
  if (afterMs != null && ms <= afterMs) ms += 24 * 60 * 60000;
  return ms;
}

function normalizeReportTime(value?: string) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/[^\d]/g, "");
  let hour: number;
  let minute: number;
  if (/^\d{1,2}:\d{1,2}$/.test(text)) {
    const parts = text.split(":");
    hour = Number(parts[0]);
    minute = Number(parts[1]);
  } else if (digits.length <= 2) {
    hour = Number(digits);
    minute = 0;
  } else {
    hour = Number(digits.slice(0, -2));
    minute = Number(digits.slice(-2));
  }
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeLeaveDays(value: number | string) {
  const days = Number(value);
  if (!Number.isFinite(days) || days < 0) return 0;
  return Math.round(days * 2) / 2;
}

async function applyHalfDayLeaveAttendanceRule(db: D1Database, requestId: string) {
  const leave = await db
    .prepare("SELECT employee_id, leave_date, duration FROM leave_requests WHERE id = ? AND status = 'approved'")
    .bind(requestId)
    .first<{ employee_id: string; leave_date: string; duration: string }>();
  if (leave?.duration !== "half_day") return;

  const summary = await db
    .prepare(
      `SELECT COALESCE(SUM(total_minutes), 0) AS total_minutes
       FROM attendance
       WHERE employee_id = ? AND work_date = ? AND clock_out_at IS NOT NULL`,
    )
    .bind(leave.employee_id, leave.leave_date)
    .first<{ total_minutes: number }>();
  const shortMinutes = Math.max(0, 240 - Number(summary?.total_minutes || 0));
  if (!shortMinutes) return;

  const latest = await db
    .prepare(
      `SELECT id, late_minutes
       FROM attendance
       WHERE employee_id = ? AND work_date = ? AND clock_out_at IS NOT NULL
       ORDER BY clock_out_at DESC, updated_at DESC
       LIMIT 1`,
    )
    .bind(leave.employee_id, leave.leave_date)
    .first<{ id: string; late_minutes: number }>();
  if (!latest) return;

  await db
    .prepare("UPDATE attendance SET late_minutes = ?, status = 'late', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .bind(Math.max(Number(latest.late_minutes || 0), shortMinutes), latest.id)
    .run();
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
       WHERE employee_id = ? AND work_date = ? AND id <> ?`,
    )
    .bind(employeeId, workDate, currentAttendanceId)
    .all<{ total_minutes: number | null; overtime_minutes: number | null }>();
  return (rows.results ?? []).reduce((total, row) => {
    return total + Math.max(0, Number(row.total_minutes || 0) - Number(row.overtime_minutes || 0));
  }, 0);
}

async function getPreviousRegularMinutesExcludingSource(
  db: D1Database,
  employeeId: string,
  workDate: string,
  excludedSource: string,
) {
  const rows = await db
    .prepare(
      `SELECT total_minutes, overtime_minutes
       FROM attendance
       WHERE employee_id = ? AND work_date = ? AND source <> ?`,
    )
    .bind(employeeId, workDate, excludedSource)
    .all<{ total_minutes: number | null; overtime_minutes: number | null }>();
  return (rows.results ?? []).reduce((total, row) => {
    return total + Math.max(0, Number(row.total_minutes || 0) - Number(row.overtime_minutes || 0));
  }, 0);
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
