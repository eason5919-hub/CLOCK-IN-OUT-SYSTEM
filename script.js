const STORAGE_KEY = "warehouse-attendance-static-v2";
const DEVICE_KEY = "warehouse-device-fingerprint";
const DEVICE_COOKIE = "warehouseDeviceFingerprint";
const EMPLOYEE_TOKEN_KEY = "warehouse-live-employee-token";
const EMPLOYEE_TOKEN_EXPIRY_KEY = "warehouse-live-employee-token-expiry";
const EMPLOYEE_TOKEN_COOKIE = "warehouseEmployeeToken";
const EMPLOYEE_TOKEN_EXPIRY_COOKIE = "warehouseEmployeeTokenExpiry";
const EMPLOYEE_LOGIN_DB = "warehouse-employee-login";
const EMPLOYEE_LOGIN_STORE = "tokens";
const API_BASE = "https://warehouse-attendance-management.eason5919-hub.workers.dev";
const WAREHOUSE = {
  name: "Main Warehouse",
  lat: 2.9850965,
  lng: 101.7700882,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};
const MAX_GPS_ACCURACY_METERS = 30;

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
let gpsWatchId = null;
let latestGpsSamples = [];

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
  const leaveRemaining = formatLeaveDays(state.currentUser.leaveRemainingDays || 0);
  const leaveDefaultDate = defaultLeaveDate();
  const openRecord = currentOpenRecord(records);
  const clockAction = openRecord ? "out" : "in";
  const clockLabel = openRecord ? "Clock out" : "Clock in";
  const clockHint = openRecord
    ? `Clocked in at ${escapeHtml(openRecord.clockIn)}. Scan the QR again to clock out.`
    : "Scan the warehouse QR to clock in.";
  const stats = {
    present: formatDayCount(calculatePresentDays(records, leaveRequests)),
    late: records.filter((row) => row.lateMinutes > 0).length,
    ot: records.reduce((total, row) => total + row.overtimeMinutes, 0),
    corrections: corrections.length,
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
          ["Late records", stats.late, "amber"],
          ["OT minutes", stats.ot, "blue"],
          ["Corrections", stats.corrections, "red"],
        ])}
      </section>
      <section class="panel" id="month">
        <div class="heading"><div><p class="eyebrow">Current month</p><h3>August 2026</h3></div></div>
        <div class="calendar">${calendar(records)}</div>
      </section>
      <section class="panel wide" id="history">
        <div class="heading"><div><p class="eyebrow">Clock history</p><h3>My attendance</h3></div></div>
        ${attendanceTable(records, true)}
      </section>
      <section class="panel" id="corrections">
        <div class="heading"><div><p class="eyebrow">Forgotten clock</p><h3>Correction request</h3></div></div>
        <form class="form" id="correction-form">
          <label>Date<input name="date" type="date" value="${malaysiaDateKey(new Date())}" required /></label>
          <label>Missing<select name="missing"><option>Clock In</option><option selected>Clock Out</option><option>Both</option></select></label>
          <label>Requested time<input name="time" type="time" required /></label>
          <label>Reason<textarea name="reason" rows="3" required></textarea></label>
          <button>Submit Request</button>
        </form>
        <div class="list" style="margin-top:14px">${corrections.map(correctionCard).join("") || `<small>No correction requests.</small>`}</div>
      </section>
      <section class="panel" id="leave">
        <div class="heading">
          <div><p class="eyebrow">Apply Annual Leave/MC</p><h3>Annual leave remaining: ${leaveRemaining}</h3></div>
        </div>
        <form class="form" id="leave-form">
          <label>Type<select name="leaveType"><option value="leave">Annual Leave</option><option value="mc">MC</option></select></label>
          <div class="field">
            <span>Date</span>
            <input name="date" type="hidden" value="${leaveDefaultDate}" required />
            <button class="date-picker-button" type="button" data-open-leave-calendar>
              <span data-selected-leave-date>${formatLeaveDateDisplay(leaveDefaultDate)}</span>
            </button>
            <div class="leave-calendar" data-leave-calendar hidden></div>
          </div>
          <label>Duration<select name="duration"><option value="full_day">Full day</option><option value="half_day">Half day</option></select><small class="muted" data-leave-rule></small></label>
          <label>Reason<textarea name="reason" rows="3" placeholder="Optional"></textarea></label>
          <button>Submit Annual Leave/MC</button>
        </form>
        <div class="list" style="margin-top:14px">${leaveRequests.map(leaveRequestCard).join("") || `<small>No Annual Leave/MC requests.</small>`}</div>
      </section>
    </div>
    ${qrScannerModal()}
  `;
}

function adminScreen() {
  const pending = state.corrections.filter((row) => row.status === "Pending");
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
          <button class="secondary" id="export-csv">Export CSV</button>
        </div>
        ${attendanceTable(state.attendance, false)}
      </section>
      <section class="panel wide" id="corrections">
        <div class="heading"><div><p class="eyebrow">Corrections</p><h3>Approval queue</h3></div></div>
        <div class="list">${state.corrections.map(adminCorrectionCard).join("") || `<small>No correction requests.</small>`}</div>
      </section>
      <section class="panel wide" id="reports">
        <div class="heading"><div><p class="eyebrow">Working hours</p><h3>OT rules</h3></div></div>
        <p>Start time 09:00. Clock in until 09:15 is normal; 09:16 is late 16m. Clock in before 08:00 counts as early OT.</p>
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
          deviceFingerprint: getDeviceFingerprint(),
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

async function loadEmployeeLive(force = false) {
  if (!employeeToken() || (liveRefreshInFlight && !force)) return;
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
  } catch (error) {
    if (error.status === 401 || error.status === 403 || error.status === 404) {
      clearEmployeeSession(error.message || "Employee account was deleted by HR.");
    } else {
      toast(error.message || "Unable to refresh attendance. Login is kept on this phone.");
    }
  } finally {
    liveRefreshInFlight = false;
  }
}

async function liveApi(path, options = {}, requireToken = true) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = employeeToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  headers["X-Device-Fingerprint"] = getDeviceFingerprint();
  if (requireToken && !token) throw new Error("Employee login is required.");

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
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    employeeCode: state.currentUser?.label,
    employeeName: state.currentUser?.name,
    date: row.work_date,
    clockIn: formatLiveTime(row.clock_in_at),
    clockOut: formatLiveTime(row.clock_out_at),
    workingMinutes: Number(row.total_minutes || 0),
    lateMinutes: Number(row.late_minutes || 0),
    earlyLeaveMinutes: Number(row.early_leave_minutes || 0),
    overtimeMinutes: Number(row.overtime_minutes || 0),
    status: statusLabel(row.status),
    gps: liveGpsLabel(row),
  };
}

function mapLiveCorrection(row) {
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    employeeCode: state.currentUser?.label,
    employeeName: state.currentUser?.name,
    date: row.requested_date,
    missing: statusLabel(row.missing_type),
    requestedTime: formatLiveTime(row.requested_clock_out_at || row.requested_clock_in_at),
    reason: row.reason,
    status: statusLabel(row.status),
  };
}

function mapLiveLeaveRequest(row) {
  return {
    id: row.id,
    employeeId: state.currentUser?.employeeId,
    date: row.leave_date,
    type: leaveTypeLabel(row.leave_type),
    duration: statusLabel(row.duration),
    reason: row.reason || "",
    status: statusLabel(row.status),
  };
}

function bindEmployee() {
  bindShell();
  document.querySelectorAll("[data-clock]").forEach((button) => {
    button.addEventListener("click", () => openQrScanner(button.dataset.clock));
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
  document.querySelector("[data-cancel-scan]")?.addEventListener("click", closeQrScanner);
  document.querySelector("[data-manual-qr]")?.addEventListener("click", () => {
    const qr = prompt("Enter the warehouse QR code shown by HR");
    if (qr) completeQrScan(qr.trim());
  });
  if (pendingScanAction) startQrScanner();
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
          missingType: missing === "Clock In" ? "clock_in" : missing === "Clock Out" ? "clock_out" : "both",
          requestedClockInAt: missing !== "Clock Out" ? localDateTimeToIso(requestedDate, requestedTime) : null,
          requestedClockOutAt: missing !== "Clock In" ? localDateTimeToIso(requestedDate, requestedTime) : null,
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
    const leaveDate = String(data.get("date"));
    const duration = String(data.get("duration"));
    const reason = String(data.get("reason")).trim();
    const validation = validateLeaveDateAndDuration(leaveDate, duration);
    if (validation) {
      toast(validation);
      updateLeaveDurationRule(form);
      return;
    }
    const tempId = `leave-pending-${Date.now()}`;

    state.leaveRequests = [
      {
        id: tempId,
        employeeId: state.currentUser.employeeId,
        date: leaveDate,
        type: leaveTypeLabel(leaveType),
        duration: statusLabel(duration),
        reason,
        status: "Pending",
      },
      ...(state.leaveRequests || []),
    ];
    saveState();
    form.reset();
    render();
    toast("Annual Leave/MC submitted");

    try {
      const result = await liveApi("/api/leave-requests", {
        method: "POST",
        body: JSON.stringify({
          employeeId: state.currentUser.employeeId,
          leaveType,
          leaveDate,
          duration,
          reason,
        }),
      });
      state.leaveRequests = (state.leaveRequests || []).map((request) =>
        request.id === tempId ? { ...request, id: result.leaveRequestId || tempId } : request,
      );
      saveState();
      render();
      loadEmployeeLive(true).catch(() => {});
    } catch (error) {
      state.leaveRequests = (state.leaveRequests || []).filter((request) => request.id !== tempId);
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
  stopQrScanner();
  pendingScanAction = null;
  render();
  await clock(action, qr);
}

async function startQrScanner() {
  const video = document.querySelector("#qr-video");
  const message = document.querySelector("#qr-scan-message");
  if (!video || !message || qrScanController?.active) return;

  if (!navigator.mediaDevices?.getUserMedia || (!("BarcodeDetector" in window) && !window.jsQR)) {
    message.textContent = "This browser cannot scan QR by camera. Use Manual QR.";
    return;
  }

  try {
    const detector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    qrScanController = { active: true, stream };
    video.srcObject = stream;
    await video.play();
    message.textContent = "Point the camera at the warehouse QR code.";

    const scan = async () => {
      if (!qrScanController?.active) return;
      try {
        const qr = await detectQrCode(video, detector, canvas, context);
        if (qr) {
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

async function detectQrCode(video, detector, canvas, context) {
  if (detector) {
    const codes = await detector.detect(video);
    return codes[0]?.rawValue || "";
  }
  if (!window.jsQR || !context || video.readyState < 2) return "";
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return window.jsQR(image.data, image.width, image.height)?.data || "";
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
  if (qr !== WAREHOUSE.qr) {
    scanner.className = "scanner rejected";
    message.textContent = "Invalid warehouse QR code.";
    return;
  }
  message.textContent = "Verifying warehouse GPS location...";
  const samples = await collectGpsSamples();
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
    message.textContent = `Attendance accepted. GPS ${Math.round(result.accuracy)}m accuracy, ${Math.round(result.distance)}m from warehouse.`;
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

function calendar(records) {
  return Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    const record = records.find((row) => row.date === date);
    return `<div class="day ${(record?.status || "").toLowerCase()}"><span>${day}</span><small>${record?.status || "-"}</small></div>`;
  }).join("");
}

function attendanceTable(records, employeeOnly) {
  if (!records.length) {
    return `<div class="empty-state">
      <strong>No attendance records yet.</strong>
      <small>${employeeOnly ? "Clock in/out first, then records will appear here." : "GitHub Pages stores attendance inside each phone/browser. Records from employee phones will not appear on this HR browser unless this app uses an online database."}</small>
    </div>`;
  }

  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${employeeOnly ? "" : "<th>Employee</th>"}<th>Date</th><th>Clock In</th><th>Clock Out</th><th>Working Hours</th><th>OT</th><th>Status</th><th>GPS</th></tr></thead>
        <tbody>${records
          .map((row) => {
            return `<tr>${employeeOnly ? "" : `<td>${escapeHtml(employeeLabel(row))}</td>`}<td>${row.date}</td><td>${row.clockIn || "-"}</td><td>${row.clockOut || "-"}</td><td>${formatMinutes(row.workingMinutes)}</td><td>${formatOtMinutes(row.overtimeMinutes)}</td><td><span class="badge ${row.status.toLowerCase()}">${row.status}</span></td><td>${row.gps || "-"}</td></tr>`;
          })
          .join("")}</tbody>
      </table>
    </div>`;
}

function employeeCard(employee) {
  return `<div class="list-item employee-row"><strong>${employee.code} - ${escapeHtml(employee.name)}</strong><span class="badge ${employee.deviceStatus.toLowerCase().replaceAll(" ", "-")}">${employee.deviceStatus}</span><button class="danger" data-delete-employee="${employee.id}">Delete</button><small>${escapeHtml(employee.deviceModel)}</small></div>`;
}

function correctionCard(correction) {
  return `<div class="list-item"><strong>${correction.date} - ${correction.missing}</strong><span>${escapeHtml(correction.reason)}</span><span class="badge ${correction.status.toLowerCase()}">${correction.status}</span></div>`;
}

function leaveRequestCard(request) {
  const canCancel = !["Rejected", "Cancelled"].includes(request.status) && request.date >= malaysiaDateKey(new Date());
  return `<div class="list-item leave-card"><div><strong>${request.date} - ${request.type}</strong><span>${request.duration}${request.reason ? ` | ${escapeHtml(request.reason)}` : ""}</span></div><div class="actions"><span class="badge ${request.status.toLowerCase()}">${request.status}</span>${canCancel ? `<button class="secondary" type="button" data-cancel-leave="${request.id}">Cancel</button>` : ""}</div></div>`;
}

function updateLeaveDurationRule(form) {
  const dateInput = form.querySelector('input[name="date"]');
  const durationSelect = form.querySelector('select[name="duration"]');
  const rule = form.querySelector("[data-leave-rule]");
  if (!dateInput || !durationSelect || !rule) return;

  const day = leaveDateDayOfWeek(dateInput.value);
  durationSelect.querySelector('option[value="full_day"]').disabled = day === 6;
  if (day === 6) durationSelect.value = "half_day";
  rule.textContent =
    day === 0
      ? "Sunday cannot be selected."
      : day === 6
        ? "Saturday is half day only."
        : "";
}

function setupLeaveCalendar(form) {
  const dateInput = form.querySelector('input[name="date"]');
  const button = form.querySelector("[data-open-leave-calendar]");
  const label = form.querySelector("[data-selected-leave-date]");
  const calendar = form.querySelector("[data-leave-calendar]");
  if (!dateInput || !button || !label || !calendar) return;

  const refresh = () => {
    label.textContent = formatLeaveDateDisplay(dateInput.value);
    calendar.innerHTML = leaveCalendarMarkup(dateInput.value, calendar.dataset.month || dateInput.value);
    updateLeaveDurationRule(form);
  };

  button.addEventListener("click", () => {
    calendar.hidden = !calendar.hidden;
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
    dateInput.value = dayButton.dataset.calendarDate;
    calendar.dataset.month = dateInput.value;
    calendar.hidden = true;
    refresh();
  });

  refresh();
}

function validateLeaveDateAndDuration(date, duration) {
  if (!date) return "Select Annual Leave/MC date.";
  if (date < malaysiaDateKey(new Date())) return "Past dates cannot be selected for Annual Leave/MC.";
  const day = leaveDateDayOfWeek(date);
  if (day === 0) return "Annual Leave/MC cannot be selected on Sunday.";
  if (day === 6 && duration !== "half_day") return "Saturday Annual Leave/MC can only be half day.";
  return "";
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

function leaveCalendarMarkup(selectedDate, monthValue) {
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
    const classes = ["calendar-day", isSunday ? "is-sunday" : "", isPast ? "is-past" : "", isDisabled ? "is-disabled" : "", dateKey === selectedDate ? "is-selected" : ""]
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
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day || 1));
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
  for (let i = samples.length; i < 5; i += 1) {
    samples.push(await getGpsSample(i));
    await wait(250);
  }
  return samples.sort((a, b) => a.accuracy - b.accuracy).slice(0, 5);
}

function getGpsSample(index) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(fallbackGps(index));
    navigator.geolocation.getCurrentPosition(
      (position) => resolve(saveGpsSample(position)),
      () => resolve(fallbackGps(index)),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
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
        message.textContent = `GPS ready. Accuracy ${Math.round(sample.accuracy)}m.`;
      }
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
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
  const sample = {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.round(position.coords.accuracy),
    timestamp: Date.now(),
    source: "browser",
  };
  latestGpsSamples.push(sample);
  latestGpsSamples = latestGpsSamples.filter((item) => Date.now() - item.timestamp < 30000).slice(-10);
  return sample;
}

function recentGpsSamples() {
  return latestGpsSamples.filter((sample) => Date.now() - sample.timestamp < 30000);
}

function fallbackGps(index) {
  return {
    latitude: WAREHOUSE.lat + index * 0.00001,
    longitude: WAREHOUSE.lng + index * 0.00001,
    accuracy: [24, 18, 12, 16, 9][index] || 18,
    source: "fallback",
  };
}

function exportCsv() {
  const rows = [
    ["Employee", "Date", "Clock In", "Clock Out", "Working Minutes", "OT Minutes", "Status"],
    ...state.attendance.map((row) => {
      return [employeeLabel(row), row.date, row.clockIn || "", row.clockOut || "", row.workingMinutes, row.overtimeMinutes, row.status];
    }),
  ];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "attendance-report.csv";
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
          <button class="secondary" data-manual-qr>Manual QR</button>
        </div>
      </section>
    </div>
  `;
}

function normalizePhone(value) {
  return value.replace(/\D/g, "");
}

function formatLiveTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16);
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

function leaveTypeLabel(value) {
  return value === "leave" || value === "Annual Leave" ? "Annual Leave" : statusLabel(value);
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

function formatLeaveDays(value) {
  const number = Number(value || 0);
  return `${Number.isInteger(number) ? number : number.toFixed(1)} day${number === 1 ? "" : "s"}`;
}

function formatDayCount(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function calculatePresentDays(records, leaveRequests) {
  const dayValues = new Map();

  records
    .filter((row) => row.date && row.status !== "Absent")
    .forEach((row) => {
      dayValues.set(row.date, Math.max(dayValues.get(row.date) || 0, 1));
    });

  return [...dayValues.values()].reduce((total, value) => total + value, 0);
}

function localDateTimeToIso(date, time) {
  return new Date(`${date}T${time}:00`).toISOString();
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
    loadEmployeeLive(true);
  }
}, 3000);

window.addEventListener("focus", () => {
  if (state.currentUser && employeeToken()) {
    loadEmployeeLive(true);
  }
});

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
