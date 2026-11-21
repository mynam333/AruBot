// Annotate only literal balance placeholders in display text. Executable tokens
// can contain nested placeholders; their arguments must remain undecorated.
export async function annotatePointDisplay(template, sid, viewerId, loadBonus, projectSuffix) {
  if (!sid || !viewerId || /^(?:anonymous$|unknown_user$|cime:nickname:)/i.test(viewerId)
    || typeof template !== 'string' || !/\{user\.(?:points|channelPoints)\}/.test(template)) return template;
  const offsets = [];
  let depth = 0;
  for (const match of template.matchAll(/\$\{|\{user\.(?:points|channelPoints)\}(?:P(?![a-zA-Z])|포인트)?|[{}]/g)) {
    const token = match[0];
    if (token === '${' || (depth && token === '{')) depth++;
    else if (token === '}') depth = Math.max(0, depth - 1);
    else if (!depth && token !== '{') offsets.push(match.index + token.length);
  }
  if (!offsets.length) return template;
  const bonus = await loadBonus(sid, viewerId).catch(() => null);
  if (!bonus?.live || !Number.isSafeInteger(bonus.remaining) || bonus.remaining <= 0) return template;
  const suffix = ` (+${bonus.remaining})`;
  const annotation = projectSuffix ? projectSuffix(suffix) : suffix;
  let start = 0, result = '';
  for (const end of offsets) {
    result += template.slice(start, end) + annotation;
    start = end;
  }
  return result + template.slice(start);
}
