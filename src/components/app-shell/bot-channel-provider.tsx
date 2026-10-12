'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, LogIn, RefreshCw, UserRound } from 'lucide-react';
import { Button, LinkButton } from '@/components/ui/button';
import { getBrowserApiBase } from '@/shared/api/http';
import { adminNav, getBotPageModule } from '@/shared/config/navigation';
import {
  clearBotManagementContext, getBotManagementActor, getBotManagementOwner,
  hasBotManagementScope, retainBotManagementOwner, setBotManagementActor, setBotManagementOwner,
  type BotChannel, type BotManagementContext,
} from '@/shared/lib/bot-management-context';

type BotChannelContextValue = BotManagementContext & {
  canRead: (module: string) => boolean;
  canWrite: (module: string) => boolean;
  canManageMembers: boolean;
  refresh: () => Promise<void>;
  switchChannel: (ownerUserId: string | null) => Promise<void>;
  switching: boolean;
};

const BotChannelContext = createContext<BotChannelContextValue | null>(null);

class ContextRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function isChannel(value: unknown): value is BotChannel {
  if (!value || typeof value !== 'object') return false;
  const channel = value as Partial<BotChannel>;
  return typeof channel.ownerUserId === 'string' && Boolean(channel.ownerUserId)
    && typeof channel.displayName === 'string'
    && ['owner', 'manager', 'site_admin'].includes(String(channel.role))
    && Array.isArray(channel.scopes) && channel.scopes.every((scope) => typeof scope === 'string');
}

async function readContext(ownerId: string | null, signal: AbortSignal): Promise<BotManagementContext> {
  const query = ownerId ? `?botOwner=${encodeURIComponent(ownerId)}` : '';
  // Bootstrap uses the actor's session directly, never the generic bot URL resolver.
  const response = await fetch(`${getBrowserApiBase()}/api/bot-management/context${query}`, {
    credentials: 'include', cache: 'no-store', signal,
  });
  if (!response.ok) {
    throw new ContextRequestError(
      response.status === 401 ? '로그인이 필요합니다.'
        : response.status === 403 || response.status === 404 ? '이 채널을 관리할 권한이 없거나 권한이 만료되었습니다.'
          : '채널 관리 정보를 불러오지 못했습니다.', response.status,
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
}

function firstChannelPage(channel: BotChannel) {
  return adminNav.find((item) => {
    const module = getBotPageModule(item.href);
    return module && hasBotManagementScope(channel, module, 'read');
  })?.href || (hasBotManagementScope(channel, 'settings', 'read') ? '/settings' : '/dashboard');
}

// The hook intentionally shares this provider's context instance.
// eslint-disable-next-line react-refresh/only-export-components
export function useBotChannel() {
  const context = useContext(BotChannelContext);
  if (!context) throw new Error('useBotChannel must be used within BotChannelProvider');
  return context;
}

export function BotChannelProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<BotManagementContext | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'session'>('loading');
  const [error, setError] = useState('');
  const [switching, setSwitching] = useState(false);
  const request = useRef<AbortController | null>(null);
  const switchRequest = useRef<AbortController | null>(null);
  const dataRef = useRef<BotManagementContext | null>(null);
  const targetRef = useRef<string | null | undefined>(undefined);
  const actorRef = useRef<string | null>(null);

  const preserveRequestOwner = useCallback(() => {
    const ownerId = dataRef.current?.active.ownerUserId || targetRef.current || actorRef.current;
    // Unmounted features may still have delayed callbacks. Keep their request
    // target, including the previous actor when an own-channel session expires.
    if (ownerId) retainBotManagementOwner(ownerId);
  }, []);

  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const url = new URL(window.location.href);
    const explicitOwner = url.searchParams.get('botOwner');
    const storedActor = getBotManagementActor();
    const storedOwner = getBotManagementOwner();
    if (targetRef.current === undefined) targetRef.current = explicitOwner || storedOwner;
    if (!actorRef.current) actorRef.current = storedActor;
    const target = targetRef.current;
    try {
      const next = await readContext(target, controller.signal);
      const previousActor = actorRef.current;
      if (previousActor && previousActor !== next.actorUserId) {
        throw new Error('로그인 계정이 변경되었습니다. 내 채널로 돌아가 다시 선택해 주세요.');
      }
      if (controller.signal.aborted) return;
      if (dataRef.current && (dataRef.current.actorUserId !== next.actorUserId
        || dataRef.current.active.ownerUserId !== next.active.ownerUserId)) {
        throw new Error('관리 채널이 변경되었습니다. 내 채널로 돌아가 다시 선택해 주세요.');
      }
      setBotManagementActor(next.actorUserId);
      setBotManagementOwner(next.active.ownerUserId === next.actorUserId ? null : next.active.ownerUserId);
      actorRef.current = next.actorUserId;
      targetRef.current = next.active.ownerUserId === next.actorUserId ? null : next.active.ownerUserId;
      if (url.searchParams.has('botOwner')) {
        url.searchParams.delete('botOwner');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
      }
      dataRef.current = next;
      setData(next);
      setStatus('ready');
      setError('');
    } catch (cause) {
      if (controller.signal.aborted) return;
      preserveRequestOwner();
      setData(null);
      dataRef.current = null;
      setStatus(cause instanceof ContextRequestError && cause.status === 401 ? 'session' : 'error');
      setError(cause instanceof Error ? cause.message : '채널 관리 정보를 불러오지 못했습니다.');
    }
  }, [preserveRequestOwner]);

  useEffect(() => {
    void refresh();
    const expired = () => {
      request.current?.abort();
      switchRequest.current?.abort();
      preserveRequestOwner();
      dataRef.current = null;
      setData(null);
      setStatus('session');
    };
    const revalidate = () => { if (document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(() => {
      if (dataRef.current && document.visibilityState === 'visible') void refresh();
    }, 30_000);
    const restored = (event: PageTransitionEvent) => {
      // A history-restored page can contain another channel's unsaved state.
      if (event.persisted) {
        setStatus('loading');
        window.location.reload();
      }
    };
    window.addEventListener('arubot:session-expired', expired);
    window.addEventListener('arubot:logout', expired);
    window.addEventListener('arubot:auth-changed', revalidate);
    window.addEventListener('pageshow', restored);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      request.current?.abort();
      switchRequest.current?.abort();
      window.clearInterval(interval);
      window.removeEventListener('arubot:session-expired', expired);
      window.removeEventListener('arubot:logout', expired);
      window.removeEventListener('arubot:auth-changed', revalidate);
      window.removeEventListener('pageshow', restored);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, [refresh, preserveRequestOwner]);

  const switchChannel = useCallback(async (ownerUserId: string | null) => {
    const current = dataRef.current;
    if (!current || switchRequest.current) return;
    const target = ownerUserId || current.actorUserId;
    if (target === current.active.ownerUserId) return;
    const controller = new AbortController();
    switchRequest.current = controller;
    setSwitching(true);
    try {
      const next = await readContext(target, controller.signal);
      if (next.actorUserId !== current.actorUserId) {
        await refresh();
        throw new Error('로그인 계정이 변경되었습니다. 채널을 다시 선택해 주세요.');
      }
      if (!window.confirm(`${next.active.displayName || '선택한 채널'} 채널로 전환할까요? 저장하지 않은 변경 사항은 사라집니다.`)) return;
      // Do not mutate the current tab's request owner before unloading. Native
      // beforeunload may cancel navigation; the old page must keep its old owner.
      window.location.assign(`${firstChannelPage(next.active)}?botOwner=${encodeURIComponent(target)}`);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ContextRequestError && cause.status === 401) {
        window.dispatchEvent(new Event('arubot:session-expired'));
      }
      throw cause;
    } finally {
      if (switchRequest.current === controller) switchRequest.current = null;
      if (!controller.signal.aborted) setSwitching(false);
    }
  }, [refresh]);

  const value = useMemo<BotChannelContextValue | null>(() => data ? {
    ...data,
    canRead: (module) => hasBotManagementScope(data.active, module, 'read'),
    canWrite: (module) => hasBotManagementScope(data.active, module, 'write'),
    canManageMembers: data.active.role === 'owner' || data.active.role === 'site_admin',
    refresh, switchChannel, switching,
  } : null, [data, refresh, switchChannel, switching]);

  if (status !== 'ready' || !value) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <a href="/" className="text-lg font-bold">AruBot</a>
        {status === 'loading' ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />채널 권한 확인 중</p>
        ) : (
          <>
            <p role="alert" className="max-w-md text-sm text-muted-foreground">{status === 'session' ? '세션이 만료되었거나 로그인이 필요합니다.' : error}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {status === 'session' ? (
                <LinkButton href="/viewer/login?returnTo=%2Fdashboard"><LogIn className="h-4 w-4" />로그인</LinkButton>
              ) : (
                <>
                  <Button onClick={() => { setStatus('loading'); void refresh(); }}><RefreshCw className="h-4 w-4" />다시 확인</Button>
                  <Button variant="outline" onClick={() => { clearBotManagementContext(); window.location.assign('/dashboard'); }}><UserRound className="h-4 w-4" />내 채널로 돌아가기</Button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
  return <BotChannelContext.Provider value={value}><div key={`${value.actorUserId}:${value.active.ownerUserId}`}>{children}</div></BotChannelContext.Provider>;
}
