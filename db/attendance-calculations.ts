export type AttendanceSchedule = {
  start_time: string | null;
  end_time: string | null;
  overtime_starts_at: string | null;
  is_off_day: number;
};

const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";
const START_GRACE_MINUTES = 15;
const EARLY_OT_BEFORE_START_MINUTES = 60;

export function calculateAttendanceTotals(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
  timeZone = DEFAULT_TIME_ZONE,
) {
  const totalMinutes = Math.max(
    0,
    Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000),
  );
  const lateMinutes = calculateLateMinutes(clockInAt, schedule, timeZone);
  const earlyLeaveMinutes = calculateEarlyLeaveMinutes(clockInAt, clockOutAt, schedule, timeZone);
  const overtimeMinutes = calculateOvertimeMinutes(clockInAt, clockOutAt, schedule, timeZone);

  return { totalMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes };
}

export function calculateOvertimeMinutes(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!schedule) return 0;
  if (schedule.is_off_day) {
    return Math.max(0, Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000));
  }
  if (!schedule.end_time || !schedule.overtime_starts_at) return 0;

  const workDate = localDateTimeParts(clockInAt, timeZone);
  const scheduledEndMs = localDateAndTimeToUtcMs(workDate, schedule.end_time, timeZone);
  const overtimeThresholdMs = localDateAndTimeToUtcMs(workDate, schedule.overtime_starts_at, timeZone);
  const clockOutMs = Date.parse(clockOutAt);
  const earlyOvertimeMinutes = calculateEarlyOvertimeMinutes(clockInAt, schedule, timeZone);
  const lateOvertimeMinutes =
    clockOutMs >= overtimeThresholdMs ? Math.max(0, Math.round((clockOutMs - scheduledEndMs) / 60000)) : 0;

  return earlyOvertimeMinutes + lateOvertimeMinutes;
}

export function localWorkDate(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = localDateTimeParts(value, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function localDayOfWeek(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = localDateTimeParts(value, timeZone);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function localMinutesSinceMidnight(value: string | Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = localDateTimeParts(value, timeZone);
  return parts.hour * 60 + parts.minute;
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function calculateLateMinutes(clockInAt: string, schedule?: AttendanceSchedule | null, timeZone = DEFAULT_TIME_ZONE) {
  if (!schedule?.start_time || schedule.is_off_day) return 0;
  const clockInMinutes = localMinutesSinceMidnight(clockInAt, timeZone);
  const scheduledStartMinutes = timeToMinutes(schedule.start_time);
  return clockInMinutes > scheduledStartMinutes + START_GRACE_MINUTES
    ? Math.max(0, clockInMinutes - scheduledStartMinutes)
    : 0;
}

function calculateEarlyLeaveMinutes(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!schedule?.end_time || schedule.is_off_day) return 0;
  const workDate = localDateTimeParts(clockInAt, timeZone);
  const scheduledEndMs = localDateAndTimeToUtcMs(workDate, schedule.end_time, timeZone);
  return Date.parse(clockOutAt) < scheduledEndMs
    ? Math.max(0, Math.round((scheduledEndMs - Date.parse(clockOutAt)) / 60000))
    : 0;
}

function calculateEarlyOvertimeMinutes(
  clockInAt: string,
  schedule?: AttendanceSchedule | null,
  timeZone = DEFAULT_TIME_ZONE,
) {
  if (!schedule?.start_time || schedule.is_off_day) return 0;
  const scheduledStartMinutes = timeToMinutes(schedule.start_time);
  const earlyNormalStartMinutes = scheduledStartMinutes - EARLY_OT_BEFORE_START_MINUTES;
  if (earlyNormalStartMinutes < 0) return 0;

  const workDate = localDateTimeParts(clockInAt, timeZone);
  const earlyNormalStartMs = localDateAndTimeToUtcMs(
    workDate,
    minutesToTime(earlyNormalStartMinutes),
    timeZone,
  );
  return Date.parse(clockInAt) < earlyNormalStartMs
    ? Math.max(0, Math.round((earlyNormalStartMs - Date.parse(clockInAt)) / 60000))
    : 0;
}

function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function localDateAndTimeToUtcMs(
  dateParts: { year: number; month: number; day: number },
  time: string,
  timeZone: string,
) {
  const [hour, minute] = time.split(":").map(Number);
  let utcMs = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
  for (let index = 0; index < 3; index += 1) {
    const actual = localDateTimeParts(new Date(utcMs), timeZone);
    const actualAsUtc = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute);
    const wantedAsUtc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hour, minute);
    utcMs -= actualAsUtc - wantedAsUtc;
  }
  return utcMs;
}

function localDateTimeParts(value: string | Date, timeZone: string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}
