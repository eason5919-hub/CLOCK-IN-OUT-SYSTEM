import { ensureDatabase, getD1 } from "../../../../db/runtime";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "excel";
    const month = searchParams.get("month") ?? new Date().toISOString().slice(0, 7);

    const db = getD1();
    await ensureDatabase(db);
    const rows = await db
      .prepare(
        `SELECT e.employee_code, e.full_name, a.work_date, a.clock_in_at, a.clock_out_at,
                a.total_minutes, a.late_minutes, a.early_leave_minutes, a.overtime_minutes, a.status
         FROM attendance a
         JOIN employees e ON e.id = a.employee_id
         WHERE a.work_date LIKE ?
         ORDER BY a.work_date, e.employee_code`,
      )
      .bind(`${month}%`)
      .all<Record<string, unknown>>();

    if (format === "pdf") {
      const lines = (rows.results ?? [])
        .map(
          (row) =>
            `<tr><td>${row.employee_code}</td><td>${row.full_name}</td><td>${row.work_date}</td><td>${row.status}</td><td>${row.overtime_minutes}</td></tr>`,
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
      "Employee Code,Name,Date,Clock In,Clock Out,Working Minutes,Late Minutes,Early Leave Minutes,OT Minutes,Status",
      ...(rows.results ?? []).map((row) =>
        [
          row.employee_code,
          row.full_name,
          row.work_date,
          row.clock_in_at,
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
