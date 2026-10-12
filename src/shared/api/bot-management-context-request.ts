import { getBrowserApiBase } from '@/shared/api/http';
import type { BotChannel, BotManagementContext } from '@/shared/lib/bot-management-context';

export class ContextRequestError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs = 0) { super(message); }
}

export function isRetryableContextError(cause: unknown): cause is ContextRequestError {
  return cause instanceof ContextRequestError
    && (cause.status === 0 || cause.status === 408 || cause.status === 429 || cause.status >= 500);
}

export function contextRetryDelay(attempt: number, cause: ContextRequestError) {
  return Math.max(Math.min(30_000, 2000 * 2 ** Math.min(Math.max(0, attempt), 4)), cause.retryAfterMs);
}

function isChannel(value: unknown): value is BotChannel {
  if (!value || typeof value !== 'object') return false;
  const channel = value as Partial<BotChannel>;
  return typeof channel.ownerUserId === 'string' && Boolean(channel.ownerUserId)
    && typeof channel.displayName === 'string'
    && ['owner', 'manager', 'site_admin'].includes(String(channel.role))
    && Array.isArray(channel.scopes) && channel.scopes.every((scope) => typeof scope === 'string');
}

export async function readContext(ownerId: string | null, signal: AbortSignal): Promise<BotManagementContext> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 10_000);
  try {
    const query = ownerId ? `?botOwner=${encodeURIComponent(ownerId)}` : '';
    // Bootstrap uses the actor's session directly, never the generic bot URL resolver.
    const response = await fetch(`${getBrowserApiBase()}/api/bot-management/context${query}`, {
      credentials: 'include', cache: 'no-store', signal: controller.signal,
    });
    if (!response.ok) {
      const retryAfter = response.headers.get('Retry-After');
      const delay = retryAfter ? (/^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
      throw new ContextRequestError(
        response.status === 401 ? '로그인이 필요합니다.'
          : response.status === 403 || response.status === 404 ? '이 채널을 관리할 권한이 없거나 권한이 만료되었습니다.'
            : response.status === 408 || response.status === 429 || response.status >= 500
              ? '채널 관리 서버에 일시적으로 연결할 수 없습니다. 자동으로 다시 확인합니다.'
              : '채널 관리 정보를 불러오지 못했습니다.',
        response.status, Number.isFinite(delay) ? Math.max(0, Math.min(300_000, delay)) : 0,
      );
    }
    const result: unknown = await response.json();
    const data = result as Partial<BotManagementContext> | null;
    if (!data || typeof data.actorUserId !== 'string' || !data.actorUserId
      || typeof data.isSiteAdmin !== 'boolean' || !isChannel(data.active)
      || !Array.isArray(data.channels) || !data.channels.every(isChannel)
      || !Array.isArray(data.scopeGroups)) throw new Error('채널 관리 응답을 확인할 수 없습니다.');
    if (ownerId && data.active.ownerUserId !== ownerId) throw new Error('요청한 채널과 응답한 채널이 다릅니다. 다시 선택해 주세요.');
    return data as BotManagementContext;
  } catch (cause) {
    if (signal.aborted) throw cause;
    if (timedOut) throw new ContextRequestError('채널 권한 확인이 지연되고 있습니다. 자동으로 다시 확인합니다.', 408);
    if (cause instanceof TypeError || (cause instanceof Error && cause.name === 'NetworkError')) {
      throw new ContextRequestError('서버 연결이 잠시 끊겼습니다. 자동으로 다시 연결합니다.', 0);
    }
    throw cause;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}
