/**
 * Split the command field into case-insensitive, unique trigger words.
 * Whitespace separates triggers; command arguments are still parsed from chat messages at runtime.
 *
 * @param {unknown} value
 * @returns {string[]}
 */
export function parseCommandTriggers(value) {
  const triggers = String(value ?? '').trim().split(/\s+/u).filter(Boolean);
  const seen = new Set();
  return triggers.filter((trigger) => {
    if (trigger === '!') return false;
    const key = trigger.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {unknown} values
 * @returns {string}
 */
export function formatCommandTriggers(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(' ');
}
