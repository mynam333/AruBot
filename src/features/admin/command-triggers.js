/**
 * Split the command field into case-insensitive, unique trigger words.
 * Whitespace separates triggers; command arguments are still parsed from chat messages at runtime.
 *
 * @param {unknown} value
 * @param {{ regex?: boolean }} options
 * @returns {string[]}
 */
export function parseCommandTriggers(value, options = {}) {
  const triggers = String(value ?? '').trim().split(options.regex ? /\r?\n/u : /\s+/u).filter(Boolean);
  const seen = new Set();
  return triggers.filter((trigger) => {
    if (trigger === '!') return false;
    const key = options.regex ? trigger : trigger.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {unknown} values
 * @param {{ regex?: boolean }} options
 * @returns {string}
 */
export function formatCommandTriggers(values, options = {}) {
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .join(options.regex ? '\n' : ' ');
}
