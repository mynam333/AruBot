'use client';

import * as Popover from '@radix-ui/react-popover';
import { ArrowLeft, Check, ChevronsUpDown, Loader2, Search, UserRound } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getBrowserApiBase } from '@/shared/api/http';
import { botChannelRoleLabel, type BotChannel } from '@/shared/lib/bot-management-context';
import { cn } from '@/shared/lib/utils';

function ChannelAvatar({ channel }: { channel: BotChannel }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
      {channel.avatarUrl && failedUrl !== channel.avatarUrl ? (
        <img src={channel.avatarUrl} onError={() => setFailedUrl(channel.avatarUrl)} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
      ) : <UserRound className="h-4 w-4 text-muted-foreground" />}
    </span>
  );
}

export function BotChannelSwitcher() {
  const { active, actorUserId, channels, isSiteAdmin, switchChannel, switching } = useBotChannel();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BotChannel[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [switchError, setSwitchError] = useState('');
  const inputId = useId();
  const search = query.trim().slice(0, 100);
  const delegated = active.ownerUserId !== actorUserId;

  useEffect(() => {
    setResults([]);
    setSearchError('');
    if (!open || !isSiteAdmin || search.length < 2) { setSearching(false); return; }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${getBrowserApiBase()}/api/bot-management/channels?q=${encodeURIComponent(search)}&limit=20`, {
          credentials: 'include', cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 401) window.dispatchEvent(new Event('arubot:session-expired'));
        if (!response.ok) throw new Error('채널을 검색하지 못했습니다.');
        const data = await response.json() as { channels?: BotChannel[] };
        if (!controller.signal.aborted) setResults(Array.isArray(data.channels) ? data.channels.slice(0, 20) : []);
      } catch (cause) {
        if (!controller.signal.aborted) setSearchError(cause instanceof Error ? cause.message : '검색에 실패했습니다.');
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, isSiteAdmin, search]);

  const choose = async (ownerId: string | null) => {
    setSwitchError('');
    try { await switchChannel(ownerId); }
    catch (cause) { setSwitchError(cause instanceof Error ? cause.message : '채널 전환에 실패했습니다.'); }
  };
  const known = Array.from(new Map([active, ...channels].map((channel) => [channel.ownerUserId, channel])).values());
  const matching = known.filter((channel) => !search || `${channel.displayName} ${channel.provider || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const own = known.find((channel) => channel.ownerUserId === actorUserId);
  const groups = [
    { title: '내 채널', items: matching.filter((channel) => channel.ownerUserId === actorUserId) },
    { title: '관리하는 채널', items: matching.filter((channel) => channel.ownerUserId !== actorUserId) },
    { title: '전체 채널 검색', items: results.filter((channel) => !matching.some((item) => item.ownerUserId === channel.ownerUserId)) },
  ];

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-lg">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button type="button" className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`관리 채널 선택: ${active.displayName || '이름 없는 채널'}, ${botChannelRoleLabel(active.role)}`}>
            <ChannelAvatar channel={active} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold" title={active.displayName}>{active.displayName || '이름 없는 채널'}</span>
              <span className="block text-[0.6875rem] text-muted-foreground">{active.provider?.toUpperCase() || '연결된 플랫폼 없음'}</span>
            </span>
            <Badge tone={delegated ? 'amber' : 'neutral'}>{botChannelRoleLabel(active.role)}</Badge>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" sideOffset={6} collisionPadding={12} className="z-[70] w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-lg border bg-card text-foreground shadow-xl outline-none">
            <div className="border-b p-3">
              <label htmlFor={inputId} className="mb-2 block text-xs font-semibold">{isSiteAdmin ? '채널 선택 · 전체 채널 검색' : '채널 선택'}</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input id={inputId} value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder={isSiteAdmin ? '채널명 검색 (2자 이상)' : '관리하는 채널 검색'} className="pl-9" autoComplete="off" />
              </div>
            </div>
            <div className="max-h-[min(24rem,55dvh)] overflow-y-auto overscroll-contain p-1.5" aria-label="전환 가능한 채널">
              {!own && !search ? (
                <button type="button" disabled={switching} onClick={() => void choose(null)} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted disabled:opacity-50"><UserRound className="h-4 w-4" />내 채널<Badge>플랫폼 미연결</Badge></button>
              ) : null}
              {groups.map((group) => group.items.length > 0 ? (
                <section key={group.title} aria-label={group.title}>
                  <div className="px-2.5 pb-1 pt-2 text-[0.6875rem] font-semibold text-muted-foreground">{group.title}</div>
                  {group.items.map((channel) => (
                    <button key={channel.ownerUserId} type="button" disabled={switching} aria-pressed={channel.ownerUserId === active.ownerUserId} onClick={() => void choose(channel.ownerUserId === actorUserId ? null : channel.ownerUserId)} className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50', channel.ownerUserId === active.ownerUserId && 'bg-primary/10')}>
                      <ChannelAvatar channel={channel} />
                      <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{channel.displayName || '이름 없는 채널'}</span><span className="text-[0.6875rem] text-muted-foreground">{channel.provider?.toUpperCase() || '플랫폼 미연결'} · {botChannelRoleLabel(channel.role)}</span></span>
                      {channel.ownerUserId === active.ownerUserId ? <Check className="h-4 w-4 shrink-0 text-primary" aria-label="현재 채널" /> : null}
                    </button>
                  ))}
                </section>
              ) : null)}
              {searching ? <p role="status" className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />채널 검색 중</p> : null}
              {!searching && search && !groups.some((group) => group.items.length) && !searchError ? <p role="status" className="px-3 py-4 text-sm text-muted-foreground">{isSiteAdmin && search.length < 2 ? '검색어를 2자 이상 입력해 주세요.' : '검색된 채널이 없습니다.'}</p> : null}
            </div>
            {searchError || switchError ? <p role="alert" className="border-t px-3 py-2 text-sm text-destructive">{switchError || searchError}</p> : null}
            {switching ? <p role="status" className="border-t px-3 py-2 text-xs text-muted-foreground">채널 권한 확인 중</p> : null}
            {delegated ? <div className="border-t p-2"><Button variant="ghost" size="sm" disabled={switching} className="w-full justify-start" onClick={() => void choose(null)}><ArrowLeft className="h-4 w-4" />내 채널로 돌아가기</Button></div> : null}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {delegated ? <Button variant="ghost" size="sm" disabled={switching} className="hidden shrink-0 sm:inline-flex" onClick={() => { setOpen(true); void choose(null); }}><ArrowLeft className="h-4 w-4" />내 채널</Button> : null}
    </div>
  );
}
