# Warehouse Attendance Management

A cloud-ready attendance management system for warehouse teams. The app supports Owner/Admin, HR/Admin Staff, and Employee surfaces from one responsive React interface, with Cloudflare D1 persistence for production data.

## Included

- Role-based dashboards for Owner/Admin, HR/Admin Staff, and Employee users.
- Employee phone clock in/out flow using permanent warehouse QR validation plus GPS sampling.
- Device registration lock: one employee account can be linked to one official device.
- Admin device reset workflow.
- Editable working schedule model with default warehouse hours.
- Automatic attendance fields for working minutes, late minutes, early leave, and overtime.
- OT grace rules: weekdays count only after 18:15 and Saturdays only after 13:15, but approved OT minutes are calculated from the scheduled end time.
- Employee correction requests with HR approval and audit trail.
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
