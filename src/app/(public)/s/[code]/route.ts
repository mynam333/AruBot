import { serverApiUrl } from '@/shared/api/server';

type ShortLinkResolution = {
  path?: string;
};

const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{10,16}$/;
const SHORT_LINK_RESOLVE_TIMEOUT_MS = 6_000;

export const dynamic = 'force-dynamic';

function hasControlCharacter(value: string) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function safeRedirectPath(value: unknown) {
  const path = typeof value === 'string' ? value.trim() : '';
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || hasControlCharacter(path)) return null;
  return path;
}

function textResponse(message: string, status: number) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Robots-Tag': 'noindex, follow',
    },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!SHORT_CODE_PATTERN.test(code)) return textResponse('공유 링크를 찾을 수 없습니다.', 404);

  try {
    const response = await fetch(serverApiUrl(`/api/public/short-links/${encodeURIComponent(code)}`), {
      cache: 'no-store',
      signal: AbortSignal.timeout(SHORT_LINK_RESOLVE_TIMEOUT_MS),
    });
    if (response.status === 404) return textResponse('공유 링크를 찾을 수 없습니다.', 404);
    if (!response.ok) return textResponse('공유 링크를 잠시 불러올 수 없습니다.', 503);

    const payload = await response.json() as ShortLinkResolution;
    const path = safeRedirectPath(payload.path);
    if (!path) return textResponse('공유 링크를 찾을 수 없습니다.', 404);
    return new Response(null, {
      status: 307,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Location: path,
        'X-Robots-Tag': 'noindex, follow',
      },
    });
  } catch {
    return textResponse('공유 링크를 잠시 불러올 수 없습니다.', 503);
  }
}
