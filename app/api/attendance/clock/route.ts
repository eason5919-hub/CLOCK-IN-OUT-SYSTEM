import {
  distanceMeters,
  ensureDatabase,
  getD1,
  getSessionFromRequest,
  pickBestSample,
  sha256Hex,
  type GpsSample,
} from "../../../../db/runtime";
import {
  calculateAttendanceTotals,
  isOpenAttendanceStillActive,
  localDayOfWeek,
  localWorkDate,
  type AttendanceSchedule,
} from "../../../../db/attendance-calculations";

type ClockPayload = {
  employeeId?: string;
  action?: "clock_in" | "clock_out";
  qrToken?: string;
  deviceFingerprint?: string;
  deviceModel?: string;
  samples?: GpsSample[];
};

type WarehouseRow = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  allowed_radius_meters: number;
  timezone: string;
};

type AttendanceRow = {
  id: string | null;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
  late_minutes: number;
  overtime_minutes: number;
  total_minutes: number;
};

type ScheduleRow = AttendanceSchedule;

const MAX_GPS_ACCURACY_METERS = 30;
const GPS_SAMPLE_MAX_AGE_MS = 15000;
const HALF_DAY_REQUIRED_MINUTES = 240;

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ClockPayload;
    const validation = validatePayload(payload);
    if (validation) return json(request, { error: validation }, 400);

    const db = getD1();
    await ensureDatabase(db);
    const session = await getSessionFromRequest(db, request);
    if (session?.role !== "employee" || !session.employee_id) {
      return json(request, { error: "Employee login is required." }, 401);
    }
    if (payload.employeeId && payload.employeeId !== session.employee_id) {
      return json(request, { error: "Employees can only clock their own attendance." }, 403);
    }
    payload.employeeId = session.employee_id;

    const qrHash = await sha256Hex(payload.qrToken!);
    const warehouse = await db
      .prepare(
        `SELECT w.id, w.name, w.latitude, w.longitude, w.allowed_radius_meters, w.timezone
         FROM qr_codes q
         JOIN warehouses w ON w.id = q.warehouse_id
         WHERE q.token_hash = ? AND q.is_active = 1`,
      )
      .bind(qrHash)
      .first<WarehouseRow>();

    if (!warehouse) {
      return json(request, { error: "Invalid warehouse QR code." }, 403);
    }

    const freshSamples = freshGpsSamples(payload.samples!);
    if (freshSamples.length < 5) {
      return json(request, { error: "Unable to verify fresh GPS location. Please enable phone GPS and try again." }, 400);
    }
    const bestSample = pickBestSample(freshSamples);
    const distance = distanceMeters(
      bestSample.latitude,
      bestSample.longitude,
      warehouse.latitude,
      warehouse.longitude,
    );

    const allowedDistance = warehouse.allowed_radius_meters;

    if (bestSample.accuracy > MAX_GPS_ACCURACY_METERS || distance > allowedDistance) {
      return json(
        request,
        {
          error:
            `Unable to verify location. GPS accuracy ${Math.round(bestSample.accuracy)}m, distance ${Math.round(distance)}m, allowed ${Math.round(allowedDistance)}m.`,
          accuracy: bestSample.accuracy,
          distance,
          allowedDistance,
        },
        403,
      );
    }

    const employee = await db
      .prepare("SELECT id FROM employees WHERE id = ? AND status = 'active'")
      .bind(payload.employeeId)
      .first<{ id: string }>();

    if (!employee) {
      return json(request, { error: "Employee account is inactive or missing." }, 404);
    }

    const device = await resolveDevice(db, payload);
    if ("error" in device) return json(request, { error: device.error }, 403);

    const now = new Date();
    const timestamp = now.toISOString();
    const timeZone = warehouse.timezone || "Asia/Kuala_Lumpur";
    const workDate = localWorkDate(timestamp, timeZone);
    const todaysSchedule = await loadSchedule(db, warehouse.id, localDayOfWeek(timestamp, timeZone));
    const activeOpenRecord = await findActiveOpenRecord(db, payload.employeeId, timestamp, timeZone);
    const todaysQrRecord = await findQrAttendanceForDate(db, payload.employeeId, workDate);

    const ip = request.headers.get("cf-connecting-ip") ?? "local";

    if (payload.action === "clock_in") {
      if (activeOpenRecord) {
        return json(request, {
          ok: true,
          action: "clock_in_existing",
          timestamp,
          clockInAt: activeOpenRecord.clock_in_at,
          distance,
          accuracy: bestSample.accuracy,
        });
      }
      if (todaysQrRecord?.clock_out_at) {
        return json(request, { error: "Attendance already completed for today." }, 409);
      }
      if (todaysQrRecord?.clock_in_at) {
        return json(request, {
          ok: true,
          action: "clock_in_existing",
          timestamp,
          clockInAt: todaysQrRecord.clock_in_at,
          distance,
          accuracy: bestSample.accuracy,
        });
      }

      const lateMinutes = calculateAttendanceTotals(timestamp, timestamp, todaysSchedule, timeZone).lateMinutes;
      const status = lateMinutes > 0 ? "late" : "present";
      const attendanceId = todaysQrRecord?.id || crypto.randomUUID();

      if (todaysQrRecord?.id) {
        await db
          .prepare(
            `UPDATE attendance
             SET clock_in_at = ?, clock_out_at = NULL, total_minutes = 0, late_minutes = ?,
                 early_leave_minutes = 0, overtime_minutes = 0, status = ?,
                 clock_in_latitude = ?, clock_in_longitude = ?, clock_in_accuracy = ?,
                 clock_in_distance_meters = ?, device_id = ?, device_model = ?, ip_address = ?,
                 source = 'qr_gps', updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .bind(
            timestamp,
            lateMinutes,
            status,
            bestSample.latitude,
            bestSample.longitude,
            bestSample.accuracy,
            distance,
            device.id,
            payload.deviceModel,
            ip,
            attendanceId,
          )
          .run();
      } else {
        await db
          .prepare(
            `INSERT INTO attendance
             (id, employee_id, warehouse_id, work_date, clock_in_at, late_minutes, status,
              clock_in_latitude, clock_in_longitude, clock_in_accuracy, clock_in_distance_meters,
              device_id, device_model, ip_address)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            attendanceId,
            payload.employeeId,
            warehouse.id,
            workDate,
            timestamp,
            lateMinutes,
            status,
            bestSample.latitude,
            bestSample.longitude,
            bestSample.accuracy,
            distance,
            device.id,
            payload.deviceModel,
            ip,
          )
          .run();
      }

      await writeAudit(db, session.user_id, "clock_in", "attendance", attendanceId, null, { timestamp });
      await archiveReportFieldMarkers(db, payload.employeeId, workDate, "in");
      return json(request, { ok: true, action: "clock_in", timestamp, distance, accuracy: bestSample.accuracy });
    }

    if (todaysQrRecord?.clock_out_at) {
      return json(request, { error: "Clock out already recorded for today." }, 409);
    }

    const existing = activeOpenRecord || (todaysQrRecord?.clock_in_at && !todaysQrRecord.clock_out_at ? todaysQrRecord : null);

    if (!existing?.clock_in_at) {
      return json(request, { error: "Clock in is required before clock out." }, 409);
    }
    if (existing.clock_out_at) {
      return json(request, { error: "Clock out already recorded for today." }, 409);
    }

    const clockInClearedByAdmin = await hasClearedReportFieldMarker(db, payload.employeeId, existing.work_date, "in");
    const schedule = await loadSchedule(db, warehouse.id, localDayOfWeek(existing.clock_in_at, timeZone));
    const previousRegularMinutes = existing.id ? await getPreviousRegularMinutes(db, payload.employeeId, existing.work_date, existing.id) : 0;
    const calculatedTotals = calculateAttendanceTotals(existing.clock_in_at, timestamp, schedule, timeZone, {
      previousRegularMinutes,
    });
    const halfDayLeave = await hasApprovedHalfDayLeave(db, payload.employeeId, existing.work_date);
    const halfDayShortMinutes = halfDayLeave ? Math.max(0, HALF_DAY_REQUIRED_MINUTES - calculatedTotals.totalMinutes) : 0;
    const calculatedLateMinutes = Math.max(Number(existing.late_minutes || calculatedTotals.lateMinutes), halfDayShortMinutes);
    const totals = clockInClearedByAdmin
      ? { totalMinutes: 0, lateMinutes: 0, earlyLeaveMinutes: 0, overtimeMinutes: 0 }
      : calculatedTotals;
    const lateMinutes = clockInClearedByAdmin ? 0 : calculatedLateMinutes;
    const status = clockInClearedByAdmin
      ? "pending_review"
      : lateMinutes > 0
        ? "late"
        : totals.earlyLeaveMinutes > 0
          ? "early_leave"
          : "present";

    const attendanceId = existing.id || crypto.randomUUID();
    if (existing.id) {
      await db
        .prepare(
          `UPDATE attendance
           SET clock_in_at = CASE WHEN ? THEN NULL ELSE clock_in_at END,
               clock_out_at = ?, total_minutes = ?, late_minutes = ?, early_leave_minutes = ?,
               overtime_minutes = ?, status = ?, clock_out_latitude = ?, clock_out_longitude = ?,
               clock_out_accuracy = ?, clock_out_distance_meters = ?, source = 'qr_gps', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .bind(
          clockInClearedByAdmin ? 1 : 0,
          timestamp,
          totals.totalMinutes,
          lateMinutes,
          totals.earlyLeaveMinutes,
          totals.overtimeMinutes,
          status,
          bestSample.latitude,
          bestSample.longitude,
          bestSample.accuracy,
          distance,
          attendanceId,
        )
        .run();
    } else {
      await db
        .prepare(
          `INSERT INTO attendance
           (id, employee_id, warehouse_id, work_date, clock_in_at, clock_out_at,
            total_minutes, late_minutes, early_leave_minutes, overtime_minutes, status,
            clock_out_latitude, clock_out_longitude, clock_out_accuracy, clock_out_distance_meters,
            device_id, device_model, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attendanceId,
          payload.employeeId,
          warehouse.id,
          existing.work_date,
          existing.clock_in_at,
          timestamp,
          totals.totalMinutes,
          lateMinutes,
          totals.earlyLeaveMinutes,
          totals.overtimeMinutes,
          status,
          bestSample.latitude,
          bestSample.longitude,
          bestSample.accuracy,
          distance,
          device.id,
          payload.deviceModel,
          ip,
        )
        .run();
    }

    await archiveReportFieldMarkers(db, payload.employeeId, existing.work_date, "out");
    await writeAudit(db, session.user_id, "clock_out", "attendance", attendanceId, null, { timestamp });
    return json(request, { ok: true, action: "clock_out", timestamp, distance, accuracy: bestSample.accuracy, totals });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return json(request, { error: message }, 500);
  }
}

export async function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

function validatePayload(payload: ClockPayload) {
  if (!payload.employeeId) return "employeeId is required.";
  if (payload.action !== "clock_in" && payload.action !== "clock_out") {
    return "action must be clock_in or clock_out.";
  }
  if (!payload.qrToken) return "qrToken is required.";
  if (!payload.deviceFingerprint) return "deviceFingerprint is required.";
  if (!payload.deviceModel) return "deviceModel is required.";
  if (!payload.samples || payload.samples.length < 5) {
    return "Minimum 5 GPS samples are required.";
  }
  return null;
}

function freshGpsSamples(samples: GpsSample[]) {
  const now = Date.now();
  return samples.filter((sample) => {
    const timestamp = typeof sample.timestamp === "number" ? sample.timestamp : Date.parse(String(sample.timestamp || ""));
    return (
      Number.isFinite(sample.latitude) &&
      Number.isFinite(sample.longitude) &&
      Number.isFinite(sample.accuracy) &&
      Number.isFinite(timestamp) &&
      now - timestamp <= GPS_SAMPLE_MAX_AGE_MS
    );
  });
}

async function resolveDevice(db: D1Database, payload: ClockPayload) {
  const current = await db
    .prepare("SELECT id, employee_id, status FROM devices WHERE device_fingerprint = ?")
    .bind(payload.deviceFingerprint)
    .first<{ id: string; employee_id: string; status: string }>();

  if (current && current.employee_id !== payload.employeeId) {
    return { error: "This phone is already registered to another employee." };
  }
  if (current && current.status !== "registered") {
    return { error: "Device registration must be reset by Admin before login." };
  }
  if (current) {
    await db
      .prepare("UPDATE devices SET last_seen_at = CURRENT_TIMESTAMP, device_model = ? WHERE id = ?")
      .bind(payload.deviceModel, current.id)
      .run();
    return { id: current.id };
  }

  const linked = await db
    .prepare("SELECT id FROM devices WHERE employee_id = ? AND status = 'registered'")
    .bind(payload.employeeId)
    .first<{ id: string }>();

  if (linked) {
    return { error: "Employee account is linked to another phone. Ask Admin to reset the device." };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      "INSERT INTO devices (id, employee_id, device_fingerprint, device_model, last_seen_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)",
    )
    .bind(id, payload.employeeId, payload.deviceFingerprint, payload.deviceModel)
    .run();
  return { id };
}

async function loadSchedule(db: D1Database, warehouseId: string, dayOfWeek: number) {
  return db
    .prepare(
      "SELECT start_time, end_time, overtime_starts_at, is_off_day FROM working_schedule WHERE warehouse_id = ? AND day_of_week = ?",
    )
    .bind(warehouseId, dayOfWeek)
    .first<ScheduleRow>();
}

async function findActiveOpenRecord(
  db: D1Database,
  employeeId: string,
  timestamp: string,
  timeZone: string,
) {
  const existing = await db
    .prepare(
      `SELECT id, work_date, clock_in_at, clock_out_at
       FROM attendance
       WHERE employee_id = ?
         AND source = 'qr_gps'
         AND clock_in_at IS NOT NULL
         AND clock_out_at IS NULL
       ORDER BY work_date DESC, updated_at DESC, clock_in_at DESC
       LIMIT 1`,
    )
    .bind(employeeId)
    .first<AttendanceRow>();

  if (!existing || !isOpenAttendanceStillActive(existing.work_date, timestamp, timeZone)) return null;
  return existing;
}

async function findQrAttendanceForDate(db: D1Database, employeeId: string, workDate: string) {
  return db
    .prepare(
      `WITH day_key AS (
         SELECT ? AS work_date
       ),
       qr_row AS (
         SELECT id, work_date, clock_in_at, clock_out_at, late_minutes, overtime_minutes, total_minutes
         FROM attendance
         WHERE employee_id = ?
           AND work_date = ?
           AND source = 'qr_gps'
         ORDER BY updated_at DESC, clock_in_at DESC, clock_out_at DESC
         LIMIT 1
       ),
       field_overrides AS (
         SELECT MAX(CASE WHEN source = 'admin_report_edit_in' THEN 1 ELSE 0 END) AS has_clock_in_override,
                MAX(CASE WHEN source = 'admin_report_edit_in' THEN clock_in_at END) AS override_clock_in_at,
                MAX(CASE WHEN source = 'admin_report_edit_out' THEN 1 ELSE 0 END) AS has_clock_out_override,
                MAX(CASE WHEN source = 'admin_report_edit_out' THEN clock_out_at END) AS override_clock_out_at
         FROM attendance
         WHERE employee_id = ?
           AND work_date = ?
           AND source IN ('admin_report_edit_in', 'admin_report_edit_out')
       )
       SELECT q.id,
              d.work_date,
              CASE WHEN COALESCE(f.has_clock_in_override, 0) = 1 THEN f.override_clock_in_at ELSE q.clock_in_at END AS clock_in_at,
              CASE WHEN COALESCE(f.has_clock_out_override, 0) = 1 THEN f.override_clock_out_at ELSE q.clock_out_at END AS clock_out_at,
              COALESCE(q.late_minutes, 0) AS late_minutes,
              COALESCE(q.overtime_minutes, 0) AS overtime_minutes,
              COALESCE(q.total_minutes, 0) AS total_minutes
       FROM day_key d
       LEFT JOIN qr_row q ON q.work_date = d.work_date
       LEFT JOIN field_overrides f`,
    )
    .bind(workDate, employeeId, workDate, employeeId, workDate)
    .first<AttendanceRow>();
}

async function archiveReportFieldMarkers(db: D1Database, employeeId: string, workDate: string, field: "in" | "out") {
  const source = field === "in" ? "admin_report_edit_in" : "admin_report_edit_out";
  await db
    .prepare(
      `UPDATE attendance
       SET source = 'admin_report_edit_archived', updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = ? AND work_date = ? AND source = ?`,
    )
    .bind(employeeId, workDate, source)
    .run();
}

async function hasClearedReportFieldMarker(db: D1Database, employeeId: string, workDate: string, field: "in" | "out") {
  const source = field === "in" ? "admin_report_edit_in" : "admin_report_edit_out";
  const column = field === "in" ? "clock_in_at" : "clock_out_at";
  const marker = await db
    .prepare(
      `SELECT id
       FROM attendance
       WHERE employee_id = ? AND work_date = ? AND source = ? AND ${column} IS NULL
       LIMIT 1`,
    )
    .bind(employeeId, workDate, source)
    .first<{ id: string }>();
  return Boolean(marker);
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

async function hasApprovedHalfDayLeave(db: D1Database, employeeId: string, workDate: string) {
  const request = await db
    .prepare(
      `SELECT id
       FROM leave_requests
       WHERE employee_id = ? AND leave_date = ? AND duration = 'half_day' AND status = 'approved'
       LIMIT 1`,
    )
    .bind(employeeId, workDate)
    .first<{ id: string }>();

  return Boolean(request);
}

async function writeAudit(
  db: D1Database,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  beforeJson: unknown,
  afterJson: unknown,
) {
  await db
    .prepare(
      "INSERT INTO audit_logs (id, actor_user_id, action, entity_type, entity_id, before_json, after_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      actorUserId,
      action,
      entityType,
      entityId,
      beforeJson ? JSON.stringify(beforeJson) : null,
      JSON.stringify(afterJson),
    )
    .run();
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
