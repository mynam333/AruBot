import { apiUrl } from '@/shared/api/http';

type ShortLinkPayload = {
  shortPath?: string;
};

const SHORT_LINK_PATH_PATTERN = /^\/s\/[A-Za-z0-9_-]{10,16}$/;
const SHORT_LINK_CACHE_LIMIT = 64;
const shortLinkRequests = new Map<string, Promise<string>>();

function normalizeTargetPath(value: string) {
  const input = String(value || '').trim();
  if (!input || typeof window === 'undefined') throw new Error('share_target_unavailable');
  const url = new URL(input, window.location.origin);
  if (url.origin !== window.location.origin || url.hash) throw new Error('share_target_invalid');
  return `${url.pathname}${url.search}`;
}

function rememberShortLink(path: string, request: Promise<string>) {
  shortLinkRequests.set(path, request);
  while (shortLinkRequests.size > SHORT_LINK_CACHE_LIMIT) {
    const oldestKey = shortLinkRequests.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    shortLinkRequests.delete(oldestKey);
  }
  request.catch(() => {
    if (shortLinkRequests.get(path) === request) shortLinkRequests.delete(path);
  });
  return request;
}

export async function createShortShareUrl(target: string) {
  const path = normalizeTargetPath(target);
  const cached = shortLinkRequests.get(path);
  if (cached) return cached;

  const request = (async () => {
    const response = await fetch(apiUrl('/api/short-links'), {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!response.ok) throw new Error(`short_link_request_failed:${response.status}`);
    const payload = await response.json() as ShortLinkPayload;
    const shortPath = String(payload.shortPath || '').trim();
    if (!SHORT_LINK_PATH_PATTERN.test(shortPath)) throw new Error('short_link_response_invalid');
    return new URL(shortPath, window.location.origin).toString();
  })();

  return rememberShortLink(path, request);
}

export async function writeClipboardText(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Continue with the selection-based fallback below.
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard_unavailable');
}
