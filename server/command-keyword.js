function normalizeKeyword(value) {
  return String(value || '').trim();
}

function hasCommandBoundary(source, keywordLength) {
  return source.length === keywordLength || /\s/u.test(source.charAt(keywordLength));
}

export function findCommandKeywordMatch(text, keywords = []) {
  const source = String(text || '').trim();
  if (!source) return null;
  const sourceLower = source.toLowerCase();
  const candidates = [];

  for (const [keywordIndex, rawKeyword] of (Array.isArray(keywords) ? keywords : [keywords]).entries()) {
    const configuredKeyword = normalizeKeyword(rawKeyword);
    if (!configuredKeyword || configuredKeyword === '!') continue;
    const configuredLower = configuredKeyword.toLowerCase();
    if (!sourceLower.startsWith(configuredLower) || !hasCommandBoundary(source, configuredKeyword.length)) continue;
    candidates.push({
      configuredKeyword,
      matchedText: source.slice(0, configuredKeyword.length),
      argsText: source.slice(configuredKeyword.length).trim(),
      exactConfigured: true,
      keywordIndex,
    });
  }

  candidates.sort((left, right) => (
    right.matchedText.length - left.matchedText.length ||
    right.configuredKeyword.length - left.configuredKeyword.length ||
    left.keywordIndex - right.keywordIndex
  ));
  return candidates[0] || null;
}

export function getCommandRuleMatches(text, rules = []) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule, ruleIndex) => ({ rule, ruleIndex, match: findCommandKeywordMatch(text, rule?.keywords || []) }))
    .filter((candidate) => candidate.match)
    .sort((left, right) => (
      right.match.matchedText.length - left.match.matchedText.length ||
      right.match.configuredKeyword.length - left.match.configuredKeyword.length ||
      left.ruleIndex - right.ruleIndex
    ));
}
