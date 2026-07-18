const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getKstCalendarDate(timestamp = Date.now()) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) {
    throw new TypeError('Attendance timestamp must be a finite number');
  }

  const date = new Date(value + KST_OFFSET_MS);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Attendance timestamp is outside the supported date range');
  }

  return date.toISOString().slice(0, 10);
}

export function resolveAttendanceDate(timestamp = Date.now()) {
  return getKstCalendarDate(timestamp);
}
