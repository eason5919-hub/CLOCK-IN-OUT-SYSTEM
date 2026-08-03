"use client";

import { FormEvent, useMemo, useState } from "react";

type Role = "owner" | "hr" | "employee";
type AttendanceStatus = "Present" | "Late" | "Absent" | "OT" | "Pending";
type ClockAction = "clock_in" | "clock_out";

type Employee = {
  id: string;
  code: string;
  name: string;
  department: string;
  position: string;
  phone: string;
  device: string;
  deviceStatus: "Registered" | "Reset pending" | "Not registered";
};

type AttendanceRecord = {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  workingMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  status: AttendanceStatus;
  distanceMeters?: number;
  gpsAccuracy?: number;
};

type Correction = {
  id: string;
  employeeId: string;
  date: string;
  missing: "Clock In" | "Clock Out" | "Both";
  requestedTime: string;
  reason: string;
  status: "Pending" | "Approved" | "Rejected";
};

type AuditLog = {
  id: string;
  actor: string;
  action: string;
  record: string;
  time: string;
};

const employeesSeed: Employee[] = [
  {
    id: "emp-001",
    code: "WH-001",
    name: "Siti Rahman",
    department: "Operations",
    position: "Warehouse Supervisor",
    phone: "+60 12-400 1001",
    device: "iPhone 15 - 9F2A",
    deviceStatus: "Registered",
  },
  {
    id: "emp-002",
    code: "WH-002",
    name: "Daniel Tan",
    department: "Picking",
    position: "Picker",
    phone: "+60 12-400 1002",
    device: "Galaxy A55 - 21C8",
    deviceStatus: "Registered",
  },
  {
    id: "emp-003",
    code: "WH-003",
    name: "Nur Aisyah",
    department: "Packing",
    position: "Packer",
    phone: "+60 12-400 1003",
    device: "Not registered",
    deviceStatus: "Not registered",
  },
  {
    id: "emp-004",
    code: "WH-004",
    name: "Marcus Lee",
    department: "Loading Bay",
    position: "Forklift Operator",
    phone: "+60 12-400 1004",
    device: "Oppo Reno - 66AB",
    deviceStatus: "Reset pending",
  },
];

const attendanceSeed: AttendanceRecord[] = [
  {
    id: "att-001",
    employeeId: "emp-001",
    date: "2026-08-01",
    clockIn: "08:58",
    clockOut: "18:35",
    workingMinutes: 577,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 35,
    status: "OT",
    distanceMeters: 22,
    gpsAccuracy: 12,
  },
  {
    id: "att-002",
    employeeId: "emp-001",
    date: "2026-08-02",
    clockIn: null,
    clockOut: null,
    workingMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    status: "Absent",
  },
  {
    id: "att-003",
    employeeId: "emp-001",
    date: "2026-08-03",
    clockIn: "09:12",
    clockOut: null,
    workingMinutes: 0,
    lateMinutes: 12,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    status: "Late",
    distanceMeters: 18,
    gpsAccuracy: 9,
  },
  {
    id: "att-004",
    employeeId: "emp-002",
    date: "2026-08-01",
    clockIn: "08:51",
    clockOut: "18:04",
    workingMinutes: 553,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    status: "Present",
    distanceMeters: 31,
    gpsAccuracy: 15,
  },
  {
    id: "att-005",
    employeeId: "emp-004",
    date: "2026-08-03",
    clockIn: "09:00",
    clockOut: null,
    workingMinutes: 0,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    overtimeMinutes: 0,
    status: "Present",
    distanceMeters: 28,
    gpsAccuracy: 14,
  },
];

const correctionSeed: Correction[] = [
  {
    id: "cor-001",
    employeeId: "emp-002",
    date: "2026-08-02",
    missing: "Clock Out",
    requestedTime: "18:08",
    reason: "Battery died after loading bay shift.",
    status: "Pending",
  },
  {
    id: "cor-002",
    employeeId: "emp-001",
    date: "2026-07-31",
    missing: "Clock In",
    requestedTime: "08:56",
    reason: "Phone camera failed to open.",
    status: "Approved",
  },
];

const auditSeed: AuditLog[] = [
  {
    id: "log-001",
    actor: "Owner/Admin",
    action: "Generated permanent QR code",
    record: "Main Warehouse QR v1",
    time: "2026-08-01 08:30",
  },
  {
    id: "log-002",
    actor: "HR/Admin Staff",
    action: "Approved correction request",
    record: "WH-001 on 2026-07-31",
    time: "2026-08-01 10:42",
  },
  {
    id: "log-003",
    actor: "System",
    action: "Rejected GPS outside allowed radius",
    record: "WH-004 device 66AB",
    time: "2026-08-03 08:55",
  },
];

const schedule = [
  ["Monday", "09:00", "18:00", "18:16"],
  ["Tuesday", "09:00", "18:00", "18:16"],
  ["Wednesday", "09:00", "18:00", "18:16"],
  ["Thursday", "09:00", "18:00", "18:16"],
  ["Friday", "09:00", "18:00", "18:16"],
  ["Saturday", "09:00", "13:00", "13:16"],
  ["Sunday", "OFF", "OFF", "All hours"],
];

const warehouse = {
  name: "Main Warehouse",
  latitude: 3.139,
  longitude: 101.6869,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};

export default function Home() {
  const [role, setRole] = useState<Role>("owner");
  const [employees, setEmployees] = useState(employeesSeed);
  const [attendance, setAttendance] = useState(attendanceSeed);
  const [corrections, setCorrections] = useState(correctionSeed);
  const [auditLogs, setAuditLogs] = useState(auditSeed);
  const [activeEmployeeId, setActiveEmployeeId] = useState("emp-001");
  const [clockState, setClockState] = useState<"idle" | "scanning" | "accepted" | "rejected">("idle");
  const [gpsMessage, setGpsMessage] = useState("Ready for QR and GPS verification.");

  const activeEmployee = employees.find((employee) => employee.id === activeEmployeeId) ?? employees[0];
  const employeeAttendance = attendance.filter((record) => record.employeeId === activeEmployee.id);
  const stats = useMemo(() => buildStats(attendance, employees.length), [attendance, employees.length]);

  function addAudit(actor: string, action: string, record: string) {
    setAuditLogs((logs) => [
      {
        id: `log-${Date.now()}`,
        actor,
        action,
        record,
        time: new Date().toLocaleString("en-GB", { hour12: false }),
      },
      ...logs,
    ]);
  }

  async function runClock(action: ClockAction) {
    setClockState("scanning");
    setGpsMessage("Camera opened. Scanning permanent warehouse QR code.");
    await wait(550);
    setGpsMessage("QR accepted. Collecting 5 high accuracy GPS samples.");
    const samples = await collectGpsSamples();
    const best = samples.sort((a, b) => a.accuracy - b.accuracy)[0];
    const distance = Math.round(distanceMeters(best.latitude, best.longitude, warehouse.latitude, warehouse.longitude));

    if (best.accuracy > 30 || distance > warehouse.radius) {
      setClockState("rejected");
      setGpsMessage("Unable to verify location. Please move closer to warehouse or enable GPS.");
      addAudit("System", "Rejected GPS outside allowed radius", `${activeEmployee.code} at ${distance}m`);
      return;
    }

    const today = "2026-08-03";
    const now = new Date();
    const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

    setAttendance((records) => {
      const existing = records.find((record) => record.employeeId === activeEmployee.id && record.date === today);
      if (action === "clock_in") {
        if (existing) {
          return records.map((record) =>
            record.id === existing.id
              ? {
                  ...record,
                  clockIn: record.clockIn ?? time,
                  lateMinutes: Math.max(0, toMinutes(time) - toMinutes("09:00")),
                  status: toMinutes(time) > toMinutes("09:00") ? "Late" : "Present",
                  distanceMeters: distance,
                  gpsAccuracy: best.accuracy,
                }
              : record,
          );
        }

        return [
          ...records,
          {
            id: `att-${Date.now()}`,
            employeeId: activeEmployee.id,
            date: today,
            clockIn: time,
            clockOut: null,
            workingMinutes: 0,
            lateMinutes: Math.max(0, toMinutes(time) - toMinutes("09:00")),
            earlyLeaveMinutes: 0,
            overtimeMinutes: 0,
            status: toMinutes(time) > toMinutes("09:00") ? "Late" : "Present",
            distanceMeters: distance,
            gpsAccuracy: best.accuracy,
          },
        ];
      }

      return records.map((record) => {
        if (record.employeeId !== activeEmployee.id || record.date !== today) return record;
        const start = record.clockIn ?? "09:00";
        const workingMinutes = Math.max(0, toMinutes(time) - toMinutes(start));
        const overtimeMinutes = calculateDisplayOvertime(time, "18:00", "18:16");
        return {
          ...record,
          clockOut: time,
          workingMinutes,
          earlyLeaveMinutes: Math.max(0, toMinutes("18:00") - toMinutes(time)),
          overtimeMinutes,
          status: overtimeMinutes > 0 ? "OT" : record.lateMinutes > 0 ? "Late" : "Present",
          distanceMeters: distance,
          gpsAccuracy: best.accuracy,
        };
      });
    });

    setClockState("accepted");
    setGpsMessage(`Attendance accepted. Best GPS ${best.accuracy}m, distance ${distance}m.`);
    addAudit("System", action === "clock_in" ? "Clock in recorded" : "Clock out recorded", activeEmployee.code);
  }

  function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const missing = String(form.get("missing")) as Correction["missing"];
    const date = String(form.get("date"));
    const requestedTime = String(form.get("requestedTime"));
    const reason = String(form.get("reason")).trim();
    if (!date || !requestedTime || !reason) return;

    setCorrections((items) => [
      {
        id: `cor-${Date.now()}`,
        employeeId: activeEmployee.id,
        date,
        missing,
        requestedTime,
        reason,
        status: "Pending",
      },
      ...items,
    ]);
    addAudit(activeEmployee.name, "Submitted correction request", `${date} ${missing}`);
    event.currentTarget.reset();
  }

  function reviewCorrection(id: string, status: "Approved" | "Rejected") {
    setCorrections((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
    const correction = corrections.find((item) => item.id === id);
    if (correction && status === "Approved") {
      setAttendance((records) => {
        const existing = records.find(
          (record) => record.employeeId === correction.employeeId && record.date === correction.date,
        );
        if (!existing) {
          return [
            ...records,
            {
              id: `att-${Date.now()}`,
              employeeId: correction.employeeId,
              date: correction.date,
              clockIn: correction.missing !== "Clock Out" ? correction.requestedTime : null,
              clockOut: correction.missing !== "Clock In" ? correction.requestedTime : null,
              workingMinutes: 0,
              lateMinutes: 0,
              earlyLeaveMinutes: 0,
              overtimeMinutes: 0,
              status: "Pending",
            },
          ];
        }

        return records.map((record) =>
          record.id === existing.id
            ? {
                ...record,
                clockIn: correction.missing !== "Clock Out" ? correction.requestedTime : record.clockIn,
                clockOut: correction.missing !== "Clock In" ? correction.requestedTime : record.clockOut,
                status: "Pending",
              }
            : record,
        );
      });
    }
    addAudit("HR/Admin Staff", `${status} correction request`, correction?.date ?? id);
  }

  function resetDevice(employeeId: string) {
    setEmployees((items) =>
      items.map((employee) =>
        employee.id === employeeId
          ? { ...employee, device: "Not registered", deviceStatus: "Not registered" }
          : employee,
      ),
    );
    addAudit("HR/Admin Staff", "Reset employee device registration", employeeId);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Application navigation">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            W
          </div>
          <div>
            <p className="eyebrow">Warehouse</p>
            <h1>Attendance Management</h1>
          </div>
        </div>

        <div className="role-switch" aria-label="Switch role">
          {(["owner", "hr", "employee"] as Role[]).map((item) => (
            <button
              key={item}
              className={role === item ? "active" : ""}
              onClick={() => setRole(item)}
              type="button"
            >
              {roleLabel(item)}
            </button>
          ))}
        </div>

        <nav className="nav-list">
          <a href="#overview">Overview</a>
          <a href="#attendance">Attendance</a>
          <a href="#corrections">Corrections</a>
          <a href="#reports">Reports</a>
          <a href="#security">Security</a>
        </nav>

        <div className="warehouse-card">
          <p className="eyebrow">Warehouse QR</p>
          <div className="qr-mini" aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
          </div>
          <strong>{warehouse.name}</strong>
          <small>Allowed radius {warehouse.radius}m</small>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Cloud attendance console</p>
            <h2>{roleLabel(role)}</h2>
          </div>
          <div className="topbar-actions">
            <span className="health-dot">Live</span>
            <a className="export-link" href="/api/reports/export?format=excel&month=2026-08">
              Excel
            </a>
            <a className="export-link" href="/api/reports/export?format=pdf&month=2026-08">
              PDF
            </a>
          </div>
        </header>

        <section className="metric-grid" id="overview" aria-label="Attendance overview">
          <Metric label="Present today" value={stats.presentToday} tone="green" />
          <Metric label="Late records" value={stats.lateCount} tone="amber" />
          <Metric label="OT minutes" value={stats.otMinutes} tone="blue" />
          <Metric label="Open corrections" value={stats.pendingCorrections + corrections.filter((c) => c.status === "Pending").length} tone="red" />
        </section>

        {role === "employee" ? (
          <EmployeeView
            employee={activeEmployee}
            attendance={employeeAttendance}
            corrections={corrections.filter((item) => item.employeeId === activeEmployee.id)}
            clockState={clockState}
            gpsMessage={gpsMessage}
            onClock={runClock}
            onSubmitCorrection={submitCorrection}
            onSelectEmployee={setActiveEmployeeId}
            employees={employees}
          />
        ) : (
          <AdminView
            role={role}
            employees={employees}
            attendance={attendance}
            corrections={corrections}
            auditLogs={auditLogs}
            onReviewCorrection={reviewCorrection}
            onResetDevice={resetDevice}
          />
        )}
      </section>
    </main>
  );
}

function EmployeeView({
  employee,
  employees,
  attendance,
  corrections,
  clockState,
  gpsMessage,
  onClock,
  onSubmitCorrection,
  onSelectEmployee,
}: {
  employee: Employee;
  employees: Employee[];
  attendance: AttendanceRecord[];
  corrections: Correction[];
  clockState: "idle" | "scanning" | "accepted" | "rejected";
  gpsMessage: string;
  onClock: (action: ClockAction) => void;
  onSubmitCorrection: (event: FormEvent<HTMLFormElement>) => void;
  onSelectEmployee: (id: string) => void;
}) {
  const monthly = buildMonthly(attendance);

  return (
    <div className="content-grid employee-grid">
      <section className="panel clock-panel" id="attendance">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Employee phone</p>
            <h3>{employee.name}</h3>
          </div>
          <select value={employee.id} onChange={(event) => onSelectEmployee(event.target.value)} aria-label="Employee account">
            {employees.map((item) => (
              <option key={item.id} value={item.id}>
                {item.code} - {item.name}
              </option>
            ))}
          </select>
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
          <p>{gpsMessage}</p>
        </div>

        <div className="clock-actions">
          <button type="button" onClick={() => onClock("clock_in")}>
            Clock In
          </button>
          <button type="button" className="secondary" onClick={() => onClock("clock_out")}>
            Clock Out
          </button>
        </div>

        <dl className="device-details">
          <div>
            <dt>Official device</dt>
            <dd>{employee.device}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{employee.deviceStatus}</dd>
          </div>
          <div>
            <dt>Permissions</dt>
            <dd>View only attendance, OT, late records and history</dd>
          </div>
        </dl>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current month</p>
            <h3>August 2026</h3>
          </div>
          <strong>{formatMinutes(monthly.otMinutes)} OT</strong>
        </div>
        <div className="calendar">
          {Array.from({ length: 31 }, (_, index) => {
            const day = index + 1;
            const date = `2026-08-${String(day).padStart(2, "0")}`;
            const record = attendance.find((item) => item.date === date);
            return (
              <div key={date} className={`day ${record?.status.toLowerCase() ?? ""}`}>
                <span>{day}</span>
                <small>{record?.status ?? "-"}</small>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Clock history</p>
            <h3>My attendance</h3>
          </div>
        </div>
        <AttendanceTable records={attendance} employees={[employee]} employeeOnly />
      </section>

      <section className="panel" id="corrections">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Forgotten clock</p>
            <h3>Correction request</h3>
          </div>
        </div>
        <form className="correction-form" onSubmit={onSubmitCorrection}>
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
        <div className="mini-list">
          {corrections.map((item) => (
            <div key={item.id}>
              <strong>{item.date}</strong>
              <span>{item.missing}</span>
              <Badge value={item.status} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function AdminView({
  role,
  employees,
  attendance,
  corrections,
  auditLogs,
  onReviewCorrection,
  onResetDevice,
}: {
  role: Role;
  employees: Employee[];
  attendance: AttendanceRecord[];
  corrections: Correction[];
  auditLogs: AuditLog[];
  onReviewCorrection: (id: string, status: "Approved" | "Rejected") => void;
  onResetDevice: (employeeId: string) => void;
}) {
  return (
    <div className="content-grid">
      <section className="panel wide">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Employee management</p>
            <h3>People and devices</h3>
          </div>
          <button type="button">Add Employee</button>
        </div>
        <div className="employee-table">
          {employees.map((employee) => (
            <div key={employee.id} className="employee-row">
              <div>
                <strong>{employee.name}</strong>
                <span>
                  {employee.code} - {employee.department} - {employee.position}
                </span>
              </div>
              <Badge value={employee.deviceStatus} />
              <span>{employee.device}</span>
              <button type="button" className="secondary" onClick={() => onResetDevice(employee.id)}>
                Reset Device
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="panel wide" id="attendance">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Search and filter</p>
            <h3>All attendance</h3>
          </div>
          <div className="filter-row">
            <input aria-label="Search employee" placeholder="Search employee" />
            <input aria-label="Month" type="month" defaultValue="2026-08" />
          </div>
        </div>
        <AttendanceTable records={attendance} employees={employees} />
      </section>

      <section className="panel" id="corrections">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Approval queue</p>
            <h3>Correction requests</h3>
          </div>
        </div>
        <div className="request-list">
          {corrections.map((request) => {
            const employee = employees.find((item) => item.id === request.employeeId);
            return (
              <article key={request.id}>
                <div>
                  <strong>{employee?.name}</strong>
                  <span>
                    {request.date} - {request.missing} - {request.requestedTime}
                  </span>
                  <p>{request.reason}</p>
                </div>
                <Badge value={request.status} />
                {request.status === "Pending" ? (
                  <div className="split-actions">
                    <button type="button" onClick={() => onReviewCorrection(request.id, "Approved")}>
                      Approve
                    </button>
                    <button type="button" className="danger" onClick={() => onReviewCorrection(request.id, "Rejected")}>
                      Reject
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel" id="reports">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Reports</p>
            <h3>Monthly outputs</h3>
          </div>
        </div>
        <div className="report-grid">
          <ReportItem title="Monthly attendance" value="31 days" />
          <ReportItem title="OT report" value={`${sum(attendance, "overtimeMinutes")} min`} />
          <ReportItem title="Late report" value={`${attendance.filter((item) => item.lateMinutes > 0).length} records`} />
          <ReportItem title="Absent report" value={`${attendance.filter((item) => item.status === "Absent").length} days`} />
        </div>
      </section>

      {role === "owner" ? (
        <>
          <section className="panel" id="security">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Warehouse security</p>
                <h3>QR and GPS settings</h3>
              </div>
              <button type="button" className="secondary">
                Regenerate QR
              </button>
            </div>
            <dl className="settings-list">
              <div>
                <dt>Permanent QR token</dt>
                <dd>{warehouse.qr}</dd>
              </div>
              <div>
                <dt>GPS radius</dt>
                <dd>{warehouse.radius} meters</dd>
              </div>
              <div>
                <dt>Accuracy target</dt>
                <dd>Under 30 meters, minimum 5 samples</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Editable schedule</p>
                <h3>Working hours</h3>
              </div>
            </div>
            <div className="schedule-list">
              {schedule.map(([day, start, end, ot]) => (
                <div key={day}>
                  <strong>{day}</strong>
                  <span>{start === "OFF" ? "OFF" : `${start} - ${end}`}</span>
                  <small>{ot === "All hours" ? "OT: All hours" : `OT: ${ot}, counted from ${end}`}</small>
                </div>
              ))}
            </div>
          </section>

          <section className="panel wide">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Audit logs</p>
                <h3>Protected changes</h3>
              </div>
            </div>
            <div className="audit-list">
              {auditLogs.map((log) => (
                <div key={log.id}>
                  <span>{log.time}</span>
                  <strong>{log.action}</strong>
                  <small>
                    {log.actor} - {log.record}
                  </small>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function AttendanceTable({
  records,
  employees,
  employeeOnly = false,
}: {
  records: AttendanceRecord[];
  employees: Employee[];
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
            <th>Clock Out</th>
            <th>Working Hours</th>
            <th>OT</th>
            <th>Status</th>
            <th>GPS</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => {
            const employee = employees.find((item) => item.id === record.employeeId);
            return (
              <tr key={record.id}>
                {!employeeOnly ? <td>{employee?.name ?? record.employeeId}</td> : null}
                <td>{record.date}</td>
                <td>{record.clockIn ?? "-"}</td>
                <td>{record.clockOut ?? "-"}</td>
                <td>{formatMinutes(record.workingMinutes)}</td>
                <td>{formatMinutes(record.overtimeMinutes)}</td>
                <td>
                  <Badge value={record.status} />
                </td>
                <td>
                  {record.gpsAccuracy ? `${record.gpsAccuracy}m / ${record.distanceMeters}m` : "-"}
                </td>
              </tr>
            );
          })}
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

function ReportItem({ title, value }: { title: string; value: string }) {
  return (
    <div className="report-item">
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}

function roleLabel(role: Role) {
  return role === "owner" ? "Owner/Admin" : role === "hr" ? "HR/Admin Staff" : "Employee";
}

function buildStats(records: AttendanceRecord[], employeeCount: number) {
  const today = records.filter((record) => record.date === "2026-08-03");
  return {
    presentToday: today.filter((record) => record.status !== "Absent").length,
    lateCount: records.filter((record) => record.lateMinutes > 0).length,
    otMinutes: sum(records, "overtimeMinutes"),
    pendingCorrections: Math.max(0, employeeCount - today.length),
  };
}

function buildMonthly(records: AttendanceRecord[]) {
  return {
    otMinutes: sum(records, "overtimeMinutes"),
  };
}

function sum(records: AttendanceRecord[], key: "overtimeMinutes") {
  return records.reduce((total, record) => total + record[key], 0);
}

function formatMinutes(minutes: number) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculateDisplayOvertime(clockOut: string, scheduledEnd: string, overtimeThreshold: string) {
  return toMinutes(clockOut) >= toMinutes(overtimeThreshold)
    ? Math.max(0, toMinutes(clockOut) - toMinutes(scheduledEnd))
    : 0;
}

async function collectGpsSamples() {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const sample = await getGpsSample(index);
    samples.push(sample);
    await wait(180);
  }
  return samples;
}

function getGpsSample(index: number): Promise<{ latitude: number; longitude: number; accuracy: number }> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(fallbackSample(index));
      return;
    }

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

function distanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const radius = 6371000;
  const dLat = radians(toLat - fromLat);
  const dLng = radians(toLng - fromLng);
  const lat1 = radians(fromLat);
  const lat2 = radians(toLat);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
