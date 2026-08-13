const PUBLIC_SHORT_LINK_CODE_RE = /^[A-Za-z0-9_-]{10,16}$/;
const PUBLIC_SHORT_LINK_TARGET_MAX_LENGTH = 512;
const PUBLIC_SHORT_LINK_CHANNEL_UID_RE = /^(?:(?:chzzk|cime|youtube):)?[A-Za-z0-9_-]{1,128}$/i;
const VALIDATION_BASE_ORIGIN = 'https://arubot.invalid';

function canonicalPublicChannelUid(value) {
  return String(value || '').replace(/^(chzzk|cime|youtube):/i, (match, provider) => `${provider.toLowerCase()}:`);
}

export function isPublicShortLinkCode(value) {
  return PUBLIC_SHORT_LINK_CODE_RE.test(String(value || '').trim());
}

export function normalizePublicShortLinkTarget(rawValue) {
  const raw = String(rawValue || '').trim();
  if (
    !raw
    || raw.length > PUBLIC_SHORT_LINK_TARGET_MAX_LENGTH
    || !raw.startsWith('/')
    || raw.startsWith('//')
    || raw.includes('\\')
    || /[\u0000-\u001F\u007F]/.test(raw)
  ) return null;

  try {
    const suppliedPath = raw.split(/[?#]/, 1)[0];
    const suppliedSegments = suppliedPath.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (suppliedSegments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))) {
      return null;
    }
  } catch {
    return null;
  }

  let url;
  try {
    url = new URL(raw, VALIDATION_BASE_ORIGIN);
  } catch {
    return null;
  }
  if (url.origin !== VALIDATION_BASE_ORIGIN || url.username || url.password || url.hash) return null;

  let rawSegments;
  let segments;
  try {
    rawSegments = url.pathname.split('/').filter(Boolean);
    segments = rawSegments.map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
  if (
    rawSegments.length !== segments.length
    || segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\'))
  ) return null;

  const channelUid = segments[1] || '';
  const validChannelUid = PUBLIC_SHORT_LINK_CHANNEL_UID_RE.test(channelUid);
  const publicChannelPath = segments[0] === 'c'
    && validChannelUid
    && (
      segments.length === 2
      || (segments.length === 3 && ['commands', 'points', 'roulette', 'live'].includes(segments[2]))
      || (segments.length === 4 && segments[2] === 'roulette' && segments[3] === 'logs')
    );
  const publicDrawingPath = segments.length === 3
    && segments[0] === 'viewer'
    && segments[1] === 'drawing'
    && PUBLIC_SHORT_LINK_CHANNEL_UID_RE.test(segments[2]);
  if (publicChannelPath || publicDrawingPath) {
    if (url.search) return null;
    const canonicalSegments = [...segments];
    const uidIndex = publicChannelPath ? 1 : 2;
    canonicalSegments[uidIndex] = canonicalPublicChannelUid(canonicalSegments[uidIndex]);
    return `/${canonicalSegments.map((segment) => encodeURIComponent(segment)).join('/')}`;
  }

  if (url.pathname !== '/viewer/login') return null;
  const keys = Array.from(url.searchParams.keys());
  if (keys.length !== 1 || keys[0] !== 'returnTo') return null;
  const canonicalReturnTo = normalizePublicShortLinkTarget(url.searchParams.get('returnTo'));
  if (!canonicalReturnTo?.startsWith('/viewer/drawing/')) return null;
  return `/viewer/login?returnTo=${encodeURIComponent(canonicalReturnTo)}`;
}

export function publicShortLinkTargetChannelUid(targetPath) {
  const normalized = normalizePublicShortLinkTarget(targetPath);
  if (!normalized) return null;
  try {
    const url = new URL(normalized, VALIDATION_BASE_ORIGIN);
    const segments = url.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (segments[0] === 'c' && segments[1]) return segments[1];
    if (segments[0] === 'viewer' && segments[1] === 'drawing' && segments[2]) return segments[2];
    if (url.pathname === '/viewer/login') return publicShortLinkTargetChannelUid(url.searchParams.get('returnTo'));
  } catch { }
  return null;
}

export function normalizePublicShortLinkFrontendOrigin(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function buildPublicShortLinkUrl(code, frontendOrigin) {
  const normalizedCode = String(code || '').trim();
  const origin = normalizePublicShortLinkFrontendOrigin(frontendOrigin);
  return origin && isPublicShortLinkCode(normalizedCode)
    ? `${origin}/s/${encodeURIComponent(normalizedCode)}`
    : null;
}

export function buildPublicShortLinkRedirectUrl(targetPath, frontendOrigin) {
  const normalizedTarget = normalizePublicShortLinkTarget(targetPath);
  const origin = normalizePublicShortLinkFrontendOrigin(frontendOrigin);
  return normalizedTarget && origin ? new URL(normalizedTarget, origin).toString() : null;
}
