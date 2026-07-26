const ATTENDANCE_SPECIAL_TOKEN_RE = /\$\{\s*(roulette|action|automation|blueprint)::([^}]+)\s*\}/gi;

export function extractAttendanceSpecialVariables(text) {
  const source = String(text || '');
  const operations = [];
  const seen = new Set();
  const cleaned = source.replace(ATTENDANCE_SPECIAL_TOKEN_RE, (_token, rawType, rawTarget) => {
    const type = String(rawType || '').trim().toLowerCase();
    const target = String(rawTarget || '').trim();
    const kind = type === 'roulette' ? 'roulette' : 'action';
    const dedupeKey = `${kind}:${target.toLocaleLowerCase()}`;
    if (target && !seen.has(dedupeKey)) {
      seen.add(dedupeKey);
      operations.push({ type, target });
    }
    return '';
  }).trim();

  return { text: cleaned, used: operations.length > 0, operations };
}

export async function executeAttendanceSpecialOperations(operations, options = {}) {
  const planned = Array.isArray(operations) ? operations : [];

  if (options.execute !== true || planned.length === 0) {
    return { executed: [], errors: [] };
  }

  const executed = [];
  const errors = [];
  for (const operation of planned) {
    const handler = operation.type === 'roulette' ? options.onRoulette : options.onAction;
    if (typeof handler !== 'function') continue;
    try {
      await handler(operation);
      executed.push(operation);
    } catch (error) {
      errors.push({ ...operation, error });
    }
  }

  return { executed, errors };
}

export async function processAttendanceSpecialVariables(text, options = {}) {
  const extracted = extractAttendanceSpecialVariables(text);
  const execution = await executeAttendanceSpecialOperations(extracted.operations, options);
  return { ...extracted, ...execution };
}
