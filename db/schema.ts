import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const departments = sqliteTable("departments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  managerName: text("manager_name"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const employees = sqliteTable("employees", {
  id: text("id").primaryKey(),
  employeeCode: text("employee_code").notNull().unique(),
  fullName: text("full_name").notNull(),
  departmentId: text("department_id").references(() => departments.id),
  position: text("position").notNull().default("Warehouse Associate"),
  phone: text("phone"),
  email: text("email"),
  status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "hr", "employee"] }).notNull(),
  employeeId: text("employee_id").references(() => employees.id),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text("last_login_at"),
});

export const warehouses = sqliteTable("warehouses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  allowedRadiusMeters: integer("allowed_radius_meters").notNull().default(100),
  timezone: text("timezone").notNull().default("Asia/Kuala_Lumpur"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    deviceFingerprint: text("device_fingerprint").notNull().unique(),
    deviceModel: text("device_model").notNull(),
    status: text("status", { enum: ["registered", "reset_pending", "blocked"] })
      .notNull()
      .default("registered"),
    registeredAt: text("registered_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSeenAt: text("last_seen_at"),
    resetByUserId: text("reset_by_user_id").references(() => users.id),
    resetAt: text("reset_at"),
  },
  (table) => [index("idx_devices_employee_id").on(table.employeeId)],
);

export const qrCodes = sqliteTable("qr_codes", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  tokenHash: text("token_hash").notNull().unique(),
  version: integer("version").notNull().default(1),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  generatedByUserId: text("generated_by_user_id").references(() => users.id),
  generatedAt: text("generated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const workingSchedule = sqliteTable("working_schedule", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
  dayOfWeek: integer("day_of_week").notNull(),
  startTime: text("start_time"),
  endTime: text("end_time"),
  isOffDay: integer("is_off_day", { mode: "boolean" }).notNull().default(false),
  overtimeStartsAt: text("overtime_starts_at"),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const attendance = sqliteTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    warehouseId: text("warehouse_id").notNull().references(() => warehouses.id),
    workDate: text("work_date").notNull(),
    clockInAt: text("clock_in_at"),
    clockOutAt: text("clock_out_at"),
    totalMinutes: integer("total_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyLeaveMinutes: integer("early_leave_minutes").notNull().default(0),
    overtimeMinutes: integer("overtime_minutes").notNull().default(0),
    status: text("status", {
      enum: ["present", "absent", "late", "early_leave", "pending_review"],
    })
      .notNull()
      .default("present"),
    clockInLatitude: real("clock_in_latitude"),
    clockInLongitude: real("clock_in_longitude"),
    clockInAccuracy: real("clock_in_accuracy"),
    clockInDistanceMeters: real("clock_in_distance_meters"),
    clockOutLatitude: real("clock_out_latitude"),
    clockOutLongitude: real("clock_out_longitude"),
    clockOutAccuracy: real("clock_out_accuracy"),
    clockOutDistanceMeters: real("clock_out_distance_meters"),
    deviceId: text("device_id").references(() => devices.id),
    deviceModel: text("device_model"),
    ipAddress: text("ip_address"),
    source: text("source", { enum: ["qr_gps", "admin_adjustment"] }).notNull().default("qr_gps"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("idx_attendance_employee_date").on(table.employeeId, table.workDate),
    index("idx_attendance_work_date").on(table.workDate),
  ],
);

export const attendanceCorrections = sqliteTable(
  "attendance_corrections",
  {
    id: text("id").primaryKey(),
    attendanceId: text("attendance_id").references(() => attendance.id),
    employeeId: text("employee_id").notNull().references(() => employees.id),
    requestedDate: text("requested_date").notNull(),
    missingType: text("missing_type", { enum: ["clock_in", "clock_out", "both"] }).notNull(),
    requestedClockInAt: text("requested_clock_in_at"),
    requestedClockOutAt: text("requested_clock_out_at"),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id),
    reviewedAt: text("reviewed_at"),
    adminNote: text("admin_note"),
    originalRecordJson: text("original_record_json"),
    newRecordJson: text("new_record_json"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_corrections_status").on(table.status)],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedByUserId: text("updated_by_user_id").references(() => users.id),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    ipAddress: text("ip_address"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_audit_entity").on(table.entityType, table.entityId)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: ["owner", "hr", "employee"] }).notNull(),
    employeeId: text("employee_id").references(() => employees.id),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("idx_sessions_user_id").on(table.userId)],
);
