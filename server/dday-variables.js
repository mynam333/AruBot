import { getKstCalendarDate } from './attendance-calendar.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_CALENDAR_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DDAY_VARIABLE_RE = /\$\{\s*dday\s*::\s*(\d{4}-\d{2}-\d{2})\s*\}/gi;

function calendarDayNumber(value) {
  const normalized = String(value || '').trim();
  const match = normalized.match(ISO_CALENDAR_DATE_RE);
  if (!match || Number(match[1]) < 1) return null;

  const timestamp = Date.parse(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  if (new Date(timestamp).toISOString().slice(0, 10) !== normalized) return null;
  return Math.floor(timestamp / DAY_MS);
}

export function calculateKstDday(targetDate, timestamp = Date.now()) {
  const targetDay = calendarDayNumber(targetDate);
  if (targetDay == null) return null;

  const todayDay = calendarDayNumber(getKstCalendarDate(timestamp));
  if (todayDay == null) return null;
  return targetDay - todayDay;
}

export function substituteDdayVariables(value, timestamp = Date.now()) {
  if (value == null) return '';
  return String(value).replace(DDAY_VARIABLE_RE, (token, targetDate) => {
    const days = calculateKstDday(targetDate, timestamp);
    return days == null ? token : String(days);
  });
}
