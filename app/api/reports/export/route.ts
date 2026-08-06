import { ensureDatabase, getD1 } from "../../../../db/runtime";
import { reconcileAttendanceRows, type AttendanceRow } from "../../../../db/attendance-reconciliation";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "excel";
    const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

    const db = getD1();
    await ensureDatabase(db);
    const rows = await db
      .prepare(
        `SELECT a.*, e.employee_code, e.full_name
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.work_date LIKE ? AND a.source <> 'admin_report_edit_archived'
         ORDER BY a.work_date, e.employee_code, a.clock_in_at, a.updated_at`,
      )
      .bind(`${month}%`)
      .all<Record<string, unknown>>();

    const reportRows = reconcileAttendanceRows((rows.results ?? []) as AttendanceRow[])
      .sort((left, right) => {
        const dateOrder = String(left.work_date || "").localeCompare(String(right.work_date || ""));
        return dateOrder || String(left.employee_code || "").localeCompare(String(right.employee_code || ""));
      });

    if (format === "pdf") {
      const lines = reportRows
        .map(
          (row) =>
            `<tr><td>${htmlCell(row.employee_code)}</td><td>${htmlCell(row.full_name)}</td><td>${htmlCell(row.work_date)}</td><td>${htmlCell(row.status)}</td><td>${htmlCell(row.overtime_minutes)}</td></tr>`,
        )
        .join("");
      return new Response(
        `<!doctype html><title>Attendance report ${month}</title><h1>Attendance report ${month}</h1><table><thead><tr><th>Code</th><th>Name</th><th>Date</th><th>Status</th><th>OT minutes</th></tr></thead><tbody>${lines}</tbody></table>`,
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "content-disposition": `attachment; filename="attendance-${month}.html"`,
          },
        },
      );
    }

    const csv = [
      "Employee Code,Name,Date,Clock In,Break,Resume,Clock Out,Working Minutes,Late Minutes,Early Leave Minutes,OT Minutes,Status",
      ...reportRows.map((row) =>
        [
          row.employee_code,
          row.full_name,
          row.work_date,
          row.clock_in_at,
          row.break_at,
          row.resume_at,
          row.clock_out_at,
          row.total_minutes,
          row.late_minutes,
          row.early_leave_minutes,
          row.overtime_minutes,
          row.status,
        ]
          .map(csvCell)
          .join(","),
      ),
    ].join("\n");

    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="attendance-${month}.csv"`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return Response.json({ error: message }, { status: 500 });
  }
}

function csvCell(value: unknown) {
  const raw = String(value ?? "");
  return `"${raw.replaceAll('"', '""')}"`;
}

function htmlCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
