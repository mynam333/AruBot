const LIVE_CHANGE_TOKEN_PATTERN = /\$\{\s*live\.(title_change|game_change)\s*\}/ig;

export function inspectLiveChangeTokens(text) {
  const source = String(text || '');
  const actions = new Set();
  for (const match of source.matchAll(LIVE_CHANGE_TOKEN_PATTERN)) {
    const action = String(match?.[1] || '').toLowerCase();
    if (action) actions.add(action);
  }
  return {
    source,
    titleRequested: actions.has('title_change'),
    gameRequested: actions.has('game_change'),
    used: actions.size > 0,
  };
}

export function stripLiveChangeTokens(text) {
  return String(text || '').replace(LIVE_CHANGE_TOKEN_PATTERN, '').trim();
}

export async function executeAndStripLiveChangeTokens(text, options = {}) {
  const inspected = inspectLiveChangeTokens(text);
  const cleaned = stripLiveChangeTokens(inspected.source);
  const provider = String(options.provider || '').trim().toLowerCase();
  const argsText = String(options.argsText || '').trim();
  const result = {
    text: cleaned,
    used: inspected.used,
    provider,
    argsText,
    requested: [],
    executed: [],
    errors: [],
  };

  if (inspected.titleRequested) result.requested.push('title_change');
  if (inspected.gameRequested) result.requested.push('game_change');
  if (!inspected.used || !argsText || !['chzzk', 'cime'].includes(provider)) return result;

  const run = async (name, handler) => {
    if (typeof handler !== 'function') return;
    try {
      await handler(argsText);
      result.executed.push(name);
    } catch (error) {
      result.errors.push({ name, error });
    }
  };

  if (inspected.titleRequested) await run('title_change', options.changeTitle);
  if (inspected.gameRequested) await run('game_change', options.changeGame);
  return result;
}

export function selectCategorySearchResult(items, query) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return null;
  const normalize = (value) => String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('ko-KR');
  const target = normalize(query);
  return list.find((item) => normalize(item?.categoryValue) === target) || list[0] || null;
}

export function filterLiveInfoByProvider(info, provider) {
  if (!info) return null;
  const expected = String(provider || '').trim().toLowerCase();
  if (!expected) return info;
  const actual = String(info?.provider || '').trim().toLowerCase();
  return actual === expected ? info : null;
}
