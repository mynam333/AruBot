const TOKEN = /\$\{\s*songbook_(request|url)\s*\}/ig;

export function songbookCommandKinds(rule) {
  const kinds = new Set();
  for (const response of rule?.responses || []) {
    if (typeof response !== 'string') continue;
    for (const match of response.matchAll(new RegExp(TOKEN))) kinds.add(match[1].toLowerCase());
  }
  return [...kinds];
}

export function hasSongbookCommandToken(text) {
  return new RegExp(TOKEN).test(String(text || ''));
}

export function replaceSongbookCommandTokens(text, values) {
  return String(text || '').replace(new RegExp(TOKEN), (_, kind) => values[kind.toLowerCase()] || '');
}

export function songbookCommandTemplate(kind, id) {
  const request = kind === 'request';
  return { id, name: request ? '노래 신청' : '노래책 안내', keywords: [request ? '!노래신청' : '!노래책'],
    responses: [request ? '${songbook_request}' : '노래책: ${songbook_url}'],
    enabled: true, adminOnly: false, requiredRoleLevel: 1, pointsCost: 0, cooldown: 3000, lastUsed: 0 };
}

export function commandEditVersion(rule) {
  if (!rule) return null;
  return JSON.stringify(Object.keys(rule).filter(key => key !== 'lastUsed').sort().map(key => [key, rule[key]]));
}

export function songbookTriggerConflict(rule, rules) {
  if (!Array.isArray(rule?.keywords)) return null;
  const keys = new Set(rule.keywords.map(value => String(value).trim().toLowerCase()));
  return rules.find(other => other.id !== rule.id && (songbookCommandKinds(rule).length || songbookCommandKinds(other).length)
    && (other.keywords || []).some(value => keys.has(String(value).trim().toLowerCase()))) || null;
}

// Exact title takes precedence; artist + title and UUID disambiguate duplicates.
export function matchSongbookSongs(songs, query) {
  const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const text = normalize(query);
  const available = songs.filter(song => song.visible !== false && song.requestable !== false);
  if (!text) return [];
  const exact = available.filter(song => [song.id, song.title, `${song.artist} ${song.title}`, `${song.title} ${song.artist}`,
    `${song.artist} - ${song.title}`, `${song.title} - ${song.artist}`].some(value => normalize(value) === text));
  if (exact.length) return exact;
  const terms = text.split(' ');
  return available.filter(song => terms.every(term => normalize(`${song.title} ${song.artist}`).includes(term)));
}
