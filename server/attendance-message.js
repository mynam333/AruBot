export const DEFAULT_ATTENDANCE_MESSAGE = '{user.name}님 출석체크 완료! (연속 {attendance.streak}일, 누적 {attendance.totalDays}일)';

const ATTENDANCE_READ_ONLY_FALLBACKS = Object.freeze({
  '{user.username}': '',
  '{user.nickname}': '',
  '{user.points}': '0',
  '{user.channelPoints}': '0',
  '{user.attendanceDays}': '0',
  '{user.followedAt}': '확인할 수 없음',
  '{user.followedDays}': '0',
  '{user.subscriptionMonths}': '',
  '{live.title}': '',
  '{live.category}': '',
  '{live.viewers}': '',
  '{live.startedAt}': '',
  '{live.elapsed}': '[방송 중이 아닙니다.]',
  '{live.elapsed_ko}': '[방송 중이 아닙니다.]',
  '{live.channel}': '',
  '{channel.followers}': '',
});

export async function renderAttendanceTemplate(template, context = {}, substitutePlaceholders = null, options = {}) {
  const provided = String(template ?? '').trim();
  const source = options.allowEmptyTemplate === true
    ? provided
    : (provided || DEFAULT_ATTENDANCE_MESSAGE);
  const replacements = {
    '{user.name}': context.username || '',
    '{user.id}': context.userId || '',
    '{attendance.streak}': context.streak ?? 0,
    '{attendance.totalDays}': context.totalDays ?? 0,
    '{attendance.points}': context.points ?? 0,
    '{attendance.date}': context.date || '',
  };
  let rendered = Object.entries(replacements).reduce(
    (message, [token, value]) => message.split(token).join(String(value)),
    source
  );

  if (typeof substitutePlaceholders === 'function') {
    let timeoutId = null;
    try {
      const substitution = Promise.resolve().then(() => substitutePlaceholders(rendered));
      const timeoutMs = Number(options.substitutionTimeoutMs || 0);
      const substituted = Number.isFinite(timeoutMs) && timeoutMs > 0
        ? await Promise.race([
            substitution,
            new Promise((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error('attendance_placeholder_timeout')), timeoutMs);
            }),
          ])
        : await substitution;
      if (substituted != null) rendered = String(substituted);
    } catch { }
    finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const fallbackReplacements = {
    ...ATTENDANCE_READ_ONLY_FALLBACKS,
    '{user.username}': context.username || '',
    '{user.nickname}': context.username || '',
  };
  rendered = Object.entries(fallbackReplacements).reduce(
    (message, [token, value]) => message.split(token).join(String(value)),
    rendered
  );

  const normalized = rendered.trim();
  const maxLength = options.maxLength === null
    ? null
    : Math.max(1, Number(options.maxLength || 100));
  return maxLength == null ? normalized : normalized.slice(0, maxLength);
}
