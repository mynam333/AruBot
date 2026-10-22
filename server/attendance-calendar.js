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

export function resolveAttendanceDate(timestamp = Date.now(), session = null) {
  const currentDate = getKstCalendarDate(timestamp);
  if (session?.live !== true) return currentDate;

  const startedAt = Number(session.session_start_time ?? session.sessionStartTime);
  if (Number.isFinite(startedAt) && startedAt > 0 && startedAt <= Number(timestamp)) {
    return getKstCalendarDate(startedAt);
  }

  // Older sessions may only have a persisted KST start date.
  const startDate = session.start_date || session.startDate;
  if (typeof startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(startDate) && startDate <= currentDate) {
    const parsed = new Date(`${startDate}T00:00:00.000Z`);
    if (Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === startDate) return startDate;
  }
  return currentDate;
}
