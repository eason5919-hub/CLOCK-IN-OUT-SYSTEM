export type AttendanceSchedule = {
  start_time: string | null;
  end_time: string | null;
  overtime_starts_at: string | null;
  is_off_day: number;
};

export function calculateAttendanceTotals(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
) {
  const totalMinutes = Math.max(
    0,
    Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000),
  );
  const lateMinutes = schedule?.start_time
    ? Math.max(0, minutesSinceMidnight(clockInAt) - timeToMinutes(schedule.start_time))
    : 0;
  const earlyLeaveMinutes =
    schedule?.end_time && !schedule.is_off_day
      ? Math.max(0, timeToMinutes(schedule.end_time) - minutesSinceMidnight(clockOutAt))
      : 0;
  const overtimeMinutes = calculateOvertimeMinutes(clockInAt, clockOutAt, schedule);

  return { totalMinutes, lateMinutes, earlyLeaveMinutes, overtimeMinutes };
}

export function calculateOvertimeMinutes(
  clockInAt: string,
  clockOutAt: string,
  schedule?: AttendanceSchedule | null,
) {
  if (!schedule) return 0;
  if (schedule.is_off_day) {
    return Math.max(0, Math.round((Date.parse(clockOutAt) - Date.parse(clockInAt)) / 60000));
  }
  if (!schedule.end_time || !schedule.overtime_starts_at) return 0;

  const clockOutMinutes = minutesSinceMidnight(clockOutAt);
  const scheduledEndMinutes = timeToMinutes(schedule.end_time);
  const overtimeThresholdMinutes = timeToMinutes(schedule.overtime_starts_at);

  return clockOutMinutes >= overtimeThresholdMinutes
    ? Math.max(0, clockOutMinutes - scheduledEndMinutes)
    : 0;
}

function minutesSinceMidnight(value: string) {
  const date = new Date(value);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
