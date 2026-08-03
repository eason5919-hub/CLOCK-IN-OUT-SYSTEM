export type AttendanceSchedule = {
  start_time: string | null;
  end_time: string | null;
  overtime_starts_at: string | null;
  is_off_day: number;
};

const DEFAULT_TIME_ZONE = "Asia/Kuala_Lumpur";

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
  const lateMinutes = schedule?.start_time
    ? Math.max(0, localMinutesSinceMidnight(clockInAt, timeZone) - timeToMinutes(schedule.start_time))
    : 0;
  const earlyLeaveMinutes =
    schedule?.end_time && !schedule.is_off_day
      ? Math.max(0, timeToMinutes(schedule.end_time) - localMinutesSinceMidnight(clockOutAt, timeZone))
      : 0;
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

  const clockOutMinutes = localMinutesSinceMidnight(clockOutAt, timeZone);
  const scheduledEndMinutes = timeToMinutes(schedule.end_time);
  const overtimeThresholdMinutes = timeToMinutes(schedule.overtime_starts_at);

  return clockOutMinutes >= overtimeThresholdMinutes
    ? Math.max(0, clockOutMinutes - scheduledEndMinutes)
    : 0;
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
