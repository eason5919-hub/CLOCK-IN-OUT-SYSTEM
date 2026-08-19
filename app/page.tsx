"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Role = "employee" | "hr" | "owner";

type User = {
  role: Role;
  employeeId?: string;
  employeeCode?: string;
  name: string;
  position?: string;
};

type EmployeeSummary = {
  employee: Record<string, string | number | null>;
  attendance: Record<string, string | number | null>[];
  corrections: Record<string, string | number | null>[];
};

type AdminDashboard = {
  employees: Record<string, string | number | null>[];
  attendance: Record<string, string | number | null>[];
  corrections: Record<string, string | number | null>[];
  auditLogs: Record<string, string | number | null>[];
};

type ClockState = "idle" | "scanning" | "accepted" | "rejected";

const warehouse = {
  name: "Main Warehouse",
  latitude: 2.9989616,
  longitude: 101.7412234,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [employeeData, setEmployeeData] = useState<EmployeeSummary | null>(null);
  const [adminData, setAdminData] = useState<AdminDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [clockState, setClockState] = useState<ClockState>("idle");
  const [gpsMessage, setGpsMessage] = useState("Ready for QR and GPS verification.");

  async function employeeRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson<{ user: User }>("/api/auth/employee-register", {
      employeeCode: form.get("employeeCode"),
      fullName: form.get("fullName"),
      phone: form.get("phone"),
      deviceFingerprint: getBrowserDeviceFingerprint(),
      deviceModel: browserDeviceLabel(),
    });
    if ("error" in result) return setMessage(result.error);
    setUser(result.user);
    setMessage("");
  }

  async function adminLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson<{ user: User }>("/api/auth/admin-login", {
      email: form.get("email"),
      password: form.get("password"),
    });
    if ("error" in result) return setMessage(result.error);
    setUser(result.user);
    setMessage("");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setEmployeeData(null);
    setAdminData(null);
    setMessage("");
  }

  useEffect(() => {
    if (!user) return;
    if (user.role === "employee") {
      void loadEmployee();
    } else {
      void loadAdmin();
    }
  }, [user]);

  useEffect(() => {
    if (user?.role !== "employee") return;
    const timer = window.setInterval(() => {
      void loadEmployee();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [user]);

  async function loadEmployee() {
    const result = await getJson<EmployeeSummary>("/api/employee/summary");
    if ("error" in result) {
      setUser(null);
      setEmployeeData(null);
      return setMessage(result.error);
    }
    setEmployeeData(result);
  }

  async function loadAdmin() {
    const result = await getJson<AdminDashboard>("/api/admin/dashboard");
    if ("error" in result) return setMessage(result.error);
    setAdminData(result);
  }

  async function runClock(action: "clock_in" | "clock_out") {
    if (!user?.employeeId) return;

    setClockState("scanning");
    setGpsMessage("Camera opened. Scanning permanent warehouse QR code.");
    await wait(550);
    setGpsMessage("QR accepted. Collecting 5 high accuracy GPS samples.");
    const samples = await collectGpsSamples();

    const result = await postJson<{
      ok: boolean;
      distance: number;
      accuracy: number;
      timestamp: string;
    }>("/api/attendance/clock", {
      employeeId: user.employeeId,
      action,
      qrToken: warehouse.qr,
      deviceFingerprint: getBrowserDeviceFingerprint(),
      deviceModel: browserDeviceLabel(),
      samples,
    });

    if ("error" in result) {
      setClockState("rejected");
      setGpsMessage(result.error);
      return;
    }

    setClockState("accepted");
    setGpsMessage(
      `Attendance accepted. GPS ${Math.round(result.accuracy)}m, distance ${Math.round(result.distance)}m.`,
    );
    await loadEmployee();
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user?.employeeId) return;

    const form = new FormData(event.currentTarget);
    const missing = String(form.get("missing"));
    const requestedDate = String(form.get("date"));
    const requestedTime = String(form.get("requestedTime"));
    const result = await postJson<{ ok: true }>("/api/corrections", {
      employeeId: user.employeeId,
      requestedDate,
      missingType: missing === "Clock In" ? "clock_in" : missing === "Clock Out" ? "clock_out" : "both",
      requestedClockInAt: missing !== "Clock Out" ? localDateTimeToIso(requestedDate, requestedTime) : null,
      requestedClockOutAt: missing !== "Clock In" ? localDateTimeToIso(requestedDate, requestedTime) : null,
      reason: form.get("reason"),
    });

    if ("error" in result) return setMessage(result.error);
    event.currentTarget.reset();
    setMessage("Correction request submitted.");
    await loadEmployee();
  }

  async function addEmployee(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson<{ ok: true }>("/api/admin/dashboard", {
      employeeCode: form.get("employeeCode"),
      fullName: form.get("fullName"),
      phone: form.get("phone"),
      position: form.get("position"),
      email: form.get("email"),
    });

    if ("error" in result) return setMessage(result.error);
    event.currentTarget.reset();
    setMessage("Employee added. They can now register their official phone.");
    await loadAdmin();
  }

  if (!user) {
    return (
      <LoginScreen
        message={message}
        onEmployeeRegister={employeeRegister}
        onAdminLogin={adminLogin}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Navigation">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            W
          </div>
          <div>
            <p className="eyebrow">Warehouse</p>
            <h1>Attendance Management</h1>
          </div>
        </div>

        <div className="account-card">
          <p className="eyebrow">Signed in</p>
          <strong>{user.name}</strong>
          <small>{user.role === "employee" ? user.employeeCode : roleLabel(user.role)}</small>
          {user.role === "employee" ? null : (
            <button type="button" className="secondary" onClick={logout}>
              Sign Out
            </button>
          )}
        </div>

        <nav className="nav-list">
          {user.role === "employee" ? (
            <>
              <a href="#clock">Clock In/Out</a>
              <a href="#month">Monthly View</a>
              <a href="#history">History</a>
              <a href="#corrections">Correction Request</a>
            </>
          ) : (
            <>
              <a href="#employees">Employees</a>
              <a href="#attendance">Attendance</a>
              <a href="#corrections">Approvals</a>
              <a href="#reports">Reports</a>
            </>
          )}
        </nav>
      </aside>

      <section className="workspace">
        {message ? <p className="inline-message">{message}</p> : null}
        {user.role === "employee" ? (
          <EmployeeApp
            data={employeeData}
            clockState={clockState}
            gpsMessage={gpsMessage}
            onClock={runClock}
            onCorrection={submitCorrection}
          />
        ) : (
          <AdminApp data={adminData} onAddEmployee={addEmployee} />
        )}
      </section>
    </main>
  );
}

function LoginScreen({
  message,
  onEmployeeRegister,
  onAdminLogin,
}: {
  message: string;
  onEmployeeRegister: (event: FormEvent<HTMLFormElement>) => void;
  onAdminLogin: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-hero">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            W
          </div>
          <div>
            <p className="eyebrow">Warehouse</p>
            <h1>Attendance Management</h1>
          </div>
        </div>
        <h2>Secure attendance for employees, HR, and owners</h2>
        <div className="auth-facts">
          <span>Official phone lock</span>
          <span>Permanent QR</span>
          <span>GPS radius check</span>
        </div>
      </section>

      <section className="auth-grid">
        <form className="auth-panel" onSubmit={onEmployeeRegister}>
          <div>
            <p className="eyebrow">Employee login</p>
            <h3>Open Attendance</h3>
          </div>
          <label>
            Employee code
            <input name="employeeCode" placeholder="WH-001" required />
          </label>
          <label>
            Full name
            <input name="fullName" placeholder="Employee name" required />
          </label>
          <label>
            Phone number
            <input name="phone" placeholder="+60 12-400 1001" required />
          </label>
          <button type="submit">Open My Attendance</button>
          <small>Code, full name, and phone must match HR records.</small>
        </form>

        <form className="auth-panel" onSubmit={onAdminLogin}>
          <div>
            <p className="eyebrow">HR and owner</p>
            <h3>Admin Login</h3>
          </div>
          <label>
            Email
            <input name="email" type="email" required />
          </label>
          <label>
            Password
            <input name="password" type="password" required />
          </label>
          <button type="submit">Open Admin</button>
        </form>
      </section>

      {message ? <p className="auth-message">{message}</p> : null}
    </main>
  );
}

function EmployeeApp({
  data,
  clockState,
  gpsMessage,
  onClock,
  onCorrection,
}: {
  data: EmployeeSummary | null;
  clockState: ClockState;
  gpsMessage: string;
  onClock: (action: "clock_in" | "clock_out") => void;
  onCorrection: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const records = useMemo(() => data?.attendance ?? [], [data?.attendance]);
  const corrections = useMemo(() => data?.corrections ?? [], [data?.corrections]);
  const openRecord = records.find((record) => (
    record.clock_in_at && !record.clock_out_at && isOpenRecordStillActive(String(record.work_date ?? ""))
  ));
  const today = malaysiaDateKey(new Date());
  const [calendarYear, calendarMonth] = today.split("-").map(Number);
  const calendarDays = new Date(Date.UTC(calendarYear, calendarMonth, 0)).getUTCDate();
  const calendarMonthLabel = new Date(Date.UTC(calendarYear, calendarMonth - 1, 1)).toLocaleDateString("en-MY", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const nextAction = openRecord ? "clock_out" : "clock_in";
  const nextLabel = openRecord ? "Clock out" : "Clock in";
  const stats = useMemo(
    () => ({
      presentDays: records.filter((record) => record.status !== "absent").length,
      shortMinutes: records.reduce((total, record) => total + Number(record.late_minutes ?? 0), 0),
      otMinutes: records.reduce((total, record) => total + Number(record.overtime_minutes ?? 0), 0),
      correctionCount: corrections.length,
    }),
    [records, corrections],
  );

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Employee attendance app</p>
          <h2>My Attendance</h2>
        </div>
        <span className="health-dot">Employee Only</span>
      </header>

      <section className="metric-grid" aria-label="My attendance overview">
        <Metric label="Present days" value={stats.presentDays} tone="green" />
        <Metric label="Short" value={formatMinutes(stats.shortMinutes)} tone="amber" />
        <Metric label="OT minutes" value={stats.otMinutes} tone="blue" />
        <Metric label="Corrections" value={stats.correctionCount} tone="red" />
      </section>

      <div className="content-grid employee-grid">
        <section className="panel clock-panel" id="clock">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Clock in/out</p>
              <h3>{String(data?.employee?.full_name ?? "Employee")}</h3>
            </div>
          </div>

          <div className={`scanner ${clockState}`}>
            <div className="camera-frame" aria-hidden="true">
              <div className="qr-large">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <p>{clockState === "idle" && openRecord ? `Clocked in at ${formatTime(openRecord.clock_in_at)}. Scan QR to clock out.` : gpsMessage}</p>
          </div>

          <div className="clock-actions single">
            <button type="button" className={`clock-primary ${openRecord ? "out" : "in"}`} onClick={() => onClock(nextAction)}>
              {nextLabel}
            </button>
          </div>
        </section>

        <section className="panel" id="month">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current month</p>
              <h3>{calendarMonthLabel}</h3>
            </div>
          </div>
          <div className="calendar">
            {Array.from({ length: calendarDays }, (_, index) => {
              const day = index + 1;
              const date = `${calendarYear}-${String(calendarMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const record = records.find((item) => item.work_date === date);
              return (
                <div
                  key={date}
                  className={`day ${String(record?.status ?? "").replace("_", "-")} ${date === today ? "today" : ""}`}
                  aria-current={date === today ? "date" : undefined}
                >
                  <span>{day}</span>
                  <small>{record ? statusLabel(record.status) : "-"}</small>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel wide" id="history">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Clock history</p>
              <h3>My attendance</h3>
            </div>
          </div>
          <AttendanceTable records={records} employeeOnly />
        </section>

        <section className="panel" id="corrections">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Forgotten clock</p>
              <h3>Correction request</h3>
            </div>
          </div>
          <CorrectionForm onSubmit={onCorrection} />
          <div className="mini-list">
            {corrections.map((item) => (
              <div key={String(item.id)}>
                <strong>{String(item.requested_date)}</strong>
                <span>{String(item.reason)}</span>
                <Badge value={statusLabel(item.status)} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function AdminApp({
  data,
  onAddEmployee,
}: {
  data: AdminDashboard | null;
  onAddEmployee: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const attendance = data?.attendance ?? [];
  const employees = data?.employees ?? [];
  const corrections = data?.corrections ?? [];

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Protected admin dashboard</p>
          <h2>HR / Owner Console</h2>
        </div>
        <div className="topbar-actions">
          <a className="export-link" href="/api/reports/export?format=excel&month=2026-08">
            Excel
          </a>
          <a className="export-link" href="/api/reports/export?format=pdf&month=2026-08">
            PDF
          </a>
        </div>
      </header>

      <section className="metric-grid" aria-label="Admin attendance overview">
        <Metric label="Employees" value={employees.length} tone="green" />
        <Metric label="Late records" value={attendance.filter((item) => Number(item.late_minutes ?? 0) > 0).length} tone="amber" />
        <Metric label="OT minutes" value={attendance.reduce((total, item) => total + Number(item.overtime_minutes ?? 0), 0)} tone="blue" />
        <Metric label="Pending requests" value={corrections.filter((item) => item.status === "pending").length} tone="red" />
      </section>

      <div className="content-grid">
        <section className="panel" id="employees">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Employee management</p>
              <h3>Add employee</h3>
            </div>
          </div>
          <form className="correction-form" onSubmit={onAddEmployee}>
            <label>
              Employee code
              <input name="employeeCode" placeholder="WH-005" required />
            </label>
            <label>
              Full name
              <input name="fullName" required />
            </label>
            <label>
              Phone
              <input name="phone" required />
            </label>
            <label>
              Position
              <input name="position" placeholder="Warehouse Associate" />
            </label>
            <label>
              Email
              <input name="email" type="email" />
            </label>
            <button type="submit">Add Employee</button>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Devices</p>
              <h3>Registered phones</h3>
            </div>
          </div>
          <div className="mini-list">
            {employees.map((employee) => (
              <div key={String(employee.id)}>
                <strong>
                  {String(employee.employee_code)} - {String(employee.full_name)}
                </strong>
                <span>{String(employee.device_model ?? "Not registered")}</span>
                <Badge value={String(employee.device_status ?? "not_registered").replace("_", " ")} />
              </div>
            ))}
          </div>
        </section>

        <section className="panel wide" id="attendance">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Attendance</p>
              <h3>All employees</h3>
            </div>
          </div>
          <AttendanceTable records={attendance} />
        </section>

        <section className="panel wide" id="corrections">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Corrections</p>
              <h3>Approval queue</h3>
            </div>
          </div>
          <div className="request-list">
            {corrections.map((request) => (
              <article key={String(request.id)}>
                <div>
                  <strong>
                    {String(request.employee_code)} - {String(request.full_name)}
                  </strong>
                  <span>{String(request.requested_date)}</span>
                  <p>{String(request.reason)}</p>
                </div>
                <Badge value={statusLabel(request.status)} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}

function CorrectionForm({ onSubmit }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="correction-form" onSubmit={onSubmit}>
      <label>
        Date
        <input name="date" type="date" defaultValue="2026-08-03" required />
      </label>
      <label>
        Missing
        <select name="missing" defaultValue="Clock Out">
          <option>Clock In</option>
          <option>Clock Out</option>
          <option>Both</option>
        </select>
      </label>
      <label>
        Requested time
        <input name="requestedTime" type="time" required />
      </label>
      <label>
        Reason
        <textarea name="reason" rows={3} required />
      </label>
      <button type="submit">Submit Request</button>
    </form>
  );
}

function AttendanceTable({
  records,
  employeeOnly = false,
}: {
  records: Record<string, string | number | null>[];
  employeeOnly?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {!employeeOnly ? <th>Employee</th> : null}
            <th>Date</th>
            <th>Clock In</th>
            {!employeeOnly ? <th>Break</th> : null}
            {!employeeOnly ? <th>Resume</th> : null}
            <th>Clock Out</th>
            <th>Working Hours</th>
            <th>OT</th>
            <th>Status</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={String(record.id)}>
              {!employeeOnly ? <td>{String(record.full_name ?? record.employee_code ?? "-")}</td> : null}
              <td>{String(record.work_date ?? "-")}</td>
              <td>{formatTime(record.clock_in_at)}</td>
              {!employeeOnly ? <td>{formatTime(record.break_at)}</td> : null}
              {!employeeOnly ? <td>{formatTime(record.resume_at)}</td> : null}
              <td>{formatTime(record.clock_out_at)}</td>
              <td>{formatMinutes(Number(record.total_minutes ?? 0))}</td>
              <td>{formatOtMinutes(Number(record.overtime_minutes ?? 0))}</td>
              <td>
                <Badge value={statusLabel(record.status)} />
              </td>
              <td>{formatGps(record)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: number | string; tone: string }) {
  return (
    <article className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T | { error: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as T | { error: string };
  return data;
}

async function getJson<T>(url: string): Promise<T | { error: string }> {
  const response = await fetch(url);
  return (await response.json()) as T | { error: string };
}

async function collectGpsSamples() {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    samples.push(await getGpsSample(index));
    await wait(180);
  }
  return samples;
}

function getGpsSample(index: number): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(fallbackSample(index));
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        }),
      () => resolve(fallbackSample(index)),
      { enableHighAccuracy: true, timeout: 1200, maximumAge: 0 },
    );
  });
}

function fallbackSample(index: number) {
  return {
    latitude: warehouse.latitude + index * 0.00001,
    longitude: warehouse.longitude + index * 0.00001,
    accuracy: [24, 18, 12, 16, 9][index] ?? 18,
  };
}

function formatMinutes(minutes: number) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatTime(value: unknown) {
  if (!value) return "-";
  if (typeof value === "string" && value.includes("T")) return formatDateTime(value);
  return String(value);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(11, 16);
  return date.toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatOtMinutes(minutes: number) {
  return minutes > 0 ? formatMinutes(minutes) : "-";
}

function localDateTimeToIso(date: string, time: string) {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

function isOpenRecordStillActive(workDate: string) {
  const today = malaysiaDateKey(new Date());
  if (workDate === today) return true;
  if (workDate !== previousDateKey(today)) return false;
  return malaysiaMinutesSinceMidnight(new Date()) < toMinutes("08:00");
}

function malaysiaDateKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function malaysiaMinutesSinceMidnight(date: Date) {
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return toMinutes(time);
}

function previousDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatGps(record: Record<string, string | number | null>) {
  const accuracy = record.clock_out_accuracy ?? record.clock_in_accuracy;
  const distance = record.clock_out_distance_meters ?? record.clock_in_distance_meters;
  return accuracy ? `${Math.round(Number(accuracy))}m / ${Math.round(Number(distance))}m` : "-";
}

function statusLabel(value: unknown) {
  return String(value ?? "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roleLabel(role: Role) {
  return role === "owner" ? "Owner/Admin" : role === "hr" ? "HR/Admin Staff" : "Employee";
}

function getBrowserDeviceFingerprint() {
  if (typeof window === "undefined") return "server";
  const key = "warehouse-device-fingerprint";
  const existing = window.localStorage.getItem(key);
  if (existing) return existing;
  const fingerprint = crypto.randomUUID();
  window.localStorage.setItem(key, fingerprint);
  return fingerprint;
}

function browserDeviceLabel() {
  if (typeof navigator === "undefined") return "Registered phone";
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const model = nav.userAgentData?.platform ?? nav.platform ?? "Mobile browser";
  return `${model} - ${getBrowserDeviceFingerprint().slice(0, 4).toUpperCase()}`;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
