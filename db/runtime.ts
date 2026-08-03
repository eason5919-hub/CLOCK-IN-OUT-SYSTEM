import { env } from "cloudflare:workers";

export type GpsSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp?: string;
};

export function getD1() {
  if (!env.DB) {
    throw new Error("D1 binding DB is unavailable.");
  }

  return env.DB;
}

export async function ensureDatabase(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));

  const existing = await db
    .prepare("SELECT COUNT(*) AS count FROM departments")
    .first<{ count: number }>();

  if ((existing?.count ?? 0) > 0) return;

  const qrHash = await sha256Hex("WAREHOUSE-MAIN-QR");
  const passwordHash =
    "pbkdf2:310000:sample-salt:replace-with-real-password-hash";

  await db.batch([
    db
      .prepare("INSERT INTO departments (id, name, manager_name) VALUES (?, ?, ?)")
      .bind("dept-ops", "Operations", "Lina Wong"),
    db
      .prepare("INSERT INTO departments (id, name, manager_name) VALUES (?, ?, ?)")
      .bind("dept-pick", "Picking", "Arun Kumar"),
    db
      .prepare(
        "INSERT INTO warehouses (id, name, latitude, longitude, allowed_radius_meters, timezone) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("wh-main", "Main Warehouse", 3.139, 101.6869, 100, "Asia/Kuala_Lumpur"),
    db
      .prepare(
        "INSERT INTO employees (id, employee_code, full_name, department_id, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "emp-001",
        "WH-001",
        "Siti Rahman",
        "dept-ops",
        "Warehouse Supervisor",
        "+60 12-400 1001",
        "siti@example.com",
        "active",
      ),
    db
      .prepare(
        "INSERT INTO employees (id, employee_code, full_name, department_id, position, phone, email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        "emp-002",
        "WH-002",
        "Daniel Tan",
        "dept-pick",
        "Picker",
        "+60 12-400 1002",
        "daniel@example.com",
        "active",
      ),
    db
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, employee_id, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("user-owner", "owner@example.com", passwordHash, "owner", null, 1),
    db
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, employee_id, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("user-hr", "hr@example.com", passwordHash, "hr", null, 1),
    db
      .prepare(
        "INSERT INTO users (id, email, password_hash, role, employee_id, is_active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("user-emp-001", "siti@example.com", passwordHash, "employee", "emp-001", 1),
    db
      .prepare(
        "INSERT INTO qr_codes (id, warehouse_id, token_hash, version, is_active, generated_by_user_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind("qr-main-v1", "wh-main", qrHash, 1, 1, "user-owner"),
    ...scheduleSeed.map((row) =>
      db
        .prepare(
          "INSERT INTO working_schedule (id, warehouse_id, day_of_week, start_time, end_time, is_off_day, overtime_starts_at, updated_by_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          `sched-${row.day}`,
          "wh-main",
          row.day,
          row.start,
          row.end,
          row.off ? 1 : 0,
          row.ot,
          "user-owner",
        ),
    ),
    db
      .prepare("INSERT INTO settings (key, value, updated_by_user_id) VALUES (?, ?, ?)")
      .bind("gps_accuracy_target_meters", "30", "user-owner"),
    db
      .prepare("INSERT INTO settings (key, value, updated_by_user_id) VALUES (?, ?, ?)")
      .bind("default_radius_meters", "100", "user-owner"),
  ]);
}

export function pickBestSample(samples: GpsSample[]) {
  return [...samples].sort((a, b) => a.accuracy - b.accuracy)[0];
}

export function distanceMeters(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
) {
  const radius = 6371000;
  const dLat = toRadians(toLat - fromLat);
  const dLng = toRadians(toLng - fromLng);
  const lat1 = toRadians(fromLat);
  const lat2 = toRadians(toLat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

const scheduleSeed = [
  { day: 1, start: "09:00", end: "18:00", off: false, ot: "18:00" },
  { day: 2, start: "09:00", end: "18:00", off: false, ot: "18:00" },
  { day: 3, start: "09:00", end: "18:00", off: false, ot: "18:00" },
  { day: 4, start: "09:00", end: "18:00", off: false, ot: "18:00" },
  { day: 5, start: "09:00", end: "18:00", off: false, ot: "18:00" },
  { day: 6, start: "09:00", end: "13:00", off: false, ot: "13:00" },
  { day: 0, start: null, end: null, off: true, ot: null },
];

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    manager_name TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    employee_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    department_id TEXT REFERENCES departments(id),
    position TEXT NOT NULL DEFAULT 'Warehouse Associate',
    phone TEXT,
    email TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    employee_id TEXT REFERENCES employees(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    allowed_radius_meters INTEGER NOT NULL DEFAULT 100,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    device_fingerprint TEXT NOT NULL UNIQUE,
    device_model TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'registered',
    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TEXT,
    reset_by_user_id TEXT REFERENCES users(id),
    reset_at TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS qr_codes (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    token_hash TEXT NOT NULL UNIQUE,
    version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    generated_by_user_id TEXT REFERENCES users(id),
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS working_schedule (
    id TEXT PRIMARY KEY,
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    day_of_week INTEGER NOT NULL,
    start_time TEXT,
    end_time TEXT,
    is_off_day INTEGER NOT NULL DEFAULT 0,
    overtime_starts_at TEXT,
    updated_by_user_id TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS attendance (
    id TEXT PRIMARY KEY,
    employee_id TEXT NOT NULL REFERENCES employees(id),
    warehouse_id TEXT NOT NULL REFERENCES warehouses(id),
    work_date TEXT NOT NULL,
    clock_in_at TEXT,
    clock_out_at TEXT,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    late_minutes INTEGER NOT NULL DEFAULT 0,
    early_leave_minutes INTEGER NOT NULL DEFAULT 0,
    overtime_minutes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'present',
    clock_in_latitude REAL,
    clock_in_longitude REAL,
    clock_in_accuracy REAL,
    clock_in_distance_meters REAL,
    clock_out_latitude REAL,
    clock_out_longitude REAL,
    clock_out_accuracy REAL,
    clock_out_distance_meters REAL,
    device_id TEXT REFERENCES devices(id),
    device_model TEXT,
    ip_address TEXT,
    source TEXT NOT NULL DEFAULT 'qr_gps',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, work_date)`,
  `CREATE INDEX IF NOT EXISTS idx_attendance_work_date ON attendance(work_date)`,
  `CREATE TABLE IF NOT EXISTS attendance_corrections (
    id TEXT PRIMARY KEY,
    attendance_id TEXT REFERENCES attendance(id),
    employee_id TEXT NOT NULL REFERENCES employees(id),
    requested_date TEXT NOT NULL,
    missing_type TEXT NOT NULL,
    requested_clock_in_at TEXT,
    requested_clock_out_at TEXT,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by_user_id TEXT REFERENCES users(id),
    reviewed_at TEXT,
    admin_note TEXT,
    original_record_json TEXT,
    new_record_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_corrections_status ON attendance_corrections(status)`,
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by_user_id TEXT REFERENCES users(id),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id)`,
  `PRAGMA optimize`,
];
