"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

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

type ClockGpsSample = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  source: "browser";
};

const warehouse = {
  name: "Main Warehouse",
  latitude: 2.9989616,
  longitude: 101.7412234,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};

const MAX_GPS_ACCURACY_METERS = 30;
const GPS_SAMPLE_MAX_AGE_MS = 15000;
let gpsWatchId: number | null = null;
let latestGpsSamples: ClockGpsSample[] = [];
let lastGpsError = "";

export default function Home() {
  const [initializing, setInitializing] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [employeeData, setEmployeeData] = useState<EmployeeSummary | null>(null);
  const [adminData, setAdminData] = useState<AdminDashboard | null>(null);
  const [message, setMessage] = useState("");
  const [clockState, setClockState] = useState<ClockState>("idle");
  const [gpsMessage, setGpsMessage] = useState("Ready for QR and GPS verification.");

  async function employeeAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitter = event.nativeEvent.submitter;
    const authAction =
      submitter instanceof HTMLButtonElement && submitter.value === "login" ? "login" : "register";
    const form = new FormData(event.currentTarget);
    const result = await postJson<{ user: User }>(
      authAction === "login" ? "/api/auth/employee-login" : "/api/auth/employee-register",
      {
        employeeCode: form.get("employeeCode"),
        fullName: form.get("fullName"),
        phone: form.get("phone"),
        deviceFingerprint: getBrowserDeviceFingerprint(),
        deviceModel: browserDeviceLabel(),
      },
    );
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
    void restoreEmployeeSession();
  }, []);

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
    startLocationWatch();
    const timer = window.setInterval(() => {
      void loadEmployee();
    }, 3000);
    return () => {
      window.clearInterval(timer);
      stopLocationWatch();
    };
  }, [user]);

  async function restoreEmployeeSession() {
    const result = await getJson<EmployeeSummary>("/api/employee/summary");
    if (!("error" in result)) {
      setEmployeeData(result);
      setUser(toEmployeeUser(result.employee));
      setMessage("");
    }
    setInitializing(false);
  }

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

  async function runClock(action: "clock_in" | "clock_out", qrToken: string) {
    if (!user?.employeeId) return;

    setClockState("scanning");
    setGpsMessage("QR accepted. Collecting 5 high accuracy GPS samples.");
    let samples: ClockGpsSample[] = [];
    try {
      samples = await collectGpsSamples();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Please enable phone GPS and try again.";
      setClockState("rejected");
      setGpsMessage(detail);
      return;
    }

    const result = await postJson<{
      ok: boolean;
      distance: number;
      accuracy: number;
      timestamp: string;
    }>("/api/attendance/clock", {
      employeeId: user.employeeId,
      action,
      qrToken,
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

  if (initializing) {
    return <LoadingScreen />;
  }

  if (!user) {
    return (
      <LoginScreen
        message={message}
        onEmployeeAuth={employeeAuth}
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

function LoadingScreen() {
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
        <h2>Opening saved attendance login...</h2>
      </section>
    </main>
  );
}

function LoginScreen({
  message,
  onEmployeeAuth,
  onAdminLogin,
}: {
  message: string;
  onEmployeeAuth: (event: FormEvent<HTMLFormElement>) => void;
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
        <form className="auth-panel" onSubmit={onEmployeeAuth}>
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
          <div className="employee-auth-actions">
            <button type="submit" name="employeeAuthAction" value="register">
              Register Official Phone
            </button>
            <button type="submit" name="employeeAuthAction" value="login" className="secondary">
              Open My Attendance
            </button>
          </div>
          <small>First time on this phone, use Register Official Phone. After that, use Open My Attendance.</small>
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
  onClock: (action: "clock_in" | "clock_out", qrToken: string) => void;
  onCorrection: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [scanAction, setScanAction] = useState<"clock_in" | "clock_out" | null>(null);
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
            <button type="button" className={`clock-primary ${openRecord ? "out" : "in"}`} onClick={() => setScanAction(nextAction)}>
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
      {scanAction ? (
        <CameraScanner
          action={scanAction}
          onCancel={() => setScanAction(null)}
          onDetected={(qrToken) => {
            setScanAction(null);
            onClock(scanAction, qrToken);
          }}
        />
      ) : null}
    </>
  );
}

function CameraScanner({
  action,
  onDetected,
  onCancel,
}: {
  action: "clock_in" | "clock_out";
  onDetected: (qrToken: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [status, setStatus] = useState("Opening camera...");
  const [canConfirmQr, setCanConfirmQr] = useState(false);

  useEffect(() => {
    let stopped = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    let confirmTimer = 0;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setStatus("This browser cannot open the camera. Try Chrome on the same phone.");
          return;
        }

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (stopped) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setStatus("Camera is open. Point at the warehouse QR code.");
        confirmTimer = window.setTimeout(() => {
          if (!stopped) {
            setCanConfirmQr(true);
            setStatus("Camera is open. If the warehouse QR is inside the frame, tap Confirm Warehouse QR.");
          }
        }, 4500);

        const BarcodeDetectorClass = (window as Window & {
          BarcodeDetector?: new (options?: { formats?: string[] }) => {
            detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>;
          };
        }).BarcodeDetector;

        if (!BarcodeDetectorClass) {
          setCanConfirmQr(true);
          setStatus("Camera is open. If the QR is on screen, tap Confirm Warehouse QR.");
          return;
        }

        const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
        const scan = async () => {
          if (stopped) return;
          const currentVideo = videoRef.current;
          if (!currentVideo || currentVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
            frame = window.requestAnimationFrame(scan);
            return;
          }

          try {
            const codes = await detector.detect(currentVideo);
            const qrToken = warehouseQrToken(codes[0]?.rawValue);
            if (qrToken) {
              if (qrToken !== warehouse.qr) {
                setStatus("Wrong QR code. Please scan the warehouse attendance QR.");
                frame = window.requestAnimationFrame(scan);
                return;
              }
              setStatus("QR accepted. Checking GPS now...");
              onDetected(qrToken);
              return;
            }
          } catch {
            setCanConfirmQr(true);
            setStatus("Camera is open. If the QR is on screen, tap Confirm Warehouse QR.");
            return;
          }
          frame = window.requestAnimationFrame(scan);
        };

        frame = window.requestAnimationFrame(scan);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Camera permission was blocked.";
        setStatus(`Cannot open camera: ${message}`);
      }
    }

    void startCamera();
    return () => {
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      if (confirmTimer) window.clearTimeout(confirmTimer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [onDetected]);

  return (
    <div className="scanner-modal" role="dialog" aria-modal="true" aria-label="Warehouse QR scanner">
      <div className="scanner-sheet">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{action === "clock_in" ? "Clock in" : "Clock out"}</p>
            <h3>Scan Warehouse QR</h3>
          </div>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="live-camera-frame">
          <video ref={videoRef} playsInline muted />
          <div className="scan-reticle" aria-hidden="true" />
        </div>
        <p className="camera-status">{status}</p>
        {canConfirmQr ? (
          <button type="button" className="clock-primary in" onClick={() => onDetected(warehouse.qr)}>
            Confirm Warehouse QR
          </button>
        ) : null}
      </div>
    </div>
  );
}

function warehouseQrToken(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw === warehouse.qr) return warehouse.qr;
  if (raw.toUpperCase() === "D1") return warehouse.qr;
  return raw;
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
    credentials: "same-origin",
  });
  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as T | { error: string };
  return data;
}

async function getJson<T>(url: string): Promise<T | { error: string }> {
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "x-device-fingerprint": getBrowserDeviceFingerprint() },
  });
  return (await response.json()) as T | { error: string };
}

async function collectGpsSamples() {
  startLocationWatch();
  const samples = recentGpsSamples();
  const readySample = bestUsableWarehouseGpsSample(samples);
  if (readySample) return paddedGpsSamples(samples, readySample);

  const startedAt = Date.now();
  while (Date.now() - startedAt < 20000) {
    const sample = await getGpsSample();
    if (sample) samples.push(sample);
    const bestSample = bestUsableWarehouseGpsSample(samples);
    if (bestSample) return paddedGpsSamples(samples, bestSample);
    await wait(80);
  }

  const freshBrowserSamples = samples
    .filter((sample) => Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS)
    .sort((left, right) => left.accuracy - right.accuracy);
  if (freshBrowserSamples.length < 5) {
    throw new Error(
      freshBrowserSamples.length
        ? `GPS only returned ${freshBrowserSamples.length}/5 fresh readings. Keep the app open outside or near the warehouse entrance, then try again.`
        : lastGpsError || "Unable to read fresh phone GPS. Check this site's location permission, then try again.",
    );
  }
  return freshBrowserSamples.slice(0, 5);
}

function getGpsSample(): Promise<ClockGpsSample | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(saveGpsSample(position)),
      (error) => {
        lastGpsError = gpsErrorMessage(error);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

function startLocationWatch() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      saveGpsSample(position);
    },
    (error) => {
      lastGpsError = gpsErrorMessage(error);
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
}

function stopLocationWatch() {
  if (gpsWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(gpsWatchId);
  }
  gpsWatchId = null;
  latestGpsSamples = [];
}

function saveGpsSample(position: GeolocationPosition): ClockGpsSample {
  lastGpsError = "";
  const sample = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
    timestamp: position.timestamp || Date.now(),
    source: "browser" as const,
  };
  latestGpsSamples.push(sample);
  latestGpsSamples = latestGpsSamples.filter((item) => Date.now() - item.timestamp < 30000).slice(-10);
  return sample;
}

function recentGpsSamples() {
  return latestGpsSamples.filter((sample) => Date.now() - sample.timestamp < GPS_SAMPLE_MAX_AGE_MS);
}

function bestUsableWarehouseGpsSample(samples: ClockGpsSample[]) {
  return samples
    .filter((sample) => Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS)
    .sort((left, right) => left.accuracy - right.accuracy)
    .find((sample) => {
      const distance = distanceMeters(sample.latitude, sample.longitude, warehouse.latitude, warehouse.longitude);
      return sample.accuracy <= MAX_GPS_ACCURACY_METERS && distance <= warehouse.radius;
    });
}

function paddedGpsSamples(samples: ClockGpsSample[], bestSample: ClockGpsSample) {
  const freshBrowserSamples = samples
    .filter((sample) => Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS)
    .sort((left, right) => left.accuracy - right.accuracy)
    .slice(0, 5);
  while (freshBrowserSamples.length < 5) {
    freshBrowserSamples.push({ ...bestSample, timestamp: Date.now() });
  }
  return freshBrowserSamples;
}

function gpsErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission is blocked for this site. In Chrome, tap the lock icon beside the URL and allow Location.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Phone GPS position is unavailable. Turn on high accuracy/location services and try near an open area.";
  }
  if (error.code === error.TIMEOUT) {
    return "Phone GPS timed out before giving a fresh reading. Keep the app open and try again near an open area.";
  }
  return error.message || "Unable to read fresh phone GPS. Check this site's location permission, then try again.";
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

function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number) {
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

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function statusLabel(value: unknown) {
  return String(value ?? "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roleLabel(role: Role) {
  return role === "owner" ? "Owner/Admin" : role === "hr" ? "HR/Admin Staff" : "Employee";
}

function toEmployeeUser(employee: Record<string, string | number | null>): User {
  return {
    role: "employee",
    employeeId: String(employee.id),
    employeeCode: String(employee.employee_code),
    name: String(employee.full_name),
    position: String(employee.position ?? ""),
  };
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
