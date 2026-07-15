import crypto from 'crypto';

const STATE_VERSION = 'v2';

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function normalizeSignedExtra(extra) {
  const source = extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
  const normalized = {};
  const mode = String(source.mode || '').trim();
  const returnTo = String(source.returnTo || '').trim();
  if (mode) normalized.mode = mode.slice(0, 40);
  if (returnTo) normalized.returnTo = returnTo.slice(0, 1200);
  return normalized;
}

function sign(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function createOAuthStateToken({ provider, secret, extra = {}, now = Date.now(), nonce } = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedSecret = String(secret || '');
  if (!normalizedProvider || !normalizedSecret) throw new Error('OAuth state provider and secret are required');
  const issuedAt = Math.floor(Number(now));
  if (!Number.isFinite(issuedAt)) throw new Error('OAuth state timestamp is invalid');
  const normalizedNonce = String(nonce || crypto.randomBytes(16).toString('hex')).trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedNonce)) throw new Error('OAuth state nonce is invalid');

  const payload = base64UrlEncode(JSON.stringify({
    v: 2,
    p: normalizedProvider,
    n: normalizedNonce,
    i: issuedAt,
    e: normalizeSignedExtra(extra),
  }));
  const unsigned = `${STATE_VERSION}.${payload}`;
  return `${unsigned}.${sign(normalizedSecret, unsigned)}`;
}

function verifyLegacyState(provider, state, secret, ttlMs, now) {
  if (!/^[a-f0-9]{76}$/i.test(state)) return { ok: false, reason: 'format', version: 1, extra: {} };
  const nonce = state.slice(0, 32);
  const tsHex = state.slice(32, 44);
  const signature = state.slice(44, 76).toLowerCase();
  const issuedAt = Number.parseInt(tsHex, 16);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'timestamp', version: 1, extra: {} };
  const age = now - issuedAt;
  if (age < -60 * 1000 || age > ttlMs) return { ok: false, reason: 'expired', version: 1, age, extra: {} };
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${provider}:${nonce}:${tsHex}`)
    .digest('hex')
    .slice(0, 32);
  const ok = safeEqual(signature, expected);
  return { ok, reason: ok ? null : 'signature', version: 1, age, extra: {} };
}

export function verifyOAuthStateToken({ provider, state, secret, ttlMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedState = String(state || '').trim();
  const normalizedSecret = String(secret || '');
  const currentTime = Math.floor(Number(now));
  if (!normalizedProvider || !normalizedState || !normalizedSecret || !Number.isFinite(currentTime)) {
    return { ok: false, reason: 'format', version: null, extra: {} };
  }
  if (!normalizedState.startsWith(`${STATE_VERSION}.`)) {
    return verifyLegacyState(normalizedProvider, normalizedState, normalizedSecret, ttlMs, currentTime);
  }
  if (normalizedState.length > 4096) return { ok: false, reason: 'format', version: 2, extra: {} };

  const parts = normalizedState.split('.');
  if (parts.length !== 3 || !parts[1] || !parts[2]) {
    return { ok: false, reason: 'format', version: 2, extra: {} };
  }
  const unsigned = `${parts[0]}.${parts[1]}`;
  if (!safeEqual(parts[2], sign(normalizedSecret, unsigned))) {
    return { ok: false, reason: 'signature', version: 2, extra: {} };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'payload', version: 2, extra: {} };
  }
  if (payload?.v !== 2 || payload?.p !== normalizedProvider || !/^[a-f0-9]{32}$/.test(String(payload?.n || ''))) {
    return { ok: false, reason: payload?.p !== normalizedProvider ? 'provider' : 'payload', version: 2, extra: {} };
  }
  const issuedAt = Number(payload.i);
  if (!Number.isFinite(issuedAt)) return { ok: false, reason: 'timestamp', version: 2, extra: {} };
  const age = currentTime - issuedAt;
  if (age < -60 * 1000 || age > ttlMs) return { ok: false, reason: 'expired', version: 2, age, extra: {} };
  return { ok: true, reason: null, version: 2, age, extra: normalizeSignedExtra(payload.e) };
}

function firstForwardedValue(value) {
  return String(value || '').split(',')[0].trim();
}

export function resolveOAuthRequestOrigin({ protocol, host, forwardedProto, forwardedHost } = {}) {
  const normalizedProtocol = (firstForwardedValue(forwardedProto) || String(protocol || ''))
    .replace(/:$/, '')
    .toLowerCase();
  const normalizedHost = firstForwardedValue(forwardedHost) || firstForwardedValue(host);
  if (!['http', 'https'].includes(normalizedProtocol) || !normalizedHost) return null;
  try {
    return new URL(`${normalizedProtocol}://${normalizedHost}`).origin;
  } catch {
    return null;
  }
}

export function buildCanonicalOAuthStartUrl({ requestOrigin, originalUrl, redirectUri } = {}) {
  try {
    const callback = new URL(String(redirectUri || ''));
    const normalizedRequestOrigin = new URL(String(requestOrigin || '')).origin;
    if (callback.origin === normalizedRequestOrigin) return null;
    const rawPath = String(originalUrl || '/');
    const local = new URL(`/${rawPath.replace(/^\/+/, '')}`, 'http://oauth-start.local');
    callback.pathname = local.pathname;
    callback.search = local.search;
    callback.hash = '';
    return callback.toString();
  } catch {
    return null;
  }
}
