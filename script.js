const STORAGE_KEY = "warehouse-attendance-static-v2";
const DEVICE_KEY = "warehouse-device-fingerprint";
const DEVICE_COOKIE = "warehouseDeviceFingerprint";
const EMPLOYEE_TOKEN_KEY = "warehouse-live-employee-token";
const EMPLOYEE_TOKEN_EXPIRY_KEY = "warehouse-live-employee-token-expiry";
const EMPLOYEE_TOKEN_COOKIE = "warehouseEmployeeToken";
const EMPLOYEE_TOKEN_EXPIRY_COOKIE = "warehouseEmployeeTokenExpiry";
const EMPLOYEE_LOGIN_DB = "warehouse-employee-login";
const EMPLOYEE_LOGIN_STORE = "tokens";
const APP_VERSION = "20260828-leave-reason";
const APP_VERSION_CHECK_MS = 15000;
const API_BASE = "https://warehouse-attendance-management.eason5919-hub.workers.dev";
const WAREHOUSE = {
  name: "Main Warehouse",
  lat: 2.9989616,
  lng: 101.7412234,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};
const MANUAL_QR_CODE = "D1";
const WHATSAPP_NOTIFY_NUMBER = "60122159225";
const MAX_GPS_ACCURACY_METERS = 30;
const DEFAULT_GPS_WAIT_MS = 4500;
const N006_GPS_WAIT_MS = 15000;
const GPS_SAMPLE_MAX_AGE_MS = 15000;
const QR_SCAN_INTERVAL_MS = 45;
const QR_CANVAS_MAX_SIDE = 1000;
const QR_DARK_FRAME_LUMA = 70;
const QR_TORCH_CHECK_MS = 700;

const defaultState = {
  currentUser: null,
  employees: [],
  attendance: [],
  corrections: [],
  leaveRequests: [],
  auditLogs: [],
};

let state = loadState();
let pendingDeleteEmployeeId = null;
let pendingScanAction = null;
let qrScanController = null;
let liveRefreshInFlight = false;
let liveRefreshQueued = false;
let liveRefreshRenderQueued = false;
let renderedEmployeeLiveRevision = "";
let gpsWatchId = null;
let latestGpsSamples = [];
let selectedHistoryDate = malaysiaDateKey(new Date());
let selectedEmployeeMonthKey = employeeMonthKey(malaysiaToday());
let selectedAdminAttendanceDate = malaysiaDateKey(new Date());
let showAllEmployeeCorrections = false;
let showAllEmployeeLeaveRequests = false;
let optimisticLeaveSubmitInFlight = false;

window.addEventListener("hashchange", () => {
  if (window.location.hash.toLowerCase() === "#admin") {
    history.replaceState(null, "", window.location.pathname);
  }
  render();
});

function loadState() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return stored ? { ...defaultState, ...stored } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const app = document.querySelector("#app");
  if (state.currentUser && state.currentUser.role !== "employee") {
    state.currentUser = null;
    saveState();
  }
  if (state.currentUser && !employeeToken()) {
    state.currentUser = null;
    saveState();
  }

  if (!state.currentUser) {
    app.innerHTML = loginScreen();
    bindLogin();
    return;
  }

  app.innerHTML = shell(employeeScreen(), "Employee attendance app");
  renderedEmployeeLiveRevision = employeeLiveRevision();
  bindEmployee();
  startLocationWatch();
  loadEmployeeLive();
}

function loginScreen() {
  return `
    <section class="auth">
      <div class="auth-hero">
        <div class="brand">
          <div class="brand-mark">W</div>
          <div><p class="eyebrow">Warehouse</p><h1>Attendance Management</h1></div>
        </div>
        <h2>Clock in with QR, GPS, and official phone control</h2>
        <div class="actions">
          <span class="badge">Permanent QR</span>
          <span class="badge">GPS radius</span>
          <span class="badge">One phone only</span>
        </div>
      </div>
      <div class="auth-grid single">
        <form class="auth-panel" id="employee-register">
          <div><p class="eyebrow">Employee login</p><h3>Open Attendance</h3></div>
          <label>Employee code<input name="code" placeholder="WH-001" required /></label>
          <label>Full name<input name="name" placeholder="Employee name" required /></label>
          <label>Phone number<input name="phone" placeholder="+60 12-400 1001" required /></label>
          <button>Open My Attendance</button>
          <small>Code, full name, and phone must match HR records.</small>
        </form>
      </div>
    </section>
  `;
}

function loadingScreen() {
  return `
    <section class="auth">
      <div class="auth-hero">
        <div class="brand">
          <div class="brand-mark">W</div>
          <div><p class="eyebrow">Warehouse</p><h1>Attendance Management</h1></div>
        </div>
        <h2>Opening your attendance...</h2>
        <div class="actions">
          <span class="badge">Permanent login</span>
          <span class="badge">Live HR record</span>
        </div>
      </div>
    </section>
  `;
}

function shell(content, subtitle) {
  return `
    <section class="layout ${state.currentUser.role === "employee" ? "employee-layout" : "admin-layout"}">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">W</div>
          <div><p class="eyebrow">Warehouse</p><h1>Attendance Management</h1></div>
        </div>
        <div class="account">
          <p class="eyebrow">Signed in</p>
          <strong>${escapeHtml(state.currentUser.name)}</strong>
          <small>${escapeHtml(state.currentUser.label)}</small>
        </div>
        <nav class="nav">
          ${state.currentUser.role === "employee"
            ? `<a href="#clock">Clock In/Out</a><a href="#month">Monthly View</a><a href="#history">History</a><a href="#corrections">Correction Request</a><a href="#leave">Annual Leave/MC</a>`
            : `<a href="#warehouse-qr">QR Code</a><a href="#employees">Employees</a><a href="#attendance">Attendance</a><a href="#corrections">Corrections</a><a href="#reports">Reports</a>`}
        </nav>
        <div class="warehouse">
          <p class="eyebrow">Warehouse QR</p>
          <img class="qr-mini-image" src="${warehouseQrImageUrl()}" alt="Warehouse QR code" />
          <strong>${WAREHOUSE.name}</strong>
          <small>Allowed radius ${WAREHOUSE.radius}m</small>
        </div>
      </aside>
      <main class="workspace">
        <header class="topbar">
          <div><p class="eyebrow">${subtitle}</p><h2>${state.currentUser.role === "employee" ? "My Attendance" : "Admin Dashboard"}</h2></div>
          <div class="actions"><button class="secondary" id="install-app">Install App</button></div>
        </header>
        ${content}
      </main>
    </section>
  `;
}

function employeeScreen() {
  const employee = employeeById(state.currentUser.employeeId);
  const records = state.attendance;
  const corrections = state.corrections;
  const leaveRequests = state.leaveRequests || [];
  const visibleLeaveRequests = visibleEmployeeLeaveRequests(leaveRequests, showAllEmployeeLeaveRequests);
  const leaveMoreButton = leaveRequests.length > 5
    ? `<button class="secondary" type="button" data-toggle-employee-leave>${showAllEmployeeLeaveRequests ? "Show less" : "View more"}</button>`
    : "";
  const leaveRemainingDays = Number(state.currentUser.leaveRemainingDays || 0);
  const leaveRemaining = formatLeaveDays(leaveRemainingDays);
  const leaveDefaultDate = defaultLeaveDate();
  selectedEmployeeMonthKey = normalizedEmployeeMonthKey(selectedEmployeeMonthKey);
  const currentMonthDate = monthDateFromKey(selectedEmployeeMonthKey);
  const historyDate = selectedHistoryDate || malaysiaDateKey(new Date());
  const monthRecords = recordsForMonth(records, selectedEmployeeMonthKey);
  const visibleCorrections = correctionsForMonth(corrections, selectedEmployeeMonthKey);
  const displayedCorrections = showAllEmployeeCorrections ? visibleCorrections : visibleCorrections.slice(0, 3);
  const correctionMoreButton = visibleCorrections.length > 3
    ? `<button class="secondary" type="button" data-toggle-employee-corrections>${showAllEmployeeCorrections ? "Show less" : "View more"}</button>`
    : "";
  const correctionDateRange = monthDateRange(selectedEmployeeMonthKey);
  const correctionDateValue = correctionDateInMonth(historyDate, selectedEmployeeMonthKey);
  const monthLabel = currentMonthDate.toLocaleDateString("en-MY", { timeZone: "UTC", month: "long", year: "numeric" });
  const historyRecords = records.filter((row) => row.date === historyDate).sort(compareAttendanceLatest);
  const openRecord = currentOpenRecord(records);
  const clockAction = openRecord ? "out" : "in";
  const clockLabel = openRecord ? "Clock out" : "Clock in";
  const clockHint = openRecord
    ? `Clocked in at ${escapeHtml(openRecord.liveClockIn || openRecord.clockIn)}. Scan the QR again to clock out.`
    : "Scan the warehouse QR to clock in.";
  const stats = {
    present: formatDayCount(calculatePresentDays(monthRecords, visibleCorrections)),
    short: formatMetricDuration(monthRecords.reduce((total, row) => total + employeeHistoryShortMinutes(row, attendanceDisplayTimes(row, visibleCorrections), leaveRequests), 0)),
    ot: formatMetricDuration(monthRecords.reduce((total, row) => total + employeeHistoryOvertimeMinutes(row, attendanceDisplayTimes(row, visibleCorrections)), 0)),
    corrections: correctedReportBoxCount(monthRecords, visibleCorrections),
  };

  return `
    <div class="content employee-content">
      <section class="panel" id="clock">
        <div class="heading"><div><p class="eyebrow">Official phone</p><h3>${escapeHtml(employee.name)}</h3></div><span class="badge">${employee.code}</span></div>
        <div class="scanner idle" id="scanner">
          <div class="qr-large">${"<i></i>".repeat(9)}</div>
          <p id="gps-message">${clockHint}</p>
        </div>
        <div class="clock-actions single">
          <button class="clock-primary ${openRecord ? "out" : "in"}" data-clock="${clockAction}">${clockLabel}</button>
        </div>
      </section>
      <section class="employee-metrics">
        ${metrics([
          ["Present days", stats.present, ""],
          ["Short", stats.short, "amber"],
          ["OT", stats.ot, "blue"],
          ["Corrections", stats.corrections, "red"],
        ])}
      </section>
      <section class="panel" id="month">
        <div class="heading">
          <div><p class="eyebrow">Monthly view</p><h3>${monthLabel}</h3></div>
          <div class="actions month-actions">
            <button class="secondary" type="button" data-employee-month="${previousEmployeeMonthKey()}">Previous</button>
            <button class="secondary" type="button" data-employee-month="${currentEmployeeMonthKey()}">Current</button>
          </div>
        </div>
        <div class="month-calendar">${monthCalendar(records, leaveRequests, corrections, historyDate, currentMonthDate)}</div>
      </section>
      <section class="panel wide" id="history">
        <div class="heading"><div><p class="eyebrow">Clock history</p><h3 data-history-title>My attendance - ${formatLeaveDateDisplay(historyDate)}</h3></div></div>
        <div data-history-content>${attendanceTable(historyRecords, true, historyDate, corrections)}</div>
      </section>
      <section class="panel" id="corrections">
        <div class="heading"><div><p class="eyebrow">Forgotten clock</p><h3>Correction request</h3></div></div>
        <form class="form" id="correction-form">
          ${correctionDateField(correctionDateValue, selectedEmployeeMonthKey, correctionDateRange)}
          <label>Missing<select name="missing"><option>Clock In</option><option selected>Clock Out</option></select></label>
          <label>Requested time<input name="time" type="time" required /></label>
          <label>Reason<textarea name="reason" rows="3" required></textarea></label>
          <button>Submit Request</button>
        </form>
        <div class="list" style="margin-top:14px">${displayedCorrections.map(correctionCard).join("") || `<small>No correction requests for ${escapeHtml(monthLabel)}.</small>`}${correctionMoreButton ? `<div class="actions">${correctionMoreButton}</div>` : ""}</div>
      </section>
      <section class="panel" id="leave">
        <div class="heading">
          <div><p class="eyebrow">Apply Annual Leave/MC</p><h3>Annual leave remaining: <span class="${leaveRemainingDays < 0 ? "negative-leave" : ""}">${leaveRemaining}</span></h3></div>
        </div>
        <form class="form" id="leave-form">
          <label>Type<select name="leaveType"><option value="leave">Annual Leave</option><option value="mc">MC</option></select></label>
          ${leaveRangeField(leaveDefaultDate)}
          <label>Duration<select name="duration"><option value="full_day">Full day</option><option value="half_day">Half day</option></select><small class="muted" data-leave-rule></small></label>
          <label>Reason<textarea name="reason" rows="3" required></textarea></label>
          <button>Submit Annual Leave/MC</button>
        </form>
        <div class="list" style="margin-top:14px">${visibleLeaveRequests.map(leaveRequestCard).join("") || `<small>No Annual Leave/MC requests.</small>`}${leaveMoreButton ? `<div class="actions">${leaveMoreButton}</div>` : ""}</div>
      </section>
    </div>
    ${qrScannerModal()}
  `;
}

function adminScreen() {
  const pending = state.corrections.filter((row) => row.status === "Pending");
  const selectedAttendance = state.attendance.filter((row) => row.date === selectedAdminAttendanceDate);
  return `
    ${metrics([
      ["Employees", state.employees.length, ""],
      ["Late records", state.attendance.filter((row) => row.lateMinutes > 0).length, "amber"],
      ["OT minutes", state.attendance.reduce((total, row) => total + row.overtimeMinutes, 0), "blue"],
      ["Pending requests", pending.length, "red"],
    ])}
    <div class="content">
      <section class="panel" id="warehouse-qr">
        <div class="heading"><div><p class="eyebrow">Clock in QR</p><h3>Warehouse QR Code</h3></div></div>
        <div class="qr-print">
          <img src="${warehouseQrImageUrl()}" alt="Warehouse clock in QR code" />
          <strong>${WAREHOUSE.qr}</strong>
          <small>Employees scan this QR when clocking in or out.</small>
          <a class="button secondary" href="${warehouseQrImageUrl()}" target="_blank" rel="noreferrer">Open QR</a>
        </div>
      </section>
      <section class="panel" id="employees">
        <div class="heading"><div><p class="eyebrow">Employee management</p><h3>Add employee</h3></div></div>
        <form class="form" id="add-employee">
          <label>Employee code<input name="code" placeholder="WH-004" required /></label>
          <label>Full name<input name="name" required /></label>
          <label>Phone<input name="phone" required /></label>
          <label>Department<input name="department" /></label>
          <label>Position<input name="position" /></label>
          <button>Add Employee</button>
        </form>
        <small class="muted">On GitHub Pages, employees added here are saved only in this HR browser.</small>
      </section>
      <section class="panel">
        <div class="heading"><div><p class="eyebrow">Devices</p><h3>Official phones</h3></div></div>
        <div class="list">${state.employees.map(employeeCard).join("") || `<small>No employees added yet.</small>`}</div>
      </section>
      <section class="panel wide" id="attendance">
        <div class="heading">
          <div><p class="eyebrow">Attendance</p><h3>All employees</h3></div>
          <div class="actions">
            <label class="date-filter">Date <input id="admin-attendance-date" type="date" value="${selectedAdminAttendanceDate}" /></label>
            <button class="secondary" id="export-csv">Export CSV</button>
          </div>
        </div>
        ${attendanceTable(selectedAttendance, false, selectedAdminAttendanceDate)}
      </section>
      <section class="panel wide" id="corrections">
        <div class="heading"><div><p class="eyebrow">Corrections</p><h3>Approval queue</h3></div></div>
        <div class="list">${state.corrections.map(adminCorrectionCard).join("") || `<small>No correction requests.</small>`}</div>
      </section>
      <section class="panel wide" id="reports">
        <div class="heading"><div><p class="eyebrow">Working hours</p><h3>OT rules</h3></div></div>
        <p>Start time 09:00. Clock in until 09:10 is normal; 09:11 is late 11m. Clock in before 08:00 counts as early OT.</p>
        <p>Lunch break is flexible. Return within 1h 15m is ok; weekday normal working is capped at 8h even without lunch clock-out.</p>
        <p>Monday-Friday: normal end 18:00, no OT until 18:16, counted from 18:00.</p>
        <p>Saturday: normal end 13:00, no OT until 13:16, counted from 13:00. Sunday approved work is all OT.</p>
      </section>
    </div>
    ${deleteEmployeeModal()}
  `;
}

function bindLogin() {
  const registerForm = document.querySelector("#employee-register");
  if (registerForm) registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code")).trim().toUpperCase();
    const name = String(data.get("name")).trim();
    const phone = String(data.get("phone")).trim();
    try {
      const result = await liveApi("/api/auth/employee-register", {
        method: "POST",
        body: JSON.stringify({
          employeeCode: code,
          fullName: name,
          phone,
          deviceFingerprint: getRegistrationDeviceFingerprint(code),
          deviceModel: browserDeviceLabel(),
        }),
      }, false);
      saveEmployeeToken(result.token, result.expiresAt);
      state.currentUser = {
        role: "employee",
        employeeId: result.user.employeeId,
        name: result.user.name,
        label: result.user.employeeCode,
      };
      state.attendance = [];
      state.corrections = [];
      state.leaveRequests = [];
      saveState();
      await loadEmployeeLive(true);
      render();
    } catch (error) {
      toast(error.message || "Employee code, full name and phone do not match HR records.");
    }
  });
}

async function loadEmployeeLive(force = false, renderWhenChanged = false) {
  if (optimisticLeaveSubmitInFlight && !force) return;
  if (!employeeToken()) return;
  if (liveRefreshInFlight) {
    if (force) liveRefreshQueued = true;
    if (renderWhenChanged) liveRefreshRenderQueued = true;
    return;
  }
  liveRefreshInFlight = true;
  try {
    const result = await liveApi(`/api/employee/summary?refresh=${Date.now()}`, { method: "GET" });
    const employee = result.employee;
    state.currentUser = {
      role: "employee",
      employeeId: employee.id,
      name: employee.full_name,
      label: employee.employee_code,
      leaveEntitlementDays: Number(employee.leave_entitlement_days || 0),
      leaveTakenDays: Number(employee.leave_taken_days || 0),
      leaveRemainingDays: Number(employee.leave_remaining_days || 0),
    };
    state.attendance = (result.attendance || []).map(mapLiveAttendance);
    state.corrections = (result.corrections || []).map(mapLiveCorrection);
    state.leaveRequests = (result.leaveRequests || []).map(mapLiveLeaveRequest);
    saveState();
    if (renderWhenChanged && employeeLiveRevision() !== renderedEmployeeLiveRevision) render();
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      clearEmployeeSession(error.message || "Employee account was deleted by HR.");
    } else {
      toast(error.message || "Unable to refresh attendance. Login is kept on this phone.");
    }
  } finally {
    liveRefreshInFlight = false;
    if (liveRefreshQueued) {
      const renderQueuedRefresh = liveRefreshRenderQueued;
      liveRefreshQueued = false;
      liveRefreshRenderQueued = false;
      loadEmployeeLive(true, renderQueuedRefresh);
    }
  }
}

function employeeLiveRevision() {
  return JSON.stringify({
    currentUser: state.currentUser,
    attendance: state.attendance,
    corrections: state.corrections,
    leaveRequests: state.leaveRequests,
  });
}

async function refreshEmployeeAppVersion() {
  try {
    const versionUrl = new URL("app-version.json", window.location.href);
    versionUrl.searchParams.set("refresh", Date.now());
    const response = await fetch(versionUrl, { cache: "no-store" });
    if (!response.ok) return;
    const latest = await response.json();
    if (!latest.version || latest.version === APP_VERSION) return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("appVersion", latest.version);
    window.location.replace(nextUrl.href);
  } catch {
    // The live data refresh continues if the static version check is unavailable.
  }
}

async function liveApi(path, options = {}, requireToken = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = employeeToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Fingerprint"] = getDeviceFingerprint();
  if (requireToken && !token) throw new Error("Employee login is required.");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        cache: "no-store",
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        const error = new Error(data.error || "Unable to connect to attendance server.");
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      if (error.status || (error.message && !["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."].includes(error.message))) throw error;
      if (attempt < 2) {
        await wait(500 * (attempt + 1));
        continue;
      }
      throw new Error("Cannot connect to live database. Try again in a few seconds.");
    }
  }
}

function saveEmployeeToken(token, expiresAt) {
  localStorage.setItem(EMPLOYEE_TOKEN_KEY, token);
  localStorage.setItem(EMPLOYEE_TOKEN_EXPIRY_KEY, expiresAt || "");
  sessionStorage.setItem(EMPLOYEE_TOKEN_KEY, token);
  sessionStorage.setItem(EMPLOYEE_TOKEN_EXPIRY_KEY, expiresAt || "");
  setCookie(EMPLOYEE_TOKEN_COOKIE, token, 3650);
  setCookie(EMPLOYEE_TOKEN_EXPIRY_COOKIE, expiresAt || "", 3650);
  saveEmployeeTokenIndexedDb(token, expiresAt || "").catch(() => {});
}

function employeeToken() {
  const token =
    localStorage.getItem(EMPLOYEE_TOKEN_KEY) ||
    sessionStorage.getItem(EMPLOYEE_TOKEN_KEY) ||
    getCookie(EMPLOYEE_TOKEN_COOKIE) ||
    "";
  if (token) {
    localStorage.setItem(EMPLOYEE_TOKEN_KEY, token);
    sessionStorage.setItem(EMPLOYEE_TOKEN_KEY, token);
  }
  return token;
}

function clearEmployeeSession(message) {
  localStorage.removeItem(EMPLOYEE_TOKEN_KEY);
  localStorage.removeItem(EMPLOYEE_TOKEN_EXPIRY_KEY);
  sessionStorage.removeItem(EMPLOYEE_TOKEN_KEY);
  sessionStorage.removeItem(EMPLOYEE_TOKEN_EXPIRY_KEY);
  deleteCookie(EMPLOYEE_TOKEN_COOKIE);
  deleteCookie(EMPLOYEE_TOKEN_EXPIRY_COOKIE);
  clearEmployeeTokenIndexedDb().catch(() => {});
  state.currentUser = null;
  state.attendance = [];
  state.corrections = [];
  state.leaveRequests = [];
  saveState();
  stopQrScanner();
  stopLocationWatch();
  pendingScanAction = null;
  render();
  toast(message || "Employee account was deleted by HR.");
}

function mapLiveAttendance(row) {
  const canClockOut = Boolean(row.clock_in_at && !row.clock_out_at);
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    employeeCode: state.currentUser?.label,
    employeeName: state.currentUser?.name,
    date: row.work_date,
    clockIn: formatLiveTime(row.clock_in_at),
    breakTime: formatLiveTime(row.break_at),
    resumeTime: formatLiveTime(row.resume_at),
    clockOut: formatLiveTime(row.clock_out_at),
    workingMinutes: Number(row.total_minutes || 0),
    lateMinutes: Number(row.late_minutes || 0),
    earlyLeaveMinutes: Number(row.early_leave_minutes || 0),
    overtimeMinutes: Number(row.overtime_minutes || 0),
    status: statusLabel(row.status),
    source: row.source || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
    clockInUpdatedAt: row.clock_in_updated_at || row.updated_at || "",
    clockOutUpdatedAt: row.clock_out_updated_at || row.updated_at || "",
    reportEditedClockIn: Boolean(Number(row.report_edited_clock_in || 0)),
    reportEditedBreak: Boolean(Number(row.report_edited_break || 0)),
    reportEditedResume: Boolean(Number(row.report_edited_resume || 0)),
    reportEditedClockOut: Boolean(Number(row.report_edited_clock_out || 0)),
    hasReportMarks: Object.prototype.hasOwnProperty.call(row, "report_clock_in_mark") || Object.prototype.hasOwnProperty.call(row, "report_clock_out_mark"),
    clockInMark: row.report_clock_in_mark || "",
    clockOutMark: row.report_clock_out_mark || "",
    canClockOut,
    liveClockIn: formatLiveTime(canClockOut ? row.clock_in_at : null),
    gps: liveGpsLabel(row),
  };
}

function mapLiveCorrection(row) {
  const original = parseCorrectionOriginalRecord(row.original_record_json);
  const attendanceRow = state.attendance.find((item) => item.date === row.requested_date);
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    employeeCode: state.currentUser?.label,
    employeeName: state.currentUser?.name,
    date: row.requested_date,
    missingType: row.missing_type,
    missing: statusLabel(row.missing_type),
    requestedClockIn: formatLiveTime(row.requested_clock_in_at),
    requestedClockOut: formatLiveTime(row.requested_clock_out_at),
    requestedTime: formatLiveTime(row.requested_clock_out_at || row.requested_clock_in_at),
    originalClockIn: firstDisplayTime(original?.clock_in_at, row.report_clock_in_at, attendanceRow?.clockIn),
    originalClockOut: firstDisplayTime(original?.clock_out_at, row.report_clock_out_at, attendanceRow?.clockOut),
    reason: row.reason,
    status: statusLabel(row.status),
    createdAt: row.created_at || "",
    reviewedAt: row.reviewed_at || "",
  };
}

function firstDisplayTime(...values) {
  for (const value of values) {
    if (!value || String(value).toLowerCase() === "null") continue;
    const text = String(value);
    if (/^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, "0");
    const formatted = formatLiveTime(value);
    if (formatted) return formatted;
  }
  return null;
}

function parseCorrectionOriginalRecord(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function mapLiveLeaveRequest(row) {
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    date: row.leave_date,
    type: leaveTypeLabel(row.leave_type),
    duration: statusLabel(row.duration),
    reason: row.reason || "",
    status: leaveRequestStatusLabel(row),
    adminNote: row.admin_note || "",
  };
}

function bindEmployee() {
  bindShell();
  document.querySelectorAll("[data-clock]").forEach((button) => {
    button.addEventListener("click", () => openQrScanner(button.dataset.clock));
  });
  document.querySelectorAll("[data-history-date]").forEach((button) => {
    button.addEventListener("click", () => {
      updateSelectedEmployeeHistory(button.dataset.historyDate);
    });
  });
  document.querySelectorAll("[data-employee-month]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedEmployeeMonthKey = normalizedEmployeeMonthKey(button.dataset.employeeMonth);
      showAllEmployeeCorrections = false;
      selectedHistoryDate =
        selectedEmployeeMonthKey === currentEmployeeMonthKey()
          ? malaysiaDateKey(new Date())
          : `${selectedEmployeeMonthKey}-01`;
      render();
    });
  });
  document.querySelectorAll("[data-cancel-leave]").forEach((button) => {
    button.addEventListener("click", async () => {
      const ok = confirm("Cancel this Annual Leave/MC request?");
      if (!ok) return;
      try {
        await liveApi("/api/leave-requests", {
          method: "POST",
          body: JSON.stringify({
            action: "cancel",
            requestId: button.dataset.cancelLeave,
          }),
        });
        toast("Annual Leave/MC request cancelled.");
        await loadEmployeeLive(true);
        render();
      } catch (error) {
        toast(error.message || "Unable to cancel Annual Leave/MC request.");
      }
    });
  });
  document.querySelector("[data-toggle-employee-corrections]")?.addEventListener("click", () => {
    const shouldScrollBack = showAllEmployeeCorrections;
    showAllEmployeeCorrections = !showAllEmployeeCorrections;
    render();
    if (shouldScrollBack) {
      requestAnimationFrame(() => {
        document.querySelector("#corrections")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  });
  document.querySelector("[data-toggle-employee-leave]")?.addEventListener("click", () => {
    const shouldScrollBack = showAllEmployeeLeaveRequests;
    showAllEmployeeLeaveRequests = !showAllEmployeeLeaveRequests;
    render();
    if (shouldScrollBack) {
      requestAnimationFrame(() => {
        document.querySelector("#leave")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  });
  document.querySelectorAll("[data-cancel-correction]").forEach((button) => {
    button.addEventListener("click", async () => {
      const ok = confirm("Cancel this correction request?");
      if (!ok) return;
      const previousCorrections = state.corrections.map((correction) => ({ ...correction }));
      state.corrections = state.corrections.map((correction) =>
        correction.id === button.dataset.cancelCorrection ? { ...correction, status: "Cancelled" } : correction,
      );
      saveState();
      render();
      try {
        await liveApi("/api/corrections", {
          method: "POST",
          body: JSON.stringify({
            action: "cancel",
            correctionId: button.dataset.cancelCorrection,
          }),
        });
        toast("Correction request cancelled.");
        await loadEmployeeLive(true);
        render();
      } catch (error) {
        state.corrections = previousCorrections;
        saveState();
        render();
        toast(error.message || "Unable to cancel correction request.");
      }
    });
  });
  document.querySelector("[data-cancel-scan]")?.addEventListener("click", closeQrScanner);
  document.querySelector("[data-manual-qr]")?.addEventListener("click", () => {
    if (isN006CurrentUser()) {
      completeQrScan(MANUAL_QR_CODE);
      return;
    }
    const qr = prompt("Enter the manual QR code");
    if (qr) completeQrScan(qr.trim());
  });
  document.querySelector("[data-toggle-torch]")?.addEventListener("click", toggleQrTorch);
  if (pendingScanAction) startQrScanner();
  setupCorrectionCalendar(document.querySelector("#correction-form"));
  document.querySelector("#correction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const requestedDate = String(data.get("date"));
    const requestedTime = String(data.get("time"));
    const missing = String(data.get("missing"));
    try {
      await liveApi("/api/corrections", {
        method: "POST",
        body: JSON.stringify({
          employeeId: state.currentUser.employeeId,
          requestedDate,
          missingType: missing === "Clock In" ? "clock_in" : "clock_out",
          requestedClockInAt: missing === "Clock In" ? localDateTimeToIso(requestedDate, requestedTime) : null,
          requestedClockOutAt: missing === "Clock Out" ? localDateTimeToIso(requestedDate, requestedTime) : null,
          reason: String(data.get("reason")).trim(),
        }),
      });
      toast("Correction request submitted.");
      form.reset();
      await loadEmployeeLive(true);
      render();
    } catch (error) {
      toast(error.message || "Unable to submit correction request.");
    }
  });
  document.querySelector("#leave-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const leaveType = String(data.get("leaveType"));
    const startDate = String(data.get("startDate"));
    const endDate = String(data.get("endDate"));
    const duration = String(data.get("duration"));
    const reason = String(data.get("reason")).trim();
    const validation = validateLeaveRange(startDate, endDate, duration);
    if (validation) {
      toast(validation);
      updateLeaveDurationRule(form);
      return;
    }
    const leaveDates = leaveDatesInRange(startDate, endDate);
    const whatsappMessage = leaveWhatsAppMessage({ leaveType, startDate, endDate, duration, reason, leaveDates });
    const createdAt = Date.now();
    const tempRequests = leaveDates.map((leaveDate, index) => {
      const requestDuration = leaveDurationForDate(leaveDate, duration);
      return {
        id: `leave-pending-${createdAt}-${index}`,
        employeeId: state.currentUser.employeeId,
        date: leaveDate,
        type: leaveTypeLabel(leaveType),
        duration: statusLabel(requestDuration),
        rawDuration: requestDuration,
        reason,
        status: "Pending",
      };
    });

    optimisticLeaveSubmitInFlight = true;
    state.leaveRequests = [...tempRequests, ...(state.leaveRequests || [])];
    saveState();
    form.reset();
    render();
    toast(leaveDates.length === 1 ? "Annual Leave/MC submitted" : `Annual Leave/MC submitted for ${leaveDates.length} days.`);

    const failedTempIds = new Set();
    const serverIds = new Map();
    try {
      for (const request of tempRequests) {
        try {
          const result = await liveApi("/api/leave-requests", {
            method: "POST",
            body: JSON.stringify({
              employeeId: state.currentUser.employeeId,
              leaveType,
              leaveDate: request.date,
              duration: request.rawDuration,
              reason,
              notifyWhatsApp: false,
            }),
          });
          serverIds.set(request.id, result.leaveRequestId || request.id);
        } catch (error) {
          failedTempIds.add(request.id);
        }
      }
      if (failedTempIds.size === tempRequests.length) throw new Error("Unable to submit Annual Leave/MC request.");
      state.leaveRequests = (state.leaveRequests || []).map((request) =>
        serverIds.has(request.id) ? { ...request, id: serverIds.get(request.id) } : request,
      ).filter((request) => !failedTempIds.has(request.id));
      saveState();
      render();
      optimisticLeaveSubmitInFlight = false;
      await loadEmployeeLive(true);
      render();
      if (failedTempIds.size > 0) {
        toast(`${tempRequests.length - failedTempIds.size} submitted. ${failedTempIds.size} date already exists or failed.`);
      } else {
        openWhatsAppMessage(WHATSAPP_NOTIFY_NUMBER, whatsappMessage);
        toast("Annual Leave/MC submitted. WhatsApp opened.");
      }
    } catch (error) {
      state.leaveRequests = (state.leaveRequests || []).filter(
        (request) => !tempRequests.some((tempRequest) => tempRequest.id === request.id),
      );
      optimisticLeaveSubmitInFlight = false;
      saveState();
      render();
      toast(error.message || "Unable to submit Annual Leave/MC request.");
    }
  });
  const leaveForm = document.querySelector("#leave-form");
  if (leaveForm) setupLeaveCalendar(leaveForm);
  leaveForm?.querySelector('select[name="duration"]')?.addEventListener("change", () => updateLeaveDurationRule(leaveForm));
  if (leaveForm) updateLeaveDurationRule(leaveForm);
}

function bindAdmin() {
  bindShell();
  document.querySelector("#add-employee").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code")).trim().toUpperCase();
    const name = String(data.get("name")).trim();
    const phone = String(data.get("phone")).trim();
    if (!code || !name || !phone) return toast("Employee code, name and phone are required.");
    if (state.employees.some((employee) => employee.code.toUpperCase() === code)) {
      return toast("Employee code already exists.");
    }
    state.employees.push({
      id: `emp-${Date.now()}`,
      code,
      name,
      phone,
      department: String(data.get("department")).trim() || "Warehouse",
      position: String(data.get("position")).trim() || "Warehouse Associate",
      deviceFingerprint: null,
      deviceModel: "Not registered",
      deviceStatus: "Not registered",
    });
    saveState();
    event.currentTarget.reset();
    toast(`${code} added. This record is saved in this browser only.`);
    render();
  });

  document.querySelectorAll("[data-delete-employee]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingDeleteEmployeeId = button.dataset.deleteEmployee;
      render();
    });
  });

  document.querySelector("[data-cancel-delete]")?.addEventListener("click", () => {
    pendingDeleteEmployeeId = null;
    render();
  });

  document.querySelector("[data-confirm-delete]")?.addEventListener("click", () => {
    const employee = employeeById(pendingDeleteEmployeeId);
    preserveEmployeeHistory(employee);
    state.employees = state.employees.filter((row) => row.id !== employee.id);
    pendingDeleteEmployeeId = null;
    saveState();
    toast("Employee deleted. Attendance history was kept.");
    render();
  });

  document.querySelectorAll("[data-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const correction = state.corrections.find((row) => row.id === button.dataset.id);
      correction.status = button.dataset.review;
      if (correction.status === "Approved") applyCorrection(correction);
      saveState();
      render();
    });
  });

  document.querySelector("#admin-attendance-date")?.addEventListener("change", (event) => {
    selectedAdminAttendanceDate = event.currentTarget.value || malaysiaDateKey(new Date());
    render();
  });
  document.querySelector("#export-csv").addEventListener("click", exportCsv);
}

function bindShell() {
  document.querySelector("#install-app")?.addEventListener("click", () => {
    toast("Use browser menu > Add to Home Screen.");
  });
}

function openQrScanner(action) {
  pendingScanAction = action;
  render();
}

function closeQrScanner() {
  stopQrScanner();
  pendingScanAction = null;
  render();
}

async function completeQrScan(qr) {
  const action = pendingScanAction;
  const token = String(qr || "").trim();
  stopQrScanner();
  pendingScanAction = null;
  document.querySelector(".scan-modal")?.closest(".modal-backdrop")?.remove();
  if (!action || !token) {
    render();
    return;
  }
  await clock(action, token);
}

function updateSelectedEmployeeHistory(date) {
  selectedHistoryDate = date;
  document.querySelectorAll("[data-history-date]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.historyDate === date);
  });
  const title = document.querySelector("[data-history-title]");
  const content = document.querySelector("[data-history-content]");
  if (title) title.textContent = `My attendance - ${formatLeaveDateDisplay(date)}`;
  if (content) {
    const records = state.attendance.filter((row) => row.date === date).sort(compareAttendanceLatest);
    const corrections = correctionsForMonth(state.corrections, selectedEmployeeMonthKey);
    content.innerHTML = attendanceTable(records, true, date, corrections);
  }
}

async function startQrScanner() {
  const video = document.querySelector("#qr-video");
  const message = document.querySelector("#qr-scan-message");
  if (!video || !message || qrScanController?.active) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    message.textContent = "This browser cannot open the camera. Use Chrome or Manual QR.";
    return;
  }

  try {
    const detector = createBarcodeDetector();
    if (!detector && !window.jsQR) {
      message.textContent = "Loading QR scanner...";
      await waitForJsQr();
    }
    if (!detector && !window.jsQR) {
      message.textContent = "QR scanner did not load. Refresh once or use Manual QR.";
      return;
    }
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const stream = await openQrCameraStream();
    await configureQrCamera(stream);
    qrScanController = { active: true, stream, processing: false, lastScanAt: 0, lastTorchCheckAt: 0, torchOn: false };
    video.srcObject = stream;
    await video.play();
    message.textContent = "Point the camera at the warehouse QR code.";

    const scan = async () => {
      if (!qrScanController?.active) return;
      if (Date.now() - qrScanController.lastScanAt < QR_SCAN_INTERVAL_MS) {
        requestAnimationFrame(scan);
        return;
      }
      qrScanController.lastScanAt = Date.now();
      try {
        await enableTorchIfDark(video, canvas, context, message);
        const qr = await detectQrCode(video, detector, canvas, context);
        if (qr) {
          if (qrScanController.processing) return;
          qrScanController.processing = true;
          await completeQrScan(qr);
          return;
        }
      } catch {
        message.textContent = "Scanning... keep the QR inside the frame.";
      }
      requestAnimationFrame(scan);
    };
    requestAnimationFrame(scan);
  } catch {
    message.textContent = "Camera permission is needed. Allow camera or use Manual QR.";
  }
}

function createBarcodeDetector() {
  try {
    if ("BarcodeDetector" in window) return new BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
  return null;
}

async function waitForJsQr(timeoutMs = 3000) {
  const startedAt = Date.now();
  while (!window.jsQR && Date.now() - startedAt < timeoutMs) {
    await wait(100);
  }
  return Boolean(window.jsQR);
}

async function openQrCameraStream() {
  const attempts = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: false,
    },
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: true, audio: false },
  ];

  let lastError;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function configureQrCamera(stream) {
  const track = stream.getVideoTracks()[0];
  if (!track?.getCapabilities || !track.applyConstraints) return;
  try {
    const capabilities = track.getCapabilities();
    const advanced = [];
    if (capabilities.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
    if (advanced.length) await track.applyConstraints({ advanced });
  } catch {
    // Camera tuning is optional. Scanning still works when a browser ignores these constraints.
  }
}

async function enableTorchIfDark(video, canvas, context, message) {
  if (!qrScanController?.active || qrScanController.torchOn || !context) return;
  if (Date.now() - qrScanController.lastTorchCheckAt < QR_TORCH_CHECK_MS) return;
  qrScanController.lastTorchCheckAt = Date.now();
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

  const brightness = averageFrameLuma(video, canvas, context);
  if (brightness >= QR_DARK_FRAME_LUMA) return;

  const track = qrScanController.stream?.getVideoTracks()[0];
  if (!cameraTorchSupported(track)) return;
  try {
    await setQrTorch(true);
    message.textContent = "Flash on for low light. Point the camera at the warehouse QR code.";
  } catch {
    // Torch control is device/browser dependent; scanning continues without it.
  }
}

async function toggleQrTorch() {
  const message = document.querySelector("#qr-scan-message");
  const button = document.querySelector("[data-toggle-torch]");
  const track = qrScanController?.stream?.getVideoTracks()[0];
  if (!cameraTorchSupported(track)) {
    if (message) message.textContent = "Torch light is not supported on this phone/browser. Use Manual QR if needed.";
    return;
  }

  try {
    const nextTorch = !qrScanController.torchOn;
    await setQrTorch(nextTorch);
    if (button) button.textContent = nextTorch ? "Torch Off" : "Torch On";
    if (message) {
      message.textContent = nextTorch
        ? "Torch light on. Point the camera at the warehouse QR code."
        : "Torch light off. Point the camera at the warehouse QR code.";
    }
  } catch {
    if (message) message.textContent = "Unable to control torch light on this phone/browser.";
  }
}

async function setQrTorch(enabled) {
  const track = qrScanController?.stream?.getVideoTracks()[0];
  if (!cameraTorchSupported(track)) throw new Error("Torch is not supported.");
  await track.applyConstraints({ advanced: [{ torch: enabled }] });
  qrScanController.torchOn = enabled;
  const button = document.querySelector("[data-toggle-torch]");
  if (button) button.textContent = enabled ? "Torch Off" : "Torch On";
}

function cameraTorchSupported(track) {
  if (!track?.getCapabilities || !track.applyConstraints) return false;
  try {
    return Boolean(track.getCapabilities().torch);
  } catch {
    return false;
  }
}

function averageFrameLuma(video, canvas, context) {
  const width = 24;
  const height = 24;
  canvas.width = width;
  canvas.height = height;
  context.drawImage(video, 0, 0, width, height);
  const data = context.getImageData(0, 0, width, height).data;
  let total = 0;
  for (let index = 0; index < data.length; index += 4) {
    total += data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114;
  }
  return total / (data.length / 4);
}

async function detectQrCode(video, detector, canvas, context) {
  if (detector) {
    try {
      const codes = await detector.detect(video);
      const raw = String(codes[0]?.rawValue || "").trim();
      if (raw) return raw;
    } catch {
      // Fall back to jsQR below; some phones expose BarcodeDetector but fail on video frames.
    }
  }
  if (!window.jsQR || !context || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return "";
  const scale = Math.min(1, QR_CANVAS_MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const frameSize = Math.min(canvas.width, canvas.height);
  const sideScan = Math.floor(frameSize * 0.72);
  const wideScanHeight = Math.floor(canvas.height * 0.62);
  const scans = [
    [0, 0, canvas.width, canvas.height],
    ...[0.92, 0.78, 0.64, 0.5].map((scale) => {
      const size = Math.floor(frameSize * scale);
      return [Math.floor((canvas.width - size) / 2), Math.floor((canvas.height - size) / 2), size, size];
    }),
    [0, Math.floor((canvas.height - wideScanHeight) / 2), canvas.width, wideScanHeight],
    [0, Math.floor((canvas.height - sideScan) / 2), sideScan, sideScan],
    [canvas.width - sideScan, Math.floor((canvas.height - sideScan) / 2), sideScan, sideScan],
  ];

  for (const [x, y, width, height] of scans) {
    const image = context.getImageData(x, y, width, height);
    const qr = String(window.jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" })?.data || "").trim();
    if (qr) return qr;
  }
  return "";
}

function stopQrScanner() {
  if (qrScanController?.stream) {
    qrScanController.stream.getTracks().forEach((track) => track.stop());
  }
  qrScanController = null;
}

async function clock(action, qr) {
  const scanner = document.querySelector("#scanner");
  const message = document.querySelector("#gps-message");
  scanner.className = "scanner";
  const scannedQr = String(qr || "").trim();
  const isManualQr = scannedQr.toUpperCase() === MANUAL_QR_CODE;
  if (scannedQr !== WAREHOUSE.qr && !isManualQr) {
    scanner.className = "scanner rejected";
    message.textContent = "Invalid warehouse QR code.";
    return;
  }
  message.textContent = "Verifying warehouse GPS location...";
  let samples = [];
  try {
    samples = await collectGpsSamples();
  } catch (error) {
    scanner.className = "scanner rejected";
    message.textContent = error.message || "Unable to read phone GPS. Please enable Location Services.";
    return;
  }
  const sample = samples.sort((a, b) => a.accuracy - b.accuracy)[0];
  const distance = Math.round(distanceMeters(sample.latitude, sample.longitude, WAREHOUSE.lat, WAREHOUSE.lng));
  const allowedDistance = WAREHOUSE.radius;
  if (sample.source !== "browser" || sample.accuracy > MAX_GPS_ACCURACY_METERS || distance > allowedDistance) {
    scanner.className = "scanner rejected";
    message.textContent =
      `Unable to verify location. GPS accuracy ${Math.round(sample.accuracy)}m, distance ${distance}m, allowed ${Math.round(allowedDistance)}m.`;
    return;
  }

  try {
    const result = await liveApi("/api/attendance/clock", {
      method: "POST",
      body: JSON.stringify({
        employeeId: state.currentUser.employeeId,
        action: action === "in" ? "clock_in" : "clock_out",
        qrToken: WAREHOUSE.qr,
        deviceFingerprint: getDeviceFingerprint(),
        deviceModel: browserDeviceLabel(),
        samples,
      }),
    });
    scanner.className = "scanner accepted";
    message.textContent = result.action === "clock_in_existing"
      ? `Already clocked in. GPS ${Math.round(result.accuracy)}m accuracy, ${Math.round(result.distance)}m from warehouse.`
      : `Attendance accepted. GPS ${Math.round(result.accuracy)}m accuracy, ${Math.round(result.distance)}m from warehouse.`;
    await loadEmployeeLive(true);
    await wait(900);
    render();
  } catch (error) {
    scanner.className = "scanner rejected";
    message.textContent = error.message || "Unable to save attendance.";
  }
}

function metrics(items) {
  return `<section class="metrics">${items
    .map(([label, value, tone]) => `<article class="metric ${tone}"><span>${label}</span><strong>${value}</strong></article>`)
    .join("")}</section>`;
}

function monthCalendar(records, leaveRequests, corrections, selectedDate, monthDate) {
  const today = malaysiaDateKey(new Date());
  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const firstDay = monthDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
  const cells = [];

  ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach((day) => {
    cells.push(`<div class="month-weekday">${day}</div>`);
  });
  for (let index = 0; index < firstDay; index += 1) {
    cells.push(`<div class="month-empty" aria-hidden="true"></div>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dayRecords = records.filter((row) => row.date === date);
    const leave = calendarLeaveForDate(leaveRequests, date);
    const summary = leave || calendarRecordSummary(dayRecords, date, today, corrections);
    const isToday = date === today;
    const classes = ["month-day", summary.tone, isToday ? "today" : "", date === selectedDate ? "selected" : ""].filter(Boolean).join(" ");
    cells.push(`
      <button class="${classes}" type="button" data-history-date="${date}" ${isToday ? 'aria-current="date"' : ""}>
        <span>${day}</span>
        <small>${escapeHtml(summary.label)}</small>
      </button>
    `);
  }
  return cells.join("");
}

function calendarLeaveForDate(leaveRequests, date) {
  const request = leaveRequests.find((item) => {
    const status = String(item.status || "").toLowerCase();
    return item.date === date && status !== "rejected" && status !== "cancelled";
  });
  if (!request) return null;
  return { label: calendarLeaveLabel(request), tone: "leave-note" };
}

function calendarLeaveLabel(request) {
  const duration = String(request.duration || "").toLowerCase();
  const type = String(request.type || "").toLowerCase();
  const durationLabel = duration.includes("half") ? "Half" : "Full";
  const typeLabel = type.includes("mc") ? "MC" : "AL";
  return `${durationLabel}\n${typeLabel}`;
}

function calendarRecordSummary(records, date, today, corrections = []) {
  if (!records.length) return { label: "-", tone: "" };

  const displayRecords = records.map((row) => attendanceDisplayTimes(row, corrections));
  const hasMissingIn = displayRecords.some((row) => !row.clockIn && row.clockOut);
  const hasMissingOut = displayRecords.some((row) => row.clockIn && !row.clockOut && date < today);
  const missed = hasMissingIn || hasMissingOut;
  const present = displayRecords.some((row) => row.clockIn && row.clockOut);

  return {
    label: missed ? "X" : present ? "OK" : "-",
    tone: missed ? "missed" : present ? "present" : "",
  };
}

function compareAttendanceLatest(a, b) {
  const left = parseLiveTimestamp(b.updatedAt || b.createdAt || `${b.date || ""}T00:00:00+08:00`) || 0;
  const right = parseLiveTimestamp(a.updatedAt || a.createdAt || `${a.date || ""}T00:00:00+08:00`) || 0;
  return left - right;
}

function parseLiveTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return Date.parse(`${text.replace(" ", "T")}Z`);
  }
  return Date.parse(text);
}

function isSameOrNewer(left, right) {
  const leftMs = parseLiveTimestamp(left);
  const rightMs = parseLiveTimestamp(right);
  if (Number.isNaN(leftMs)) return false;
  if (Number.isNaN(rightMs)) return true;
  return leftMs >= rightMs;
}

function sameClockValue(left, right) {
  return Boolean(left && right && String(left) === String(right));
}

function approvedCorrectionForField(row, field, corrections = []) {
  const key = field === "clockIn" ? "requestedClockIn" : "requestedClockOut";
  const fieldUpdatedAt = field === "clockIn" ? row.clockInUpdatedAt : row.clockOutUpdatedAt;
  return corrections
    .filter((correction) => correction.date === row.date && correction.status === "Approved" && correction[key])
    .sort((a, b) => parseLiveTimestamp(b.reviewedAt || b.createdAt || "") - parseLiveTimestamp(a.reviewedAt || a.createdAt || ""))
    .find((correction) => sameClockValue(correction[key], row[field]) && isSameOrNewer(correction.reviewedAt || correction.createdAt, fieldUpdatedAt || row.updatedAt || row.createdAt));
}

function attendanceDisplayTimes(row, corrections = []) {
  const correctedIn = approvedCorrectionForField(row, "clockIn", corrections);
  const correctedOut = approvedCorrectionForField(row, "clockOut", corrections);
  return {
    clockIn: correctedIn?.requestedClockIn || row.clockIn,
    breakTime: row.breakTime || null,
    resumeTime: row.resumeTime || null,
    clockOut: correctedOut?.requestedClockOut || row.clockOut,
  };
}

function attendanceEditMarks(row, corrections = []) {
  if (row.hasReportMarks) {
    return {
      clockIn: row.clockInMark || "",
      breakTime: row.reportEditedBreak && row.breakTime ? "edited" : "",
      resumeTime: row.reportEditedResume && row.resumeTime ? "edited" : "",
      clockOut: row.clockOutMark || "",
    };
  }
  const correctedIn = approvedCorrectionForField(row, "clockIn", corrections);
  const correctedOut = approvedCorrectionForField(row, "clockOut", corrections);
  return {
    clockIn: correctedIn ? "corrected" : row.reportEditedClockIn && row.clockIn ? "edited" : "",
    breakTime: row.reportEditedBreak && row.breakTime ? "edited" : "",
    resumeTime: row.reportEditedResume && row.resumeTime ? "edited" : "",
    clockOut: correctedOut ? "corrected" : row.reportEditedClockOut && row.clockOut ? "edited" : "",
  };
}

function timeCell(value, mark = "") {
  const text = value || "-";
  if (!mark || text === "-") return escapeHtml(text);
  return `<span class="time-mark ${mark}">${escapeHtml(text)}</span>`;
}

function employeeHistoryTimeCell(value) {
  const text = value || "";
  return `<td class="history-time-cell"><span class="history-time-value">${escapeHtml(text)}</span></td>`;
}

function attendanceTable(records, employeeOnly, emptyDate = "", corrections = []) {
  if (!records.length) {
    return `<div class="empty-state">
      <strong>No attendance records${emptyDate ? ` on ${escapeHtml(formatLeaveDateDisplay(emptyDate))}` : " yet"}.</strong>
      <small>${employeeOnly ? "Tap another date in Current Month to view that day." : "GitHub Pages stores attendance inside each phone/browser. Records from employee phones will not appear on this HR browser unless this app uses an online database."}</small>
    </div>`;
  }

  return `
    <div class="table-wrap${employeeOnly ? " employee-history-wrap" : ""}">
      <table${employeeOnly ? ' class="employee-history-table"' : ""}>
        <thead><tr>${employeeOnly ? employeeAttendanceHeader() : adminAttendanceHeader()}</tr></thead>
        <tbody>${records
          .map((row) => {
            const marks = attendanceEditMarks(row, corrections);
            const display = attendanceDisplayTimes(row, corrections);
            return employeeOnly ? employeeAttendanceRow(row, display) : adminAttendanceRow(row, display, marks);
          })
          .join("")}</tbody>
      </table>
    </div>`;
}

function employeeAttendanceHeader() {
  return "<th>Date</th><th>Clock In</th><th>Clock Out</th><th>OT</th>";
}

function adminAttendanceHeader() {
  return "<th>Employee</th><th>Date</th><th>Clock In</th><th>Clock Out</th><th>Working Hours</th><th>OT</th><th>Status</th><th>GPS</th>";
}

function employeeAttendanceRow(row, display) {
  return `<tr><td>${row.date}</td>${employeeHistoryTimeCell(display.clockIn)}${employeeHistoryTimeCell(display.clockOut)}<td>${formatReportOtMinutes(employeeHistoryOvertimeMinutes(row, display))}</td></tr>`;
}

function adminAttendanceRow(row, display, marks) {
  return `<tr><td>${escapeHtml(employeeLabel(row))}</td><td>${row.date}</td><td>${timeCell(display.clockIn, marks.clockIn)}</td><td>${timeCell(display.clockOut, marks.clockOut)}</td><td>${formatMinutes(row.workingMinutes)}</td><td>${formatOtMinutes(row.overtimeMinutes)}</td><td><span class="badge ${row.status.toLowerCase()}">${row.status}</span></td><td>${row.gps || "-"}</td></tr>`;
}

function employeeCard(employee) {
  return `<div class="list-item employee-row"><strong>${employee.code} - ${escapeHtml(employee.name)}</strong><span class="badge ${employee.deviceStatus.toLowerCase().replaceAll(" ", "-")}">${employee.deviceStatus}</span><button class="danger" data-delete-employee="${employee.id}">Delete</button><small>${escapeHtml(employee.deviceModel)}</small></div>`;
}

function correctionCard(correction) {
  const requested = correctionRequestedLine(correction);
  const reason = correction.reason
    ? `<span class="correction-card-reason">${escapeHtml(correction.reason)}</span>`
    : "";
  const canCancel = correction.status === "Pending";
  return `<article class="list-item correction-card"><div class="correction-card-copy"><strong class="correction-card-title">${escapeHtml(correction.date)} - ${escapeHtml(correction.missing)}</strong><span class="correction-card-request">${requested}</span>${reason}</div><div class="actions correction-card-actions"><span class="badge ${correction.status.toLowerCase()}">${correction.status}</span>${canCancel ? `<button class="secondary" type="button" data-cancel-correction="${correction.id}">Cancel</button>` : ""}</div></article>`;
}

function correctionRequestedLine(correction) {
  const originalTime = correction.missing === "Clock In" ? correction.originalClockIn : correction.originalClockOut;
  const requestedTime = correction.missing === "Clock In" ? correction.requestedClockIn : correction.requestedClockOut;
  if (!requestedTime) return "Requested: -";
  if (!originalTime) return `Requested: <span class="time-mark corrected">${escapeHtml(requestedTime)}</span>`;
  return `Requested: ${escapeHtml(originalTime)} to <span class="time-mark corrected">${escapeHtml(requestedTime)}</span>`;
}

function correctionsForMonth(corrections, monthKey) {
  return (corrections || []).filter((correction) => correctionMonthKey(correction) === monthKey);
}

function correctionMonthKey(correction) {
  return String(correction.date || "").slice(0, 7);
}

function recordsForMonth(records, monthKey) {
  return (records || []).filter((record) => String(record.date || "").slice(0, 7) === monthKey);
}

function monthDateRange(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    start: `${monthKey}-01`,
    end: `${monthKey}-${String(lastDay).padStart(2, "0")}`,
  };
}

function correctionDateInMonth(dateKey, monthKey) {
  return String(dateKey || "").startsWith(`${monthKey}-`) ? dateKey : monthDateRange(monthKey).start;
}

function correctionDateField(value, monthKey, range) {
  return `
    <div class="field correction-date-field" data-correction-date-field>
      <span>Date</span>
      <input name="date" type="hidden" value="${value}" data-correction-date min="${range.start}" max="${range.end}" required />
      <button class="date-picker-button" type="button" data-open-correction-calendar>
        <span data-selected-correction-date>${formatLeaveDateDisplay(value)}</span>
      </button>
      <div class="leave-calendar" data-correction-calendar hidden>${correctionCalendarMarkup(value, monthKey)}</div>
    </div>
  `;
}

function correctionCalendarMarkup(selectedDate, monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const monthDate = new Date(Date.UTC(year, month - 1, 1));
  const firstDay = monthDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const header = monthDate.toLocaleDateString("en-MY", { timeZone: "UTC", month: "long", year: "numeric" });
  const cells = [];
  for (let index = 0; index < firstDay; index += 1) {
    cells.push(`<button class="calendar-day calendar-empty" type="button" tabindex="-1" disabled aria-hidden="true">&nbsp;</button>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const classes = ["calendar-day", dateKey === selectedDate ? "is-selected" : ""].filter(Boolean).join(" ");
    cells.push(`<button class="${classes}" type="button" data-correction-calendar-date="${dateKey}">${day}</button>`);
  }
  return `
    <div class="calendar-head"><strong>${escapeHtml(header)}</strong></div>
    <div class="calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
}

function visibleEmployeeLeaveRequests(requests, showAll = false) {
  const items = requests || [];
  return showAll ? items : items.slice(0, 5);
}

function leaveRequestCard(request) {
  const canCancel = request.status === "Pending" || (!["Rejected", "Cancelled"].includes(request.status) && request.date >= malaysiaDateKey(new Date()));
  const cancelled = request.status === "Cancelled";
  const statusBadge = `<span class="badge ${request.status.toLowerCase()}">${request.status}</span>`;
  return `<div class="list-item leave-card"><div><div class="leave-card-title"><strong>${request.date} - ${request.type}</strong>${cancelled ? statusBadge : ""}</div><span>${request.duration}${request.reason ? ` | ${escapeHtml(request.reason)}` : ""}</span></div>${cancelled ? "" : `<div class="actions">${statusBadge}${canCancel ? `<button class="secondary" type="button" data-cancel-leave="${request.id}">Cancel</button>` : ""}</div>`}</div>`;
}

function leaveRangeField(value) {
  return `
    <div class="field leave-date-field" data-leave-date-field>
      <span>Date range</span>
      <input name="startDate" type="hidden" value="${value}" required />
      <input name="endDate" type="hidden" value="${value}" required />
      <button class="date-picker-button" type="button" data-open-leave-calendar>
        <span data-selected-leave-date>${formatLeaveRangeDisplay(value, value)}</span>
      </button>
      <div class="leave-calendar" data-leave-calendar hidden></div>
    </div>
  `;
}

function leaveWhatsAppMessage({ leaveType, startDate, endDate, duration, reason, leaveDates }) {
  const typeLabel = leaveTypeLabel(leaveType);
  return [
    "Annual Leave/MC request",
    `Employee: ${state.currentUser.label} - ${state.currentUser.name}`,
    `Type: ${typeLabel}`,
    leaveWhatsAppDateLines(leaveDates, duration),
    `Reason: ${reason}`,
    `Working days submitted: ${formatLeaveSubmittedDays(leaveDates, duration)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function leaveWhatsAppDateLines(leaveDates, duration) {
  return leaveDates
    .map((date, index) => {
      const line = `${date} (${statusLabel(leaveDurationForDate(date, duration))})`;
      return line;
    })
    .join("\n");
}

function formatLeaveSubmittedDays(leaveDates, duration) {
  const total = leaveDates.reduce((sum, date) => sum + leaveSubmittedDayValue(date, duration), 0);
  return Number.isInteger(total) ? String(total) : total.toFixed(1);
}

function leaveSubmittedDayValue(date, duration) {
  return leaveDurationForDate(date, duration) === "half_day" ? 0.5 : 1;
}

function openWhatsAppMessage(phone, message) {
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, "_blank", "noopener");
}

function updateLeaveDurationRule(form) {
  const startInput = form.querySelector('input[name="startDate"]');
  const endInput = form.querySelector('input[name="endDate"]');
  const durationSelect = form.querySelector('select[name="duration"]');
  const rule = form.querySelector("[data-leave-rule]");
  if (!startInput || !endInput || !durationSelect || !rule) return;

  const dates = leaveDatesInRange(startInput.value, endInput.value);
  const fullDayOption = durationSelect.querySelector('option[value="full_day"]');
  const hasSaturday = dates.some((date) => leaveDateDayOfWeek(date) === 6);
  const allSaturday = dates.length > 0 && dates.every((date) => leaveDateDayOfWeek(date) === 6);
  if (fullDayOption) fullDayOption.disabled = allSaturday;
  if (allSaturday) durationSelect.value = "half_day";

  const notes = [];
  if (rangeIncludesSunday(startInput.value, endInput.value)) notes.push("Sundays are skipped.");
  if (allSaturday) notes.push("Saturday is half day only.");
  else if (hasSaturday) notes.push("Saturday in this range will be submitted as half day.");
  rule.textContent = notes.join(" ");
}

function setupLeaveCalendar(form) {
  const field = form.querySelector("[data-leave-date-field]");
  const startInput = form.querySelector('input[name="startDate"]');
  const endInput = form.querySelector('input[name="endDate"]');
  const button = field?.querySelector("[data-open-leave-calendar]");
  const label = field?.querySelector("[data-selected-leave-date]");
  const calendar = field?.querySelector("[data-leave-calendar]");
  if (!field || !startInput || !endInput || !button || !label || !calendar) return;

  const refresh = () => {
    label.textContent = formatLeaveRangeDisplay(startInput.value, endInput.value);
    calendar.innerHTML = leaveCalendarMarkup(startInput.value, calendar.dataset.month || startInput.value, endInput.value);
    updateLeaveDurationRule(form);
  };

  button.addEventListener("click", () => {
    calendar.hidden = !calendar.hidden;
    calendar.dataset.rangeStep = "start";
    if (!calendar.hidden) refresh();
  });

  calendar.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const monthButton = target.closest("[data-calendar-month]");
    if (monthButton) {
      calendar.dataset.month = monthButton.dataset.calendarMonth;
      refresh();
      return;
    }

    const dayButton = target.closest("[data-calendar-date]");
    if (!dayButton || dayButton.disabled) return;
    const selectedDate = dayButton.dataset.calendarDate;
    if (calendar.dataset.rangeStep !== "end") {
      startInput.value = selectedDate;
      endInput.value = selectedDate;
      calendar.dataset.month = selectedDate;
      calendar.dataset.rangeStep = "end";
      refresh();
      return;
    }

    if (selectedDate < startInput.value) {
      endInput.value = startInput.value;
      startInput.value = selectedDate;
    } else {
      endInput.value = selectedDate;
    }
    calendar.dataset.month = selectedDate;
    calendar.dataset.rangeStep = "start";
    calendar.hidden = true;
    refresh();
  });

  refresh();
}

function setupCorrectionCalendar(form) {
  const field = form?.querySelector("[data-correction-date-field]");
  const input = form?.querySelector("[data-correction-date]");
  const button = field?.querySelector("[data-open-correction-calendar]");
  const label = field?.querySelector("[data-selected-correction-date]");
  const calendar = field?.querySelector("[data-correction-calendar]");
  if (!field || !input || !button || !label || !calendar) return;

  button.addEventListener("click", () => {
    calendar.hidden = !calendar.hidden;
  });

  calendar.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const dayButton = target?.closest("[data-correction-calendar-date]");
    if (!dayButton || dayButton.disabled) return;
    input.value = dayButton.dataset.correctionCalendarDate;
    label.textContent = formatLeaveDateDisplay(input.value);
    calendar.innerHTML = correctionCalendarMarkup(input.value, selectedEmployeeMonthKey);
    calendar.hidden = true;
  });
}

function validateLeaveDateAndDuration(date, duration) {
  if (!date) return "Select Annual Leave/MC date.";
  if (date < malaysiaDateKey(new Date())) return "Past dates cannot be selected for Annual Leave/MC.";
  const day = leaveDateDayOfWeek(date);
  if (day === 0) return "Annual Leave/MC cannot be selected on Sunday.";
  if (day === 6 && duration !== "half_day") return "Saturday Annual Leave/MC can only be half day.";
  return "";
}

function validateLeaveRange(startDate, endDate, duration) {
  if (!startDate || !endDate) return "Select Annual Leave/MC start and end date.";
  if (startDate < malaysiaDateKey(new Date()) || endDate < malaysiaDateKey(new Date())) return "Past dates cannot be selected for Annual Leave/MC.";
  if (endDate < startDate) return "End date cannot be before start date.";
  const dates = leaveDatesInRange(startDate, endDate);
  if (!dates.length) return "Select at least one working day. Sunday cannot be selected.";
  return dates.map((date) => validateLeaveDateAndDuration(date, leaveDurationForDate(date, duration))).find(Boolean) || "";
}

function leaveDurationForDate(date, duration) {
  return leaveDateDayOfWeek(date) === 6 ? "half_day" : duration;
}

function syncLeaveDateRange(form, changedInput) {
  const startInput = form.querySelector('input[name="startDate"]');
  const endInput = form.querySelector('input[name="endDate"]');
  if (!startInput || !endInput || !changedInput) return;
  if (startInput.value <= endInput.value) return;
  if (changedInput.name === "startDate") {
    endInput.value = startInput.value;
  } else {
    startInput.value = endInput.value;
  }
}

function leaveDatesInRange(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return [];
  const dates = [];
  const cursor = parseUtcDateKey(startDate);
  const end = parseUtcDateKey(endDate);

  while (cursor <= end) {
    const dateKey = utcDateKey(cursor);
    if (leaveDateDayOfWeek(dateKey) !== 0) dates.push(dateKey);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function rangeIncludesSunday(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return false;
  const cursor = parseUtcDateKey(startDate);
  const end = parseUtcDateKey(endDate);
  while (cursor <= end) {
    if (cursor.getUTCDay() === 0) return true;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return false;
}

function parseUtcDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function leaveDateDayOfWeek(value) {
  if (!value) return -1;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function defaultLeaveDate() {
  const today = malaysiaDateKey(new Date());
  if (leaveDateDayOfWeek(today) !== 0) return today;
  return nextLeaveDate(today);
}

function nextLeaveDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while (date.getUTCDay() === 0);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function leaveCalendarMarkup(selectedDate, monthValue, rangeEndDate = selectedDate) {
  const today = malaysiaDateKey(new Date());
  const monthDate = leaveCalendarMonth(monthValue);
  const monthLabel = monthDate.toLocaleDateString("en-MY", { timeZone: "UTC", month: "long", year: "numeric" });
  const monthKey = `${monthDate.getUTCFullYear()}-${String(monthDate.getUTCMonth() + 1).padStart(2, "0")}`;
  const todayMonthKey = today.slice(0, 7);
  const firstDay = monthDate.getUTCDay();
  const daysInMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0)).getUTCDate();
  const previousMonth = addCalendarMonths(monthDate, -1);
  const nextMonth = addCalendarMonths(monthDate, 1);
  const cells = [];

  for (let index = 0; index < firstDay; index += 1) {
    cells.push(`<button class="calendar-day calendar-empty" type="button" tabindex="-1" disabled aria-hidden="true">&nbsp;</button>`);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateKey = `${monthKey}-${String(day).padStart(2, "0")}`;
    const dayOfWeek = leaveDateDayOfWeek(dateKey);
    const isPast = dateKey < today;
    const isSunday = dayOfWeek === 0;
    const isDisabled = isPast || isSunday;
    const isSelectedStart = dateKey === selectedDate;
    const isSelectedEnd = dateKey === rangeEndDate;
    const isRangeMiddle = dateKey > selectedDate && dateKey < rangeEndDate && !isSunday;
    const classes = [
      "calendar-day",
      isSunday ? "is-sunday" : "",
      isPast ? "is-past" : "",
      isDisabled ? "is-disabled" : "",
      isSelectedStart || isSelectedEnd ? "is-selected" : "",
      isRangeMiddle ? "is-in-range" : "",
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(`<button class="${classes}" type="button" data-calendar-date="${dateKey}" ${isDisabled ? "disabled" : ""}>${day}</button>`);
  }

  return `
    <div class="calendar-head">
      <button class="secondary calendar-nav" type="button" data-calendar-month="${calendarMonthKey(previousMonth)}" ${monthKey <= todayMonthKey ? "disabled" : ""}>Prev</button>
      <strong>${monthLabel}</strong>
      <button class="secondary calendar-nav" type="button" data-calendar-month="${calendarMonthKey(nextMonth)}">Next</button>
    </div>
    <div class="calendar-weekdays">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="calendar-grid">${cells.join("")}</div>
  `;
}

function leaveCalendarMonth(value) {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function addCalendarMonths(date, offset) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
}

function calendarMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function formatLeaveDateDisplay(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-MY", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatLeaveRangeDisplay(startDate, endDate) {
  if (!startDate || !endDate || startDate === endDate) return formatLeaveDateDisplay(startDate || endDate);
  return `${formatLeaveDateDisplay(startDate)} to ${formatLeaveDateDisplay(endDate)}`;
}

function adminCorrectionCard(correction) {
  return `<article class="list-item"><strong>${escapeHtml(correctionEmployeeLabel(correction))}</strong><span>${correction.date} ${correction.missing} ${correction.requestedTime}</span><p>${escapeHtml(correction.reason)}</p><span class="badge ${correction.status.toLowerCase()}">${correction.status}</span>${correction.status === "Pending" ? `<div class="actions"><button data-review="Approved" data-id="${correction.id}">Approve</button><button class="danger" data-review="Rejected" data-id="${correction.id}">Reject</button></div>` : ""}</article>`;
}

function applyCorrection(correction) {
  let record = state.attendance.find((row) => row.employeeId === correction.employeeId && row.date === correction.date);
  if (!record) {
    record = {
      id: `att-${Date.now()}`,
      employeeId: correction.employeeId,
      employeeCode: correction.employeeCode || employeeById(correction.employeeId).code,
      employeeName: correction.employeeName || employeeById(correction.employeeId).name,
      date: correction.date,
      clockIn: null,
      clockOut: null,
      workingMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      status: "Present",
      gps: "Admin approved",
    };
    state.attendance.push(record);
  }
  if (correction.missing !== "Clock Out") record.clockIn = correction.requestedTime;
  if (correction.missing !== "Clock In") record.clockOut = correction.requestedTime;
  if (record.clockIn && record.clockOut) {
    record.workingMinutes = Math.max(0, toMinutes(record.clockOut) - toMinutes(record.clockIn));
    record.overtimeMinutes = calculateOvertime(record.clockOut, "18:00", "18:16");
    record.status = record.overtimeMinutes > 0 ? "OT" : "Present";
  }
}

async function bestGpsSample() {
  return (await collectGpsSamples()).sort((a, b) => a.accuracy - b.accuracy)[0];
}

async function collectGpsSamples() {
  startLocationWatch();
  const samples = recentGpsSamples();
  const readySample = bestUsableWarehouseGpsSample(samples);
  if (readySample) return paddedGpsSamples(samples, readySample);

  const startedAt = Date.now();
  while (Date.now() - startedAt < currentGpsWaitMs()) {
    const sample = await getGpsSample();
    if (sample) samples.push(sample);
    const bestSample = bestUsableWarehouseGpsSample(samples);
    if (bestSample) return paddedGpsSamples(samples, bestSample);
    await wait(80);
  }

  const freshBrowserSamples = samples.filter((sample) => sample.source === "browser" && Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS);
  const bestFreshSample = bestUsableWarehouseGpsSample(freshBrowserSamples);
  if (bestFreshSample) return paddedGpsSamples(freshBrowserSamples, bestFreshSample);
  if (freshBrowserSamples.length > 0) {
    return paddedGpsSamples(
      freshBrowserSamples,
      freshBrowserSamples.sort((a, b) => a.accuracy - b.accuracy)[0],
    );
  }
  if (freshBrowserSamples.length < 5) {
    throw new Error("No fresh GPS reading received from this browser. Turn Location on for Chrome/Safari and this site, then try again.");
  }
  return freshBrowserSamples.sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
}

function bestUsableWarehouseGpsSample(samples) {
  return samples
    .filter((sample) => sample.source === "browser" && Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS)
    .sort((a, b) => a.accuracy - b.accuracy)
    .find((sample) => {
      const distance = distanceMeters(sample.latitude, sample.longitude, WAREHOUSE.lat, WAREHOUSE.lng);
      return sample.accuracy <= MAX_GPS_ACCURACY_METERS && distance <= WAREHOUSE.radius;
    });
}

function currentGpsWaitMs() {
  return isN006CurrentUser() ? N006_GPS_WAIT_MS : DEFAULT_GPS_WAIT_MS;
}

function isN006CurrentUser() {
  return state.currentUser?.label === "N006";
}

function paddedGpsSamples(samples, bestSample) {
  const freshBrowserSamples = samples
    .filter((sample) => sample.source === "browser" && Date.now() - sample.timestamp <= GPS_SAMPLE_MAX_AGE_MS)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 5);
  while (freshBrowserSamples.length < 5) {
    freshBrowserSamples.push({ ...bestSample, timestamp: Date.now() });
  }
  return freshBrowserSamples;
}

function getGpsSample() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(saveGpsSample(position)),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 },
    );
  });
}

function startLocationWatch() {
  if (!navigator.geolocation || gpsWatchId !== null) return;
  gpsWatchId = navigator.geolocation.watchPosition(
    (position) => {
      saveGpsSample(position);
      const message = document.querySelector("#gps-message");
      if (message && !pendingScanAction) {
        const sample = latestGpsSamples[latestGpsSamples.length - 1];
        message.textContent = gpsReadyMessage(sample);
      }
    },
    () => {},
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

function saveGpsSample(position) {
  const timestamp = position.timestamp || Date.now();
  const sample = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
    timestamp,
    source: "browser",
  };
  latestGpsSamples.push(sample);
  latestGpsSamples = latestGpsSamples.filter((item) => Date.now() - item.timestamp < 30000).slice(-10);
  return sample;
}

function recentGpsSamples() {
  return latestGpsSamples.filter((sample) => Date.now() - sample.timestamp < GPS_SAMPLE_MAX_AGE_MS);
}

function gpsReadyMessage(sample) {
  const distance = Math.round(distanceMeters(sample.latitude, sample.longitude, WAREHOUSE.lat, WAREHOUSE.lng));
  const accuracy = Math.round(sample.accuracy);
  if (distance > WAREHOUSE.radius) {
    return `GPS ready, but outside warehouse. Distance ${distance}m, accuracy ${accuracy}m, allowed ${WAREHOUSE.radius}m.`;
  }
  return `GPS ready. Distance ${distance}m from warehouse, accuracy ${accuracy}m.`;
}

function exportCsv() {
  const rowsForExport =
    state.currentUser?.role === "admin"
      ? state.attendance.filter((row) => row.date === selectedAdminAttendanceDate)
      : state.attendance;
  const rows = [
    ["Employee", "Date", "Clock In", "Clock Out", "Working Minutes", "OT Minutes", "Status"],
    ...rowsForExport.map((row) => {
      return [employeeLabel(row), row.date, row.clockIn || "", row.clockOut || "", row.workingMinutes, row.overtimeMinutes, row.status];
    }),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = state.currentUser?.role === "admin" ? `attendance-report-${selectedAdminAttendanceDate}.csv` : "attendance-report.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function employeeById(id) {
  if (state.currentUser?.employeeId === id) {
    return {
      id,
      code: state.currentUser.label,
      name: state.currentUser.name,
    };
  }
  return findEmployeeById(id) || { id, code: "Deleted", name: "Deleted employee" };
}

function warehouseQrImageUrl() {
  return "public/warehouse-qr.png";
}

function findEmployeeById(id) {
  return state.employees.find((employee) => employee.id === id);
}

function employeeLabel(record) {
  const employee = findEmployeeById(record.employeeId);
  const code = employee?.code || record.employeeCode || "Deleted";
  const name = employee?.name || record.employeeName || "Deleted employee";
  return `${code} - ${name}`;
}

function correctionEmployeeLabel(correction) {
  const employee = findEmployeeById(correction.employeeId);
  const code = employee?.code || correction.employeeCode || "Deleted";
  const name = employee?.name || correction.employeeName || "Deleted employee";
  return `${code} - ${name}`;
}

function preserveEmployeeHistory(employee) {
  state.attendance.forEach((record) => {
    if (record.employeeId === employee.id) {
      record.employeeCode = record.employeeCode || employee.code;
      record.employeeName = record.employeeName || employee.name;
    }
  });
  state.corrections.forEach((correction) => {
    if (correction.employeeId === employee.id) {
      correction.employeeCode = correction.employeeCode || employee.code;
      correction.employeeName = correction.employeeName || employee.name;
    }
  });
}

function deleteEmployeeModal() {
  if (!pendingDeleteEmployeeId) return "";
  const employee = employeeById(pendingDeleteEmployeeId);
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="confirm-modal">
        <p class="eyebrow">Confirm delete</p>
        <h3>Delete ${escapeHtml(employee.code)} - ${escapeHtml(employee.name)}?</h3>
        <p>Employee access will be removed. Attendance history and reports will stay.</p>
        <div class="actions">
          <button class="secondary" data-cancel-delete>Cancel</button>
          <button class="danger" data-confirm-delete>Delete</button>
        </div>
      </section>
    </div>
  `;
}

function qrScannerModal() {
  if (!pendingScanAction) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="confirm-modal scan-modal">
        <p class="eyebrow">${pendingScanAction === "in" ? "Clock in" : "Clock out"}</p>
        <h3>Scan Warehouse QR</h3>
        <div class="camera-box">
          <video id="qr-video" playsinline muted></video>
          <div class="scan-frame" aria-hidden="true"></div>
        </div>
        <p id="qr-scan-message">Starting camera...</p>
        <div class="actions">
          <button class="secondary" data-cancel-scan>Cancel</button>
          <button class="secondary" data-toggle-torch>Torch On</button>
          <button class="secondary" data-manual-qr>${isN006CurrentUser() ? "Use Manual QR D1" : "Manual QR"}</button>
        </div>
      </section>
    </div>
  `;
}

function normalizePhone(value) {
  return value.replace(/\D/g, "");
}

function formatLiveTime(value) {
  if (!value) return "";
  const text = String(value).trim();
  if (/^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, "0");
  const date = new Date(parseLiveTimestamp(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-MY", { timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false });
}

function liveGpsLabel(row) {
  const accuracy = row.clock_out_accuracy || row.clock_in_accuracy;
  const distance = row.clock_out_distance_meters || row.clock_in_distance_meters;
  return accuracy ? `${Math.round(Number(accuracy))}m accuracy / ${Math.round(Number(distance))}m from warehouse` : "-";
}

function statusLabel(value) {
  return String(value || "-")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function leaveRequestStatusLabel(row) {
  const status = String(row?.status || "").toLowerCase();
  const note = String(row?.admin_note || "").toLowerCase();
  if (status === "cancelled" || note.includes("cancelled by employee")) return "Cancelled";
  if (status === "rejected") return "Rejected";
  return statusLabel(row?.status);
}

function leaveTypeLabel(value) {
  if (value === "leave" || value === "Annual Leave") return "Annual Leave";
  if (String(value || "").toLowerCase() === "mc") return "MC";
  return statusLabel(value);
}

function getDeviceFingerprint() {
  const existing =
    localStorage.getItem(DEVICE_KEY) ||
    sessionStorage.getItem(DEVICE_KEY) ||
    getCookie(DEVICE_COOKIE);
  if (existing) {
    localStorage.setItem(DEVICE_KEY, existing);
    sessionStorage.setItem(DEVICE_KEY, existing);
    setCookie(DEVICE_COOKIE, existing, 3650);
    return existing;
  }
  const fingerprint = stableBrowserFingerprint();
  localStorage.setItem(DEVICE_KEY, fingerprint);
  sessionStorage.setItem(DEVICE_KEY, fingerprint);
  setCookie(DEVICE_COOKIE, fingerprint, 3650);
  return fingerprint;
}

function getRegistrationDeviceFingerprint(employeeCode) {
  if (String(employeeCode || "").trim().toUpperCase() !== "N006") return getDeviceFingerprint();
  const prefix = "phone-n006-";
  const existing =
    localStorage.getItem(DEVICE_KEY) ||
    sessionStorage.getItem(DEVICE_KEY) ||
    getCookie(DEVICE_COOKIE);
  const fingerprint = existing && existing.startsWith(prefix) ? existing : createN006DeviceFingerprint(prefix);
  localStorage.setItem(DEVICE_KEY, fingerprint);
  sessionStorage.setItem(DEVICE_KEY, fingerprint);
  setCookie(DEVICE_COOKIE, fingerprint, 3650);
  return fingerprint;
}

function createN006DeviceFingerprint(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}${globalThis.crypto.randomUUID()}`;
  return `${prefix}${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserDeviceLabel() {
  return navigator.userAgentData?.platform || navigator.platform || "Mobile browser";
}

function stableBrowserFingerprint() {
  const source = [
    navigator.userAgent || "",
    navigator.platform || "",
    navigator.language || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    screen.width,
    screen.height,
    screen.colorDepth,
    navigator.hardwareConcurrency || "",
    navigator.maxTouchPoints || "",
  ].join("|");
  return `device-${simpleHash(source)}`;
}

function simpleHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function calculateOvertime(clockOut, scheduledEnd, threshold) {
  return toMinutes(clockOut) >= toMinutes(threshold) ? Math.max(0, toMinutes(clockOut) - toMinutes(scheduledEnd)) : 0;
}

function employeeHistoryOvertimeMinutes(row, display) {
  if (!display.clockOut) return 0;
  if (!display.clockIn) return Number(row.overtimeMinutes || 0);

  const day = new Date(`${row.date}T12:00:00+08:00`).getUTCDay();
  const inMinutes = toMinutes(display.clockIn);
  let outMinutes = toMinutes(display.clockOut);
  if (outMinutes < inMinutes) outMinutes += 24 * 60;
  if (outMinutes === inMinutes) return 0;

  if (day === 0) {
    if (display.breakTime && display.resumeTime) {
      return clockRangeMinutes(display.clockIn, display.breakTime) + clockRangeMinutes(display.resumeTime, display.clockOut);
    }
    return Math.max(0, outMinutes - inMinutes);
  }

  const scheduledEnd = day === 6 ? 13 * 60 : 18 * 60;
  const threshold = scheduledEnd + 16;
  const earlyOt = inMinutes < 8 * 60 ? 8 * 60 - inMinutes : 0;
  const lateOt = outMinutes >= threshold ? Math.max(0, outMinutes - Math.max(inMinutes, scheduledEnd)) : 0;
  return earlyOt + lateOt;
}

function employeeHistoryLateMinutes(row, display) {
  if (!display.clockIn) return 0;
  const day = new Date(`${row.date}T12:00:00+08:00`).getUTCDay();
  if (day === 0) return 0;
  const clockInMinutes = toMinutes(display.clockIn);
  return clockInMinutes > 9 * 60 + 10 ? clockInMinutes - 9 * 60 : 0;
}

function employeeHistoryShortMinutes(row, display, leaveRequests = []) {
  if (!display.clockIn) return 0;
  const day = new Date(`${row.date}T12:00:00+08:00`).getUTCDay();
  if (day === 0) return 0;
  const start = 9 * 60;
  const end = day === 6 ? 13 * 60 : 18 * 60;
  const requiredMinutes = day === 6 ? 240 : 480;
  const inMinutes = toMinutes(display.clockIn);
  let outMinutes = display.clockOut ? toMinutes(display.clockOut) : null;
  if (outMinutes != null && outMinutes < inMinutes) outMinutes += 24 * 60;

  let lateShort = Math.max(0, inMinutes - start);
  if (inMinutes <= start + 10) lateShort = 0;

  const actualMinutes = display.clockOut ? employeeHistoryPaidWorkMinutes(row, display) : Number(row.workingMinutes || 0);
  if (isHalfLeaveForDate(leaveRequests, row.date)) {
    const workShort = Math.max(0, 240 - employeeHistoryWorkingWindowMinutes(row, display));
    return Math.min(240, Math.max(lateShort, workShort));
  }

  const earlyOut = outMinutes != null && outMinutes < end ? Math.max(0, end - outMinutes) : 0;
  const workShort = Math.max(0, requiredMinutes - actualMinutes);
  return Math.min(requiredMinutes, Math.max(lateShort, earlyOut, workShort));
}

function employeeHistoryPaidWorkMinutes(row, display) {
  if (!display.clockIn || !display.clockOut) return 0;
  const day = new Date(`${row.date}T12:00:00+08:00`).getUTCDay();
  const elapsed = clockRangeMinutes(display.clockIn, display.clockOut);
  if (!elapsed) return 0;
  if (day === 0) return elapsed;

  const overtime = employeeHistoryOvertimeMinutes(row, display);
  const cap = day === 6 ? 240 : 480;

  if (display.breakTime && display.resumeTime) {
    const segmentTotal = clockRangeMinutes(display.clockIn, display.breakTime) + clockRangeMinutes(display.resumeTime, display.clockOut);
    return Math.min(Math.max(0, segmentTotal - overtime), cap) + overtime;
  }

  const end = day === 6 ? 13 * 60 : 18 * 60;
  const regularStart = employeeHistoryRegularWindowStartMinutes(toMinutes(display.clockIn));
  let outMinutes = toMinutes(display.clockOut);
  if (outMinutes < toMinutes(display.clockIn)) outMinutes += 24 * 60;
  const regularSpan = Math.max(0, Math.min(outMinutes, end + 15) - regularStart);
  const breakDeduction = day >= 1 && day <= 5 && regularSpan >= 300 ? 60 : 0;
  return Math.min(Math.max(0, regularSpan - breakDeduction), cap) + overtime;
}

function employeeHistoryWorkingWindowMinutes(row, display) {
  if (!display.clockIn || !display.clockOut) return 0;
  const day = new Date(`${row.date}T12:00:00+08:00`).getUTCDay();
  if (day === 0) return 0;
  const end = day === 6 ? 13 * 60 : 18 * 60;
  const inMinutes = toMinutes(display.clockIn);
  let outMinutes = toMinutes(display.clockOut);
  if (outMinutes < inMinutes) outMinutes += 24 * 60;
  const regularStart = employeeHistoryRegularWindowStartMinutes(inMinutes);
  return Math.max(0, Math.min(outMinutes, end + 15) - regularStart);
}

function employeeHistoryRegularWindowStartMinutes(inMinutes) {
  const start = 9 * 60;
  const earlyStart = 8 * 60;
  return inMinutes >= earlyStart && inMinutes <= start + 10 ? start : Math.max(inMinutes, earlyStart);
}

function isHalfLeaveForDate(leaveRequests, date) {
  const request = (leaveRequests || []).find((item) => {
    const status = String(item.status || "").toLowerCase();
    return item.date === date && status === "approved";
  });
  return String(request?.duration || "").toLowerCase().includes("half");
}

function clockRangeMinutes(start, end) {
  const startMinutes = toMinutes(start);
  let endMinutes = toMinutes(end);
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return Math.max(0, endMinutes - startMinutes);
}

function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function formatMinutes(minutes) {
  if (!minutes) return "0m";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
}

function formatOtMinutes(minutes) {
  return Number(minutes || 0) > 0 ? formatMinutes(Number(minutes)) : "-";
}

function formatReportOtMinutes(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "-";
  return `${Math.floor(value / 60)}.${String(Math.abs(value % 60)).padStart(2, "0")}`;
}

function formatLeaveDays(value) {
  const number = Number(value || 0);
  return `${Number.isInteger(number) ? number : number.toFixed(1)} day${number === 1 ? "" : "s"}`;
}

function formatDayCount(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatMetricDuration(minutes) {
  const value = Number(minutes || 0);
  if (!value) return "0min";
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return hours ? `${hours}hr ${remainder}min` : `${remainder}min`;
}

function calculatePresentDays(records, corrections = []) {
  const dates = new Set();

  records.forEach((row) => {
    const display = attendanceDisplayTimes(row, corrections);
    if (row.date && display.clockIn && display.clockOut) dates.add(row.date);
  });

  return dates.size;
}

function correctedReportBoxCount(records, corrections = []) {
  return records.reduce((total, row) => {
    const marks = attendanceEditMarks(row, corrections);
    return total + (marks.clockIn === "corrected" ? 1 : 0) + (marks.clockOut === "corrected" ? 1 : 0);
  }, 0);
}

function pendingCorrectionCount(corrections) {
  return (corrections || []).filter((correction) => correction.status === "Pending").length;
}

function localDateTimeToIso(date, time) {
  return new Date(`${date}T${time}:00+08:00`).toISOString();
}

function currentOpenRecord(records) {
  return records.find((row) => row.clockIn && !row.clockOut && isOpenRecordStillActive(row.date));
}

function isOpenRecordStillActive(workDate) {
  const today = malaysiaDateKey(new Date());
  if (workDate === today) return true;
  if (workDate !== previousDateKey(today)) return false;
  return malaysiaMinutesSinceMidnight(new Date()) < toMinutes("08:00");
}

function malaysiaDateKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function malaysiaToday() {
  const [year, month, day] = malaysiaDateKey(new Date()).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function employeeMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentEmployeeMonthKey() {
  return employeeMonthKey(malaysiaToday());
}

function previousEmployeeMonthKey() {
  return employeeMonthKey(addCalendarMonths(malaysiaToday(), -1));
}

function normalizedEmployeeMonthKey(value) {
  const allowedMonths = [previousEmployeeMonthKey(), currentEmployeeMonthKey()];
  return allowedMonths.includes(value) ? value : currentEmployeeMonthKey();
}

function monthDateFromKey(value) {
  const [year, month] = normalizedEmployeeMonthKey(value).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function malaysiaMinutesSinceMidnight(date) {
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return toMinutes(time);
}

function previousDateKey(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localTime(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function distanceMeters(fromLat, fromLng, toLat, toLng) {
  const radius = 6371000;
  const dLat = radians(toLat - fromLat);
  const dLng = radians(toLng - fromLng);
  const lat1 = radians(fromLat);
  const lat2 = radians(toLat);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function radians(value) {
  return (value * Math.PI) / 180;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function toast(text) {
  document.querySelectorAll(".message").forEach((node) => node.remove());
  const message = document.createElement("p");
  message.className = "message";
  message.textContent = text;
  document.body.append(message);
  setTimeout(() => message.remove(), 3600);
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax; Secure`;
}

function getCookie(name) {
  const item = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : "";
}

function deleteCookie(name) {
  document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax; Secure`;
}

function openEmployeeLoginDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(EMPLOYEE_LOGIN_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(EMPLOYEE_LOGIN_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB failed."));
  });
}

async function saveEmployeeTokenIndexedDb(token, expiresAt) {
  const db = await openEmployeeLoginDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(EMPLOYEE_LOGIN_STORE, "readwrite");
    tx.objectStore(EMPLOYEE_LOGIN_STORE).put({ token, expiresAt }, "employee");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function restoreEmployeeTokenIndexedDb() {
  const db = await openEmployeeLoginDb();
  const record = await new Promise((resolve, reject) => {
    const tx = db.transaction(EMPLOYEE_LOGIN_STORE, "readonly");
    const request = tx.objectStore(EMPLOYEE_LOGIN_STORE).get("employee");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  if (!record?.token) return false;
  saveEmployeeToken(record.token, record.expiresAt || "");
  return true;
}

async function clearEmployeeTokenIndexedDb() {
  const db = await openEmployeeLoginDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(EMPLOYEE_LOGIN_STORE, "readwrite");
    tx.objectStore(EMPLOYEE_LOGIN_STORE).delete("employee");
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

setInterval(() => {
  if (state.currentUser && employeeToken() && !document.hidden) {
    loadEmployeeLive(true, true);
  }
}, 3000);

window.addEventListener("focus", () => {
  refreshEmployeeAppVersion();
  if (state.currentUser && employeeToken()) {
    loadEmployeeLive(true, true);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    refreshEmployeeAppVersion();
    if (state.currentUser && employeeToken()) loadEmployeeLive(true, true);
  }
});

setInterval(refreshEmployeeAppVersion, APP_VERSION_CHECK_MS);
refreshEmployeeAppVersion();

async function bootEmployeeApp() {
  if (!employeeToken()) {
    await restoreEmployeeTokenIndexedDb().catch(() => false);
  }
  if (employeeToken()) {
    document.querySelector("#app").innerHTML = loadingScreen();
    await loadEmployeeLive(true);
    if (state.currentUser) {
      render();
      return;
    }
  }
  render();
}

bootEmployeeApp();
