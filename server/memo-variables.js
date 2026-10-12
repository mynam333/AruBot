import { randomBytes } from 'node:crypto';
import { hasZalgoText } from '../shared/text-safety.js';

export const MAX_MEMO_LENGTH = 4000;
export const MAX_MEMOS_PER_RESPONSE = 16;
export const MEMO_EMPTY_TEXT = '저장된 메모가 없습니다.';
const RAW_TOKEN = /\$\{\s*memo\b[^}]*\}+/giu;
const TOKEN = /^\$\{\s*memo\s*(?:::\s*([^{}\r\n]+?)\s*)?\}$/iu;
const SENTINEL = /\uE000ARUBOT_MEMO:[^\uE001]*\uE001/gu;

export function normalizeMemoName(value) {
  const name = String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
  return Array.from(name).length <= 64 && /^[\p{L}\p{N} _.-]+$/u.test(name) && !hasZalgoText(name) ? name : null;
}

export function validateMemoValue(value) {
  if (typeof value !== 'string' || value.length > MAX_MEMO_LENGTH || value.includes('\0') || hasZalgoText(value)) {
    throw new Error('invalid_memo_value');
  }
  return value;
}

export function memoCommandArguments(message, matchedKeyword) {
  const source = String(message ?? '').trimStart();
  const keyword = String(matchedKeyword ?? '');
  if (!keyword || source.slice(0, keyword.length).toLowerCase() !== keyword.toLowerCase()) return '';
  const tail = source.slice(keyword.length);
  return /^\s/u.test(tail) ? tail.replace(/^\s+/u, '') : '';
}

// Protect authored tokens until all executable variables have finished rendering.
export function prepareMemoVariablePlan(template, { ruleId } = {}) {
  const entries = [];
  const byKey = new Map();
  const source = String(template ?? '');
  const text = source.replace(RAW_TOKEN, (raw) => {
    const match = raw.match(TOKEN);
    if (!match) return '';
    const name = match[1] ? normalizeMemoName(match[1]) : null;
    const id = String(ruleId || '');
    const key = match[1] ? (name ? `name:${name}` : '') : (/^[\w-]{1,128}$/.test(id) ? `rule:${id}` : '');
    if (!key) return '';
    if (byKey.has(key)) return byKey.get(key).sentinel;
    if (entries.length >= MAX_MEMOS_PER_RESPONSE) return '';
    let sentinel;
    do { sentinel = `\uE000ARUBOT_MEMO:${randomBytes(24).toString('base64url')}\uE001`; } while (source.includes(sentinel));
    const entry = Object.freeze({ key, sentinel });
    entries.push(entry);
    byKey.set(key, entry);
    return sentinel;
  });
  return Object.freeze({ text, entries: Object.freeze(entries) });
}

export function stripUnplannedMemoVariables(text) {
  return String(text ?? '').replace(RAW_TOKEN, '').replace(SENTINEL, '');
}

export async function resolveMemoVariablePlan(plan, rendered, { argsText = '', canWrite = false, readMemos, writeMemos } = {}) {
  const source = String(rendered ?? '');
  const entries = (plan?.entries || []).filter((entry) => source.includes(entry.sentinel));
  if (!entries.length) return stripUnplannedMemoVariables(source);
  const writing = canWrite === true && typeof argsText === 'string' && argsText.trim().length > 0;
  let values;
  try {
    const keys = entries.map((entry) => entry.key);
    values = writing ? await writeMemos(keys, validateMemoValue(argsText)) : await readMemos(keys);
    if (!(values instanceof Map)) throw new Error('invalid_memo_result');
  } catch {
    const error = writing ? '메모를 저장하지 못했습니다.' : '메모를 불러오지 못했습니다.';
    return source.replace(RAW_TOKEN, '').replace(SENTINEL, (token) => entries.some((entry) => entry.sentinel === token) ? error : '');
  }
  const replacements = new Map(entries.map((entry) => [entry.sentinel, values.get(entry.key) ?? MEMO_EMPTY_TEXT]));
  // One replacement pass: saved text is literal data, including other tokens.
  return source.replace(RAW_TOKEN, '').replace(SENTINEL, (token) => replacements.get(token) ?? '');
}
