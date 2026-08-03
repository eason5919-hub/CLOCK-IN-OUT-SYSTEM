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
  id: string;
  work_date: string;
  clock_in_at: string | null;
  clock_out_at: string | null;
};

type ScheduleRow = AttendanceSchedule;

const MAX_GPS_ACCURACY_METERS = 30;

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

    const bestSample = pickBestSample(payload.samples!);
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

    const ip = request.headers.get("cf-connecting-ip") ?? "local";

    if (payload.action === "clock_in") {
      if (activeOpenRecord) {
        return json(request, { error: "Clock out is required before the next clock in." }, 409);
      }

      const lateMinutes = calculateAttendanceTotals(timestamp, timestamp, todaysSchedule, timeZone).lateMinutes;
      const status = lateMinutes > 0 ? "late" : "present";
      const attendanceId = crypto.randomUUID();

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

      await writeAudit(db, session.user_id, "clock_in", "attendance", attendanceId, null, { timestamp });
      return json(request, { ok: true, action: "clock_in", timestamp, distance, accuracy: bestSample.accuracy });
    }

    const existing = activeOpenRecord;

    if (!existing?.clock_in_at) {
      return json(request, { error: "Clock in is required before clock out." }, 409);
    }
    if (existing.clock_out_at) {
      return json(request, { error: "Clock out already recorded for today." }, 409);
    }

    const schedule = await loadSchedule(db, warehouse.id, localDayOfWeek(existing.clock_in_at, timeZone));
    const totals = calculateAttendanceTotals(existing.clock_in_at, timestamp, schedule, timeZone);
    const status =
      totals.lateMinutes > 0 ? "late" : totals.earlyLeaveMinutes > 0 ? "early_leave" : "present";

    await db
      .prepare(
        `UPDATE attendance
         SET clock_out_at = ?, total_minutes = ?, late_minutes = ?, early_leave_minutes = ?,
             overtime_minutes = ?, status = ?, clock_out_latitude = ?, clock_out_longitude = ?,
             clock_out_accuracy = ?, clock_out_distance_meters = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
      .bind(
        timestamp,
        totals.totalMinutes,
        totals.lateMinutes,
        totals.earlyLeaveMinutes,
        totals.overtimeMinutes,
        status,
        bestSample.latitude,
        bestSample.longitude,
        bestSample.accuracy,
        distance,
        existing.id,
      )
      .run();

    await writeAudit(db, session.user_id, "clock_out", "attendance", existing.id, null, { timestamp });
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
       WHERE employee_id = ? AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
       ORDER BY work_date DESC, updated_at DESC, clock_in_at DESC
       LIMIT 1`,
    )
    .bind(employeeId)
    .first<AttendanceRow>();

  if (!existing || !isOpenAttendanceStillActive(existing.work_date, timestamp, timeZone)) return null;
  return existing;
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
