export type AttendanceSchedule = {
  start_time: string | null;
  end_time: string | null;
  overtime_starts_at: string | null;
  is_off_day: number;
};

const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";
const START_GRACE_MINUTES = 15;
const BREAK_MINUTES = 60;
const BREAK_GRACE_MINUTES = 15;
const EARLY_OT_BEFORE_START_MINUTES = 60;
const OPEN_ATTENDANCE_CUTOFF_TIME = "08:00";

export function calculateAttendanceTotals(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
  timeZone = DEFAULT_TIME_ZONE,
  options: { previousRegularMinutes?: number } = {},
) {
  const elapsedMinutes = Math.max(
    0,
    Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000),
  );
  const earlyLeaveMinutes = calculateEarlyLeaveMinutes(clockInAt, clockOutAt, schedule, timeZone);
  const overtimeMinutes = calculateOvertimeMinutes(clockInAt, clockOutAt, schedule, timeZone);
  const totalMinutes = calculatePaidMinutes(
    elapsedMinutes,
    overtimeMinutes,
    schedule,
    clockInAt,
    clockOutAt,
    timeZone,
    options.previousRegularMinutes ?? 0,
  );
  const lateMinutes = calculateShortMinutes(clockInAt, clockOutAt, schedule, timeZone, totalMinutes);

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
    clockOutMs >= overtimeThresholdMs
      ? Math.max(0, Math.round((clockOutMs - Math.max(Date.parse(clockInAt), scheduledEndMs)) / 60000))
      : 0;

  return earlyOvertimeMinutes + lateOvertimeMinutes;
}

export function calculateBreakReturnLateMinutes(
  previousClockOutAt: string,
  clockInAt: string,
) {
  const breakEndMs = Date.parse(previousClockOutAt) + BREAK_MINUTES * 60000;
  const graceEndMs = breakEndMs + BREAK_GRACE_MINUTES * 60000;
  const clockInMs = Date.parse(clockInAt);
  return clockInMs > graceEndMs ? Math.max(0, Math.round((clockInMs - breakEndMs) / 60000)) : 0;
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

export function isOpenAttendanceStillActive(
  workDate: string,
  now: string | Date,
  timeZone = DEFAULT_TIME_ZONE,
) {
  const today = localWorkDate(now, timeZone);
  if (workDate === today) return true;
  if (workDate !== previousDate(today)) return false;

  return localMinutesSinceMidnight(now, timeZone) < timeToMinutes(OPEN_ATTENDANCE_CUTOFF_TIME);
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

function calculatePaidMinutes(
  elapsedMinutes: number,
  overtimeMinutes: number,
  schedule: AttendanceSchedule | null | undefined,
  clockInAt: string,
  clockOutAt: string,
  timeZone: string,
  previousRegularMinutes: number,
) {
  const dailyRegularCap = calculateDailyRegularCap(schedule, clockInAt, timeZone);
  if (dailyRegularCap === null) return elapsedMinutes;

  const regularMinutes = calculateRegularWindowMinutes(clockInAt, clockOutAt, schedule, timeZone, previousRegularMinutes);
  const remainingRegularMinutes = Math.max(0, dailyRegularCap - previousRegularMinutes);
  return Math.min(regularMinutes, remainingRegularMinutes) + overtimeMinutes;
}

function calculateShortMinutes(
  clockInAt: string,
  clockOutAt: string,
  schedule: AttendanceSchedule | null | undefined,
  timeZone: string,
  totalMinutes: number,
) {
  if (!schedule?.start_time || !schedule.end_time || schedule.is_off_day) return 0;

  const clockInMinutes = localMinutesSinceMidnight(clockInAt, timeZone);
  const scheduledStartMinutes = timeToMinutes(schedule.start_time);
  const lateShort =
    clockInMinutes > scheduledStartMinutes + START_GRACE_MINUTES
      ? Math.max(0, clockInMinutes - scheduledStartMinutes)
      : 0;

  const workDate = localDateTimeParts(clockInAt, timeZone);
  const scheduledEndMs = localDateAndTimeToUtcMs(workDate, schedule.end_time, timeZone);
  const clockInMs = Date.parse(clockInAt);
  const clockOutMs = Date.parse(clockOutAt);
  if (Number.isNaN(clockInMs) || Number.isNaN(clockOutMs) || clockInMs >= scheduledEndMs) return 0;

  const requiredMinutes = calculateDailyRegularCap(schedule, clockInAt, timeZone) ?? 0;
  const earlyOutShort = clockOutMs < scheduledEndMs ? Math.max(0, Math.round((scheduledEndMs - clockOutMs) / 60000)) : 0;
  const workShort = Math.max(0, requiredMinutes - totalMinutes);
  return Math.min(requiredMinutes, Math.max(lateShort, earlyOutShort, workShort));
}

function calculateRegularWindowMinutes(
  clockInAt: string,
  clockOutAt: string,
  schedule: AttendanceSchedule | null | undefined,
  timeZone: string,
  previousRegularMinutes: number,
) {
  if (!schedule?.start_time || !schedule.end_time || schedule.is_off_day) {
    return Math.max(0, Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000));
  }

  const workDate = localDateTimeParts(clockInAt, timeZone);
  const scheduledStartMinutes = timeToMinutes(schedule.start_time);
  const scheduledEndMinutes = timeToMinutes(schedule.end_time);
  const day = localDayOfWeek(clockInAt, timeZone);
  const regularStartMs = localDateAndTimeToUtcMs(workDate, minutesToTime(Math.max(0, scheduledStartMinutes - EARLY_OT_BEFORE_START_MINUTES)), timeZone);
  const scheduledStartMs = localDateAndTimeToUtcMs(workDate, schedule.start_time, timeZone);
  const graceEndMs = scheduledStartMs + START_GRACE_MINUTES * 60000;
  const clockInMs = Date.parse(clockInAt);
  const clockOutMs = Date.parse(clockOutAt);
  if (Number.isNaN(clockInMs) || Number.isNaN(clockOutMs)) return 0;
  const effectiveClockInMs =
    clockInMs >= regularStartMs && clockInMs <= graceEndMs ? scheduledStartMs : Math.max(clockInMs, regularStartMs);
  const regularEndMs = localDateAndTimeToUtcMs(workDate, minutesToTime(scheduledEndMinutes + START_GRACE_MINUTES), timeZone);
  const regularSpan = Math.max(
    0,
    Math.round((Math.min(clockOutMs, regularEndMs) - effectiveClockInMs) / 60000),
  );
  const breakDeduction = day >= 1 && day <= 5 && previousRegularMinutes <= 0 && regularSpan >= 300 ? BREAK_MINUTES : 0;
  return Math.max(0, regularSpan - breakDeduction);
}

function calculateDailyRegularCap(
  schedule: AttendanceSchedule | null | undefined,
  clockInAt: string,
  timeZone: string,
) {
  if (!schedule?.start_time || !schedule.end_time || schedule.is_off_day) return null;

  const workDate = localDateTimeParts(clockInAt, timeZone);
  const scheduledStartMs = localDateAndTimeToUtcMs(workDate, schedule.start_time, timeZone);
  const scheduledEndMs = localDateAndTimeToUtcMs(workDate, schedule.end_time, timeZone);
  const scheduledMinutes = Math.max(0, Math.round((scheduledEndMs - scheduledStartMs) / 60000));
  const day = localDayOfWeek(clockInAt, timeZone);
  return day >= 1 && day <= 5 ? Math.max(0, scheduledMinutes - BREAK_MINUTES) : scheduledMinutes;
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

function previousDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
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
