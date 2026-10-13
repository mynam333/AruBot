import { RE2 } from 're2-wasm';

const cache = new Map();
const MAX_PATTERN_LENGTH = 256;
const MAX_INPUT_LENGTH = 4096;

function patternError(message) {
  return Object.assign(new Error(message), { status: 400, code: 'invalid_rule_regex' });
}

export function validateRulePattern(value, { command = false } = {}) {
  const pattern = String(value ?? '').trim();
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) throw patternError('정규식은 1~256자로 입력해 주세요.');
  const key = `${command ? 'command' : 'message'}:${pattern}`;
  if (cache.has(key)) return cache.get(key);
  let compiled;
  try {
    // RE2 does not backtrack; untrusted expressions never run in the JS regex engine.
    compiled = new RE2(command ? `^(?:${pattern})` : pattern, 'iu');
  } catch {
    throw patternError('지원하지 않거나 잘못된 정규식입니다. 전후방 탐색과 역참조는 사용할 수 없습니다.');
  }
  if (command && compiled.test('')) throw patternError('빈 문자열과 일치하는 명령어 정규식은 사용할 수 없습니다.');
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  cache.set(key, compiled);
  return compiled;
}

export function matchRulePattern(pattern, input, options = {}) {
  const source = String(input ?? '');
  if (source.length > MAX_INPUT_LENGTH) return null;
  try { return validateRulePattern(pattern, options).exec(source); }
  catch { return null; }
}

export function validateCommandRuleRegex(rule) {
  if (rule?.regex !== true) return;
  if (!Array.isArray(rule.keywords) || !rule.keywords.length || rule.keywords.length > 20) {
    throw patternError('명령어 정규식은 1~20개까지 등록할 수 있습니다.');
  }
  for (const pattern of rule.keywords) validateRulePattern(pattern, { command: true });
}

export function donationRuleMatchesMessage(rule, message) {
  const pattern = String(rule?.message || '').trim();
  if (rule?.regex === true) return Boolean(matchRulePattern(pattern, message));
  if (!pattern) return true;
  const source = String(message || '').toLowerCase();
  return rule?.wildcard ? source.includes(pattern.toLowerCase()) : source.startsWith(pattern.toLowerCase());
}
