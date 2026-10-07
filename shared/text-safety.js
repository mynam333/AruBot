const MARK = /\p{M}/u;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
const DECORATION = /[\p{M}\p{Default_Ignorable_Code_Point}]/u;
const MAX_MARKS = 3;

export function hasZalgoText(value) {
  if (typeof value !== 'string' || !DECORATION.test(value)) return false;
  let marks = 0;
  let invisible = 0;
  const seen = new Set();
  for (const character of value) {
    // Joiners/variation selectors must not reset the stack or break emoji sequences.
    if (IGNORABLE.test(character)) {
      if (++invisible > 16) return true;
      continue;
    }
    // Decompose one code point at a time: never normalize an unbounded mark run.
    for (const part of character.normalize('NFD')) {
      if (MARK.test(part)) {
        if (++marks > MAX_MARKS || seen.has(part)) return true;
        seen.add(part);
      } else {
        marks = 0;
        invisible = 0;
        seen.clear();
      }
    }
  }
  return false;
}

export function sanitizeZalgoText(value) {
  if (!hasZalgoText(value)) return value;
  // This is an output-only fallback; input is rejected, never rewritten into a command.
  return value.replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '');
}

export function inspectTextPayload(value, { maxDepth = 48, maxNodes = 1000000, maxChars = 5 * 1024 * 1024 } = {}) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  let chars = 0;
  while (stack.length) {
    const current = stack.pop();
    if (++nodes > maxNodes || current.depth > maxDepth) return 'payload_too_complex';
    if (typeof current.value === 'string') {
      chars += current.value.length;
      if (chars > maxChars) return 'payload_too_complex';
      if (hasZalgoText(current.value)) return 'zalgo_text_not_allowed';
      // OBS/settings payloads can carry another JSON document inside a string.
      const encoded = current.value.trim();
      if (encoded[0] === '{' || encoded[0] === '[' || encoded[0] === '"') {
        try {
          stack.push({ value: JSON.parse(encoded), depth: current.depth + 1 });
        } catch { /* Plain text and templates need not be valid JSON. */ }
      }
    } else if (current.value && typeof current.value === 'object') {
      if (ArrayBuffer.isView(current.value) || seen.has(current.value)) continue;
      seen.add(current.value);
      const keys = Object.keys(current.value);
      if (nodes + stack.length + keys.length > maxNodes) return 'payload_too_complex';
      for (const key of keys) {
        if (hasZalgoText(key)) return 'zalgo_text_not_allowed';
        stack.push({ value: current.value[key], depth: current.depth + 1 });
      }
    }
  }
  return null;
}

export function assertSafeTextPayload(value) {
  const code = inspectTextPayload(value);
  if (code) throw Object.assign(new Error(code), { code, status: code === 'payload_too_complex' ? 413 : 400 });
}

export function createSafeJsonReplacer() {
  const protectedObjects = new WeakSet();
  return function safeJsonText(key, value) {
    // Signed drawing recordings must remain byte-equivalent; their text is not rendered by overlays.
    if (protectedObjects.has(this) || key === 'document' || key === 'strokes') {
      if (value && typeof value === 'object') protectedObjects.add(value);
      return value;
    }
    return typeof value === 'string' ? sanitizeZalgoText(value) : value;
  };
}
