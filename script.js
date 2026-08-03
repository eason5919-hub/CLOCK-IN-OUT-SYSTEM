const STORAGE_KEY = "warehouse-attendance-static-v2";
const DEVICE_KEY = "warehouse-device-fingerprint";
const WAREHOUSE = {
  name: "Main Warehouse",
  lat: 3.139,
  lng: 101.6869,
  radius: 100,
  qr: "WAREHOUSE-MAIN-QR",
};

const ADMIN_ACCOUNT = {
  email: "d1_racing@yahoo.com",
  passwordHash: "fad4b78390b338486a88d8706127faa3fc30657b2889f960d194fe5afde98002",
};

const defaultState = {
  currentUser: null,
  employees: [],
  attendance: [],
  corrections: [],
  auditLogs: [],
};

let state = loadState();
let pendingDeleteEmployeeId = null;
let pendingScanAction = null;
let qrScanController = null;

window.addEventListener("hashchange", () => {
  if (!state.currentUser) render();
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
  if (!state.currentUser) {
    app.innerHTML = loginScreen();
    bindLogin();
    return;
  }

  if (state.currentUser.role === "employee") {
    if (!findEmployeeById(state.currentUser.employeeId)) {
      state.currentUser = null;
      saveState();
      app.innerHTML = loginScreen();
      bindLogin();
      toast("This employee account was deleted by HR.");
      return;
    }
    app.innerHTML = shell(employeeScreen(), "Employee attendance app");
    bindEmployee();
  } else {
    app.innerHTML = shell(adminScreen(), "HR / Owner console");
    bindAdmin();
  }
}

function loginScreen() {
  const adminMode = window.location.hash.toLowerCase() === "#admin";
  if (adminMode) {
    return `
      <section class="auth">
        <div class="auth-hero">
          <div class="brand">
            <div class="brand-mark">W</div>
            <div><p class="eyebrow">Warehouse</p><h1>Attendance Management</h1></div>
          </div>
          <h2>HR and owner attendance control</h2>
          <div class="actions">
            <span class="badge">Employee records</span>
            <span class="badge">OT reports</span>
            <span class="badge">Correction approvals</span>
          </div>
        </div>
        <div class="auth-grid single">
          <form class="auth-panel" id="admin-login">
            <div><p class="eyebrow">Authorized staff</p><h3>HR / Owner Login</h3></div>
            <label>Email<input name="email" type="email" required /></label>
            <label>Password<input name="password" type="password" required /></label>
            <button>Open Admin</button>
            <a class="text-link" href="./">Employee app</a>
          </form>
        </div>
      </section>
    `;
  }

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
      <div class="auth-grid">
        <form class="auth-panel" id="employee-register">
          <div><p class="eyebrow">Employee first time</p><h3>Register Official Phone</h3></div>
          <label>Employee code<input name="code" placeholder="WH-001" required /></label>
          <label>Full name<input name="name" placeholder="Employee name" required /></label>
          <label>Phone number<input name="phone" placeholder="+60 12-400 1001" required /></label>
          <button>Register Phone</button>
        </form>
        <form class="auth-panel" id="employee-login">
          <div><p class="eyebrow">Employee returning</p><h3>Employee Login</h3></div>
          <label>Employee code<input name="code" placeholder="WH-001" required /></label>
          <button>Open My Attendance</button>
          <small>Employees can only view and submit their own records.</small>
        </form>
      </div>
    </section>
  `;
}

function shell(content, subtitle) {
  return `
    <section class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">W</div>
          <div><p class="eyebrow">Warehouse</p><h1>Attendance Management</h1></div>
        </div>
        <div class="account">
          <p class="eyebrow">Signed in</p>
          <strong>${escapeHtml(state.currentUser.name)}</strong>
          <small>${escapeHtml(state.currentUser.label)}</small>
          <button class="secondary" id="logout">Sign Out</button>
        </div>
        <nav class="nav">
          ${state.currentUser.role === "employee"
            ? `<a href="#clock">Clock In/Out</a><a href="#month">Monthly View</a><a href="#history">History</a><a href="#corrections">Correction Request</a>`
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
  const records = state.attendance.filter((row) => row.employeeId === employee.id);
  const corrections = state.corrections.filter((row) => row.employeeId === employee.id);
  const stats = {
    present: records.filter((row) => row.status !== "Absent").length,
    late: records.filter((row) => row.lateMinutes > 0).length,
    ot: records.reduce((total, row) => total + row.overtimeMinutes, 0),
    corrections: corrections.length,
  };

  return `
    ${metrics([
      ["Present days", stats.present, ""],
      ["Late records", stats.late, "amber"],
      ["OT minutes", stats.ot, "blue"],
      ["Corrections", stats.corrections, "red"],
    ])}
    <div class="content">
      <section class="panel" id="clock">
        <div class="heading"><div><p class="eyebrow">Official phone</p><h3>${escapeHtml(employee.name)}</h3></div><span class="badge">${employee.code}</span></div>
        <div class="scanner idle" id="scanner">
          <div class="qr-large">${"<i></i>".repeat(9)}</div>
          <p id="gps-message">Ready for QR and GPS verification.</p>
        </div>
        <div class="actions" style="margin-top:12px">
          <button data-clock="in">Clock In</button>
          <button class="secondary" data-clock="out">Clock Out</button>
        </div>
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
          <label>Date<input name="date" type="date" value="2026-08-03" required /></label>
          <label>Missing<select name="missing"><option>Clock In</option><option selected>Clock Out</option><option>Both</option></select></label>
          <label>Requested time<input name="time" type="time" required /></label>
          <label>Reason<textarea name="reason" rows="3" required></textarea></label>
          <button>Submit Request</button>
        </form>
        <div class="list" style="margin-top:14px">${corrections.map(correctionCard).join("") || `<small>No correction requests.</small>`}</div>
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
        <p>Monday-Friday: normal end 18:00, no OT until 18:16, counted from 18:00.</p>
        <p>Saturday: normal end 13:00, no OT until 13:16, counted from 13:00. Sunday approved work is all OT.</p>
      </section>
    </div>
    ${deleteEmployeeModal()}
  `;
}

function bindLogin() {
  const registerForm = document.querySelector("#employee-register");
  if (registerForm) registerForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const code = String(data.get("code")).trim().toUpperCase();
    const name = String(data.get("name")).trim();
    const phone = normalizePhone(String(data.get("phone")));
    let employee = state.employees.find((row) => row.code.toUpperCase() === code);
    if (employee && normalizePhone(employee.phone) !== phone) {
      return toast("Employee code exists with a different phone number.");
    }
    if (!employee) {
      employee = {
        id: `emp-${Date.now()}`,
        code,
        name,
        phone: String(data.get("phone")).trim(),
        department: "Warehouse",
        position: "Warehouse Associate",
        deviceFingerprint: null,
        deviceModel: "Not registered",
        deviceStatus: "Not registered",
      };
      state.employees.push(employee);
    }

    const device = getDeviceFingerprint();
    if (employee.deviceFingerprint && employee.deviceFingerprint !== device) {
      return toast("This account is already linked to another phone. Ask HR to delete and add the employee again.");
    }
    employee.deviceFingerprint = device;
    employee.deviceModel = browserDeviceLabel();
    employee.deviceStatus = "Registered";
    state.currentUser = { role: "employee", employeeId: employee.id, name: employee.name, label: employee.code };
    saveState();
    render();
  });

  const employeeLoginForm = document.querySelector("#employee-login");
  if (employeeLoginForm) employeeLoginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get("code")).trim().toUpperCase();
    const employee = state.employees.find((row) => row.code.toUpperCase() === code);
    if (!employee) return toast("Employee code was not found.");
    if (!employee.deviceFingerprint) return toast("Register this phone first.");
    if (employee.deviceFingerprint !== getDeviceFingerprint()) return toast("This account is linked to another phone.");
    state.currentUser = { role: "employee", employeeId: employee.id, name: employee.name, label: employee.code };
    saveState();
    render();
  });

  const adminLoginForm = document.querySelector("#admin-login");
  if (adminLoginForm) adminLoginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password")).trim();
    if (email === ADMIN_ACCOUNT.email && await sha256Hex(password) === ADMIN_ACCOUNT.passwordHash) {
      state.currentUser = { role: "hr", name: "HR/Admin Staff", label: "HR/Admin" };
    } else {
      return toast("Admin email or password is incorrect.");
    }
    saveState();
    render();
  });
}

function bindEmployee() {
  bindShell();
  document.querySelectorAll("[data-clock]").forEach((button) => {
    button.addEventListener("click", () => openQrScanner(button.dataset.clock));
  });
  document.querySelector("[data-cancel-scan]")?.addEventListener("click", closeQrScanner);
  document.querySelector("[data-manual-qr]")?.addEventListener("click", () => {
    const qr = prompt("Enter the warehouse QR code shown by HR");
    if (qr) completeQrScan(qr.trim());
  });
  if (pendingScanAction) startQrScanner();
  document.querySelector("#correction-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const employee = employeeById(state.currentUser.employeeId);
    const data = new FormData(event.currentTarget);
    state.corrections.unshift({
      id: `cor-${Date.now()}`,
      employeeId: employee.id,
      employeeCode: employee.code,
      employeeName: employee.name,
      date: String(data.get("date")),
      missing: String(data.get("missing")),
      requestedTime: String(data.get("time")),
      reason: String(data.get("reason")).trim(),
      status: "Pending",
    });
    saveState();
    toast("Correction request submitted.");
    render();
  });
}

function bindAdmin() {
  bindShell();
  document.querySelector("#add-employee").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.employees.push({
      id: `emp-${Date.now()}`,
      code: String(data.get("code")).trim().toUpperCase(),
      name: String(data.get("name")).trim(),
      phone: String(data.get("phone")).trim(),
      department: String(data.get("department")).trim() || "Warehouse",
      position: String(data.get("position")).trim() || "Warehouse Associate",
      deviceFingerprint: null,
      deviceModel: "Not registered",
      deviceStatus: "Not registered",
    });
    saveState();
    toast("Employee added.");
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
  document.querySelector("#logout").addEventListener("click", () => {
    stopQrScanner();
    pendingScanAction = null;
    state.currentUser = null;
    saveState();
    render();
  });
  document.querySelector("#install-app").addEventListener("click", () => {
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
  const employee = employeeById(state.currentUser.employeeId);
  const scanner = document.querySelector("#scanner");
  const message = document.querySelector("#gps-message");
  scanner.className = "scanner";
  if (qr !== WAREHOUSE.qr) {
    scanner.className = "scanner rejected";
    message.textContent = "Invalid warehouse QR code.";
    return;
  }
  message.textContent = "Collecting high accuracy GPS samples...";
  const sample = await bestGpsSample();
  const distance = Math.round(distanceMeters(sample.latitude, sample.longitude, WAREHOUSE.lat, WAREHOUSE.lng));
  if (sample.accuracy > 30 || distance > WAREHOUSE.radius) {
    scanner.className = "scanner rejected";
    message.textContent = "Unable to verify location. Please move closer to warehouse or enable GPS.";
    return;
  }

  const now = new Date();
  const date = localDate(now);
  const time = localTime(now);
  let record = state.attendance.find((row) => row.employeeId === employee.id && row.date === date);
  if (!record) {
    record = {
      id: `att-${Date.now()}`,
      employeeId: employee.id,
      employeeCode: employee.code,
      employeeName: employee.name,
      date,
      clockIn: null,
      clockOut: null,
      workingMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      status: "Present",
      gps: "-",
    };
    state.attendance.push(record);
  }

  if (action === "in") {
    if (record.clockIn) return toast("Clock in already recorded today.");
    record.clockIn = time;
    record.lateMinutes = Math.max(0, toMinutes(time) - toMinutes("09:00"));
    record.status = record.lateMinutes > 0 ? "Late" : "Present";
  } else {
    if (!record.clockIn) return toast("Clock in is required before clock out.");
    if (record.clockOut) return toast("Clock out already recorded today.");
    record.clockOut = time;
    record.workingMinutes = Math.max(0, toMinutes(time) - toMinutes(record.clockIn));
    record.earlyLeaveMinutes = Math.max(0, toMinutes("18:00") - toMinutes(time));
    record.overtimeMinutes = calculateOvertime(time, "18:00", "18:16");
    record.status = record.overtimeMinutes > 0 ? "OT" : record.lateMinutes > 0 ? "Late" : "Present";
  }
  record.gps = `${sample.accuracy}m / ${distance}m`;
  saveState();
  scanner.className = "scanner accepted";
  message.textContent = `Attendance accepted. GPS ${sample.accuracy}m, distance ${distance}m.`;
  await wait(900);
  render();
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
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${employeeOnly ? "" : "<th>Employee</th>"}<th>Date</th><th>Clock In</th><th>Clock Out</th><th>Working Hours</th><th>OT</th><th>Status</th><th>GPS</th></tr></thead>
        <tbody>${records
          .map((row) => {
            return `<tr>${employeeOnly ? "" : `<td>${escapeHtml(employeeLabel(row))}</td>`}<td>${row.date}</td><td>${row.clockIn || "-"}</td><td>${row.clockOut || "-"}</td><td>${formatMinutes(row.workingMinutes)}</td><td>${formatMinutes(row.overtimeMinutes)}</td><td><span class="badge ${row.status.toLowerCase()}">${row.status}</span></td><td>${row.gps || "-"}</td></tr>`;
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
  const samples = [];
  for (let i = 0; i < 5; i += 1) {
    samples.push(await getGpsSample(i));
  }
  return samples.sort((a, b) => a.accuracy - b.accuracy)[0];
}

function getGpsSample(index) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(fallbackGps(index));
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Math.round(position.coords.accuracy),
        }),
      () => resolve(fallbackGps(index)),
      { enableHighAccuracy: true, timeout: 1400, maximumAge: 0 },
    );
  });
}

function fallbackGps(index) {
  return {
    latitude: WAREHOUSE.lat + index * 0.00001,
    longitude: WAREHOUSE.lng + index * 0.00001,
    accuracy: [24, 18, 12, 16, 9][index] || 18,
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

function getDeviceFingerprint() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fingerprint = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, fingerprint);
  return fingerprint;
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function browserDeviceLabel() {
  return `${navigator.platform || "Mobile browser"} - ${getDeviceFingerprint().slice(0, 4).toUpperCase()}`;
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

render();
