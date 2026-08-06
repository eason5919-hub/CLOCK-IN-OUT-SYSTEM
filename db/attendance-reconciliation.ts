export type AttendanceRow = Record<string, unknown>;

type TimeSource = "base" | "report" | "override";

type TimeCandidate = {
  value: string | null;
  updatedAt: string;
  source: TimeSource;
  priority: number;
  row: AttendanceRow;
};

const ARCHIVED_REPORT_SOURCE = "admin_report_edit_archived";
const REPORT_SEGMENT_SOURCE = "admin_report_edit";
const REPORT_RESUME_SEGMENT_SOURCE = "admin_report_edit_resume";
const REPORT_IN_SOURCE = "admin_report_edit_in";
const REPORT_OUT_SOURCE = "admin_report_edit_out";

export function reconcileAttendanceRows(rows: AttendanceRow[]) {
  const grouped = new Map<string, AttendanceRow[]>();

  rows.forEach((row) => {
    if (String(row.source || "") === ARCHIVED_REPORT_SOURCE) return;
    const employeeId = String(row.employee_id || "");
    const workDate = String(row.work_date || "");
    if (!employeeId || !workDate) return;
    const key = `${employeeId}|${workDate}`;
    const dayRows = grouped.get(key) || [];
    dayRows.push(row);
    grouped.set(key, dayRows);
  });

  return [...grouped.values()]
    .map(reconcileAttendanceDay)
    .filter((row): row is AttendanceRow => Boolean(row))
    .sort((left, right) => {
      const dateOrder = String(right.work_date || "").localeCompare(String(left.work_date || ""));
      if (dateOrder) return dateOrder;
      return String(left.employee_code || left.employee_id || "").localeCompare(
        String(right.employee_code || right.employee_id || ""),
      );
    });
}

export function reconcileAttendanceDay(rows: AttendanceRow[]) {
  const activeRows = rows.filter((row) => String(row.source || "") !== ARCHIVED_REPORT_SOURCE);
  if (!activeRows.length) return null;

  const baseRows = activeRows.filter((row) => !isReportSource(row));
  const reportSegments = activeRows
    .filter((row) => {
      const source = String(row.source || "");
      return source === REPORT_SEGMENT_SOURCE || source === REPORT_RESUME_SEGMENT_SOURCE;
    })
    .sort(compareSegments);
  const inMarkers = activeRows.filter((row) => String(row.source || "") === REPORT_IN_SOURCE);
  const outMarkers = activeRows.filter((row) => String(row.source || "") === REPORT_OUT_SOURCE);
  const baseRow = newestRow(baseRows);
  const inMarker = newestRow(inMarkers);
  const outMarker = newestRow(outMarkers);
  const firstReportSegment = reportSegments[0] || null;
  const lastReportSegment = reportSegments[reportSegments.length - 1] || null;

  const clockIn = newestCandidate([
    timeCandidate(baseRow, "clock_in_at", "base", 1, true),
    timeCandidate(firstReportSegment, "clock_in_at", "report", 2, true),
    timeCandidate(inMarker, "clock_in_at", "override", 3, true),
  ]);
  const clockOut = newestCandidate([
    timeCandidate(baseRow, "clock_out_at", "base", 1, true),
    timeCandidate(lastReportSegment, "clock_out_at", "report", 2, true),
    timeCandidate(outMarker, "clock_out_at", "override", 3, true),
  ]);

  const reportSegmentsEffective = Boolean(
    reportSegments.length &&
      clockIn &&
      clockOut &&
      clockIn.source !== "base" &&
      clockOut.source !== "base",
  );
  const metricRows = reportSegmentsEffective ? reportSegments : baseRow ? [baseRow] : [];
  const anchor = (reportSegmentsEffective ? reportSegments[0] : baseRow) || inMarker || outMarker || activeRows[0];
  const latestOpenQrRow = newestRow(
    activeRows.filter(
      (row) => String(row.source || "") === "qr_gps" && Boolean(row.clock_in_at) && !row.clock_out_at,
    ),
  );
  const breakAt = reportSegmentsEffective && reportSegments.length > 1
    ? stringOrNull(reportSegments[0].clock_out_at)
    : null;
  const resumeAt = reportSegmentsEffective && reportSegments.length > 1
    ? stringOrNull(reportSegments[1].clock_in_at)
    : null;
  const totalMinutes = sumMetric(metricRows, "total_minutes");
  const overtimeMinutes = sumMetric(metricRows, "overtime_minutes");
  const lateMinutes = reportSegmentsEffective
    ? maxMetric(metricRows, "late_minutes")
    : sumMetric(metricRows, "late_minutes");
  const earlyLeaveMinutes = reportSegmentsEffective
    ? maxMetric(metricRows, "early_leave_minutes")
    : sumMetric(metricRows, "early_leave_minutes");
  const clockInValue = clockIn?.value || null;
  const clockOutValue = clockOut?.value || null;

  return {
    ...anchor,
    id: anchor.id || baseRow?.id || reportSegments[0]?.id || inMarker?.id || outMarker?.id,
    employee_id: anchor.employee_id || activeRows[0].employee_id,
    employee_code: anchor.employee_code || activeRows[0].employee_code,
    full_name: anchor.full_name || activeRows[0].full_name,
    work_date: anchor.work_date || activeRows[0].work_date,
    clock_in_at: clockInValue,
    break_at: breakAt,
    resume_at: resumeAt,
    clock_out_at: clockOutValue,
    clock_in_latitude: anchor.clock_in_latitude ?? baseRow?.clock_in_latitude ?? null,
    clock_in_longitude: anchor.clock_in_longitude ?? baseRow?.clock_in_longitude ?? null,
    clock_in_accuracy: anchor.clock_in_accuracy ?? baseRow?.clock_in_accuracy ?? null,
    clock_in_distance_meters: anchor.clock_in_distance_meters ?? baseRow?.clock_in_distance_meters ?? null,
    clock_out_latitude: anchor.clock_out_latitude ?? baseRow?.clock_out_latitude ?? null,
    clock_out_longitude: anchor.clock_out_longitude ?? baseRow?.clock_out_longitude ?? null,
    clock_out_accuracy: anchor.clock_out_accuracy ?? baseRow?.clock_out_accuracy ?? null,
    clock_out_distance_meters: anchor.clock_out_distance_meters ?? baseRow?.clock_out_distance_meters ?? null,
    total_minutes: clockInValue && clockOutValue ? totalMinutes : 0,
    late_minutes: clockInValue && clockOutValue ? lateMinutes : 0,
    early_leave_minutes: clockInValue && clockOutValue ? earlyLeaveMinutes : 0,
    overtime_minutes: clockInValue && clockOutValue ? overtimeMinutes : 0,
    status: resolvedStatus(clockInValue, clockOutValue, lateMinutes, earlyLeaveMinutes, overtimeMinutes),
    source: resolvedSource(clockIn, clockOut, anchor),
    created_at: oldestTimestamp(activeRows),
    updated_at: newestTimestamp(activeRows),
    clock_in_updated_at: clockIn?.updatedAt || "",
    clock_out_updated_at: clockOut?.updatedAt || "",
    report_edited_clock_in: clockIn && clockIn.source !== "base" ? 1 : 0,
    report_edited_break: breakAt ? 1 : 0,
    report_edited_resume: resumeAt ? 1 : 0,
    report_edited_clock_out: clockOut && clockOut.source !== "base" ? 1 : 0,
    report_segments_effective: reportSegmentsEffective ? 1 : 0,
    report_segment_count: reportSegmentsEffective ? reportSegments.length : 0,
    live_open_clock_in_at: stringOrNull(latestOpenQrRow?.clock_in_at),
  };
}

function isReportSource(row: AttendanceRow) {
  return String(row.source || "").startsWith("admin_report_edit");
}

function timeCandidate(
  row: AttendanceRow | null,
  field: "clock_in_at" | "clock_out_at",
  source: TimeSource,
  priority: number,
  includeBlank = false,
): TimeCandidate | null {
  if (!row) return null;
  const value = stringOrNull(row[field]);
  if (!includeBlank && !value) return null;
  return {
    value,
    updatedAt: String(row.updated_at || row.created_at || ""),
    source,
    priority,
    row,
  };
}

function newestCandidate(candidates: Array<TimeCandidate | null>) {
  return candidates.reduce<TimeCandidate | null>((best, candidate) => {
    if (!candidate) return best;
    if (!best) return candidate;
    const candidateTime = parseAttendanceTimestamp(candidate.updatedAt);
    const bestTime = parseAttendanceTimestamp(best.updatedAt);
    if (candidateTime !== bestTime) return candidateTime > bestTime ? candidate : best;
    if (candidate.priority !== best.priority) return candidate.priority > best.priority ? candidate : best;
    return String(candidate.row.id || "").localeCompare(String(best.row.id || "")) >= 0 ? candidate : best;
  }, null);
}

function newestRow(rows: AttendanceRow[]) {
  return rows.reduce<AttendanceRow | null>((best, row) => {
    if (!best) return row;
    const rowTime = parseAttendanceTimestamp(String(row.updated_at || row.created_at || ""));
    const bestTime = parseAttendanceTimestamp(String(best.updated_at || best.created_at || ""));
    if (rowTime !== bestTime) return rowTime > bestTime ? row : best;
    return String(row.id || "").localeCompare(String(best.id || "")) >= 0 ? row : best;
  }, null);
}

function compareSegments(left: AttendanceRow, right: AttendanceRow) {
  const leftSlot = String(left.source || "") === REPORT_RESUME_SEGMENT_SOURCE ? 1 : 0;
  const rightSlot = String(right.source || "") === REPORT_RESUME_SEGMENT_SOURCE ? 1 : 0;
  if (leftSlot !== rightSlot) return leftSlot - rightSlot;
  const leftTime = parseAttendanceTimestamp(String(left.clock_in_at || left.clock_out_at || ""));
  const rightTime = parseAttendanceTimestamp(String(right.clock_in_at || right.clock_out_at || ""));
  if (leftTime !== rightTime) return leftTime - rightTime;
  return String(left.id || "").localeCompare(String(right.id || ""));
}

function resolvedSource(clockIn: TimeCandidate | null, clockOut: TimeCandidate | null, anchor: AttendanceRow) {
  if (clockIn?.source === "override" || clockOut?.source === "override") return REPORT_SEGMENT_SOURCE;
  if (clockIn?.source === "report" || clockOut?.source === "report") return REPORT_SEGMENT_SOURCE;
  return String(anchor.source || "");
}

function resolvedStatus(
  clockIn: string | null,
  clockOut: string | null,
  lateMinutes: number,
  earlyLeaveMinutes: number,
  overtimeMinutes: number,
) {
  if (!clockIn || !clockOut) return "pending_review";
  if (lateMinutes > 0) return "late";
  if (earlyLeaveMinutes > 0) return "early_leave";
  if (overtimeMinutes > 0) return "ot";
  return "present";
}

function sumMetric(rows: AttendanceRow[], field: string) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

function maxMetric(rows: AttendanceRow[], field: string) {
  return rows.reduce((maximum, row) => Math.max(maximum, Number(row[field] || 0)), 0);
}

function newestTimestamp(rows: AttendanceRow[]) {
  return rows.reduce((latest, row) => {
    const value = String(row.updated_at || row.created_at || "");
    return parseAttendanceTimestamp(value) >= parseAttendanceTimestamp(latest) ? value : latest;
  }, "");
}

function oldestTimestamp(rows: AttendanceRow[]) {
  return rows.reduce((oldest, row) => {
    const value = String(row.created_at || row.updated_at || "");
    if (!oldest) return value;
    return parseAttendanceTimestamp(value) < parseAttendanceTimestamp(oldest) ? value : oldest;
  }, "");
}

function stringOrNull(value: unknown) {
  if (value == null || value === "") return null;
  return String(value);
}

export function parseAttendanceTimestamp(value: string) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
    ? `${text.replace(" ", "T")}Z`
    : text;
  const milliseconds = Date.parse(normalized);
  return Number.isNaN(milliseconds) ? 0 : milliseconds;
}
