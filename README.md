# Warehouse Attendance Management

A cloud-ready attendance system for warehouse teams. Employees, HR, and owners sign in through the same app, and server-side sessions keep employees limited to their own attendance records.

Live app: https://warehouse-attendance-management.eason5919-hub.workers.dev

GitHub Pages app: https://eason5919-hub.github.io/CLOCK-IN-OUT-SYSTEM/ redirects to the live app.

This repository also contains the earlier full-stack source folders. The GitHub Pages version runs from `index.html`, `style.css`, `script.js`, and `manifest.json`.

## Included

- Employee mobile app for official-phone registration, QR/GPS clocking, history, OT, and correction requests.
- HR/Owner dashboard for employee records, registered devices, attendance, reports, and corrections.
- Employee phone clock in/out flow using permanent warehouse QR validation plus GPS sampling.
- Device registration lock: one employee account can be linked to one official device.
- Editable working schedule model with default warehouse hours.
- Automatic attendance fields for working minutes, late minutes, early leave, and overtime.
- OT grace rules: weekdays count only after 18:15 and Saturdays only after 13:15, but approved OT minutes are calculated from the scheduled end time.
- Employee correction requests for forgotten clock in/out.
- Reports for attendance, OT, late, absent, with CSV and printable HTML export endpoints.
- D1 database schema and migrations for users, employees, devices, attendance, corrections, QR codes, schedules, departments, settings, audit logs, and warehouses.


## Local Use

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verification

```bash
npm test
npm run lint
```

## Key API Routes

- `POST /api/attendance/clock`
- `POST /api/corrections`
- `PATCH /api/corrections`
- `PATCH /api/admin/attendance`
- `GET /api/reports/export?format=excel&month=2026-08`
- `GET /api/reports/export?format=pdf&month=2026-08`
