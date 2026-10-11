// Kept in parity with shared/text-safety.js for the self-contained Electron build.
const MARK = /\p{M}/u;
const IGNORABLE = /\p{Default_Ignorable_Code_Point}/u;
function hasZalgoText(value) {
  if (
    typeof value !== 'string' ||
    !/[\p{M}\p{Default_Ignorable_Code_Point}]/u.test(value)
  )
    return false;
  let marks = 0,
    invisible = 0;
  const seen = new Set();
  for (const character of value) {
    if (IGNORABLE.test(character)) {
      if (++invisible > 16) return true;
      continue;
    }
    for (const part of character.normalize('NFD')) {
      if (MARK.test(part)) {
        if (++marks > 3 || seen.has(part)) return true;
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
const sanitizeZalgoText = (value) =>
  hasZalgoText(value)
    ? value.replace(/[\p{M}\p{Default_Ignorable_Code_Point}]/gu, '')
    : value;
module.exports = { hasZalgoText, sanitizeZalgoText };
