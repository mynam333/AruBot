'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Switch from '@radix-ui/react-switch';
import { AlertTriangle, Check, ChevronDown, Loader2, LockKeyhole, Pencil, RefreshCw, Search, ShieldCheck, Trash2, UserRound, UserRoundPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { readJsonResult } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';

type ScopeGroup = { key: string; label: string; description?: string };
type ManagerMember = {
  id: string;
  memberUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  scopes?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};
type SearchUser = {
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  provider?: string | null;
  channelId?: string | null;
};
type MembersResponse = {
  members?: ManagerMember[] | null;
  scopeGroups?: ScopeGroup[] | null;
  canManage?: boolean;
};

const defaultGroups: ScopeGroup[] = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'connection', label: '봇 연결' },
  { key: 'commands', label: '채팅 명령어' },
  { key: 'macros', label: '자동 알림' },
  { key: 'points', label: '포인트' },
  { key: 'predictions', label: '예측' },
  { key: 'roulette', label: '룰렛' },
  { key: 'wheel', label: '돌림판' },
  { key: 'video', label: '영상 후원 · BGM' },
  { key: 'songbook', label: '노래책' },
  { key: 'emotes', label: '이모티콘 오버레이' },
  { key: 'drawing', label: '그림 후원' },
  { key: 'donations', label: '후원' },
  { key: 'automations', label: '자동화' },
  { key: 'actions', label: '액션' },
  { key: 'logs', label: '이벤트 로그' },
  { key: 'settings', label: '봇 설정' },
];

function getScopeGroups(value: MembersResponse['scopeGroups']): ScopeGroup[] {
  const groups = Array.isArray(value) ? value : [];
  return defaultGroups.map((fallback) => {
    const group = groups.find((item) => item?.key === fallback.key);
    return {
      ...fallback,
      label: typeof group?.label === 'string' && group.label.trim() ? group.label : fallback.label,
      description: typeof group?.description === 'string' ? group.description : undefined,
    };
  });
}

function normalizeScopes(value: ManagerMember['scopes']): string[] {
  const scopes = new Set(Array.isArray(value) ? value.filter((scope) => typeof scope === 'string' && scope.length > 0) : []);
  if (scopes.has('*')) return ['*'];
  for (const scope of scopes) {
    if (scope.endsWith(':write')) scopes.add(`${scope.slice(0, -6)}:read`);
  }
  return [...scopes].sort();
}

function setScopePermission(scopes: string[], key: string, permission: 'read' | 'write', enabled: boolean): string[] {
  const next = new Set(scopes.filter((scope) => scope !== '*'));
  const scope = `${key}:${permission}`;
  if (enabled) next.add(scope);
  else next.delete(scope);
  if (permission === 'write' && enabled) next.add(`${key}:read`);
  if (permission === 'read' && !enabled) next.delete(`${key}:write`);
  return normalizeScopes([...next]);
}

function uniqueMembers(value: MembersResponse['members']): ManagerMember[] {
  const members = new Map<string, ManagerMember>();
  for (const member of Array.isArray(value) ? value : []) {
    if (typeof member?.id === 'string' && member.id && typeof member.memberUserId === 'string' && member.memberUserId) {
      members.set(member.memberUserId, member);
    }
  }
  return [...members.values()];
}

function uniqueSearchUsers(value: SearchUser[] | null | undefined): SearchUser[] {
  const users = new Map<string, SearchUser>();
  for (const user of Array.isArray(value) ? value : []) {
    if (typeof user?.userId === 'string' && user.userId) users.set(user.userId, user);
    if (users.size === 20) break;
  }
  return [...users.values()];
}

function providerLabel(provider?: string | null) {
  const labels: Record<string, string> = { chzzk: '치지직', youtube: 'YouTube', cime: '치메', google: 'Google', naver: '네이버', twitch: 'Twitch' };
  return labels[String(provider || '').toLowerCase()] || provider || '연결 계정';
}

function errorMessage(status: number | null, fallback: string) {
  if (status === 401) return '로그인이 필요합니다. 다시 로그인한 뒤 시도해 주세요.';
  if (status === 403) return '이 채널의 관리자 권한을 변경할 수 없습니다.';
  if (status === 429) return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  return fallback;
}

function AccountIdentity({ user, compact = false }: { user: SearchUser; compact?: boolean }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const image = user.avatarUrl && /^(https?:\/\/|\/(?!\/))/.test(user.avatarUrl) ? user.avatarUrl : null;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted text-muted-foreground', compact ? 'h-9 w-9' : 'h-11 w-11')}>
        {image && failedImage !== image ? (
          <img src={image} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedImage(image)} />
        ) : <UserRound className="h-5 w-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0 text-left">
        <div className="break-all text-sm font-semibold leading-5">{user.displayName || '이름 없는 계정'}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{providerLabel(user.provider)}</div>
        <div className="mt-1 break-all font-mono text-[11px] leading-4 text-muted-foreground">계정 ID: {user.userId}</div>
        {user.channelId && user.channelId !== user.userId ? <div className="mt-0.5 break-all font-mono text-[11px] leading-4 text-muted-foreground">채널 ID: {user.channelId}</div> : null}
      </div>
    </div>
  );
}

function asSearchUser(member: ManagerMember): SearchUser {
  return { userId: member.memberUserId, displayName: member.displayName, provider: member.provider, avatarUrl: member.avatarUrl };
}

function AccountSearch({ ownerUserId, members, onSelect }: { ownerUserId: string; members: ManagerMember[]; onSelect: (user: SearchUser) => void }) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ query: string; users: SearchUser[]; error: string | null } | null>(null);
  const search = query.trim();
  const ready = search.length >= 2;
  const current = result?.query === search ? result : null;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await readJsonResult<{ users?: SearchUser[] | null }>(`/api/bot-management/users?q=${encodeURIComponent(search)}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setResult(response.ok
          ? { query: search, users: uniqueSearchUsers(response.data?.users), error: null }
          : { query: search, users: [], error: errorMessage(response.status, '계정을 검색하지 못했습니다. 다시 시도해 주세요.') });
      } catch {
        if (!controller.signal.aborted) setResult({ query: search, users: [], error: '계정을 검색하지 못했습니다. 다시 시도해 주세요.' });
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [search, ready, retry]);

  return (
    <section aria-label="등록된 계정 검색" className="space-y-3">
      <label htmlFor={inputId} className="block text-sm font-semibold">추가할 계정</label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input id={inputId} type="search" autoComplete="off" value={query} maxLength={80} placeholder="닉네임 또는 계정 ID (2자 이상)" className="pl-9" aria-describedby={`${inputId}-status`} onChange={(event) => { setQuery(event.target.value); setResult(null); }} />
      </div>
      <div id={`${inputId}-status`} role="status" aria-live="polite" className="text-xs text-muted-foreground">
        {!ready ? '아루봇에 등록된 계정만 검색됩니다.' : !current ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />계정 검색 중</span> : current.error ? null : current.users.length ? `검색 결과 ${current.users.length}명` : '검색 결과가 없습니다.'}
      </div>
      {current?.error ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-sm text-destructive">
          <span>{current.error}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { setResult(null); setRetry((value) => value + 1); }}><RefreshCw className="h-3.5 w-3.5" />다시 검색</Button>
        </div>
      ) : null}
      {current?.users.length ? (
        <ul aria-label="계정 검색 결과" className="max-h-64 divide-y overflow-y-auto border-y">
          {current.users.map((user) => {
            const unavailable = user.userId === ownerUserId ? '채널 소유자' : members.some((member) => member.memberUserId === user.userId) ? '이미 등록됨' : null;
            return (
              <li key={user.userId}>
                <button type="button" disabled={Boolean(unavailable)} onClick={() => onSelect(user)} className="flex w-full items-start justify-between gap-3 px-2 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60">
                  <AccountIdentity user={user} compact />
                  <span className="shrink-0 pt-0.5 text-xs font-medium text-muted-foreground">{unavailable || '선택'}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function PermissionEditor({ scopes, groups, disabled, onChange }: { scopes: string[]; groups: ScopeGroup[]; disabled: boolean; onChange: (scopes: string[]) => void }) {
  const switchId = useId();
  const full = scopes.includes('*');
  const all = groups.flatMap((group) => [`${group.key}:read`, `${group.key}:write`]);
  return (
    <section className="space-y-4" aria-label="운영 권한">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label htmlFor={switchId} className="block text-sm font-semibold">전체 운영 권한</label>
          <p id={`${switchId}-description`} className="mt-1 text-xs leading-5 text-muted-foreground">관리자 등록, 개인 인증 및 보안 연결 권한은 제외됩니다.</p>
        </div>
        <Switch.Root id={switchId} checked={full} disabled={disabled} aria-describedby={`${switchId}-description`} onCheckedChange={(checked) => onChange(checked ? ['*'] : normalizeScopes(all))} className="relative h-6 w-11 shrink-0 rounded-full border bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary">
          <Switch.Thumb className="block h-[18px] w-[18px] translate-x-0.5 rounded-full bg-card shadow-subtle transition-transform data-[state=checked]:translate-x-[22px]" />
        </Switch.Root>
      </div>
      {!full ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">고급 권한 설정</h3>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(groups.map((group) => `${group.key}:read`))}>모두 조회만 허용</Button>
          </div>
          <div className="flex items-start gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p>자동화·액션 수정 권한은 연결된 PC에서 프로그램이나 명령을 실행하는 데 사용될 수 있습니다.</p>
          </div>
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">기능별 조회 및 수정 권한. 수정 권한에는 조회 권한이 포함됩니다.</caption>
            <thead><tr className="border-y bg-muted/40 text-xs text-muted-foreground"><th scope="col" className="py-2 pl-2 text-left font-medium">기능</th><th scope="col" className="w-14 py-2 text-center font-medium">조회</th><th scope="col" className="w-14 py-2 text-center font-medium">수정</th></tr></thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.key} className="border-b">
                  <th scope="row" className="break-words py-2.5 pl-2 pr-3 text-left font-medium">
                    {group.label}
                    {group.description ? <span className="mt-0.5 block text-xs font-normal leading-5 text-muted-foreground">{group.description}</span> : null}
                  </th>
                  {(['read', 'write'] as const).map((permission) => (
                    <td key={permission} className="text-center align-middle">
                      <label className="inline-flex min-h-10 w-12 cursor-pointer items-center justify-center">
                        <input type="checkbox" checked={scopes.includes(`${group.key}:${permission}`)} disabled={disabled} onChange={(event) => onChange(setScopePermission(scopes, group.key, permission, event.target.checked))} className="h-4 w-4 rounded border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed" />
                        <span className="sr-only">{group.label} {permission === 'read' ? '조회' : '수정'} 허용</span>
                      </label>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">수정 권한에는 조회 권한이 포함됩니다.</p>
          {scopes.length === 0 ? <p role="status" className="text-xs text-destructive">조회 또는 수정 권한을 하나 이상 선택해 주세요.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

const modalClassName = 'fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-lg border bg-card shadow-lift outline-none';

function MemberEditor({ member, ownerUserId, channelName, members, groups, returnFocusTo, onClose, onSaved, onDenied }: {
  member: ManagerMember | null;
  ownerUserId: string;
  channelName: string;
  members: ManagerMember[];
  groups: ScopeGroup[];
  returnFocusTo: HTMLButtonElement;
  onClose: () => void;
  onSaved: (message: string) => void;
  onDenied: () => void;
}) {
  const [selected, setSelected] = useState<SearchUser | null>(member ? asSearchUser(member) : null);
  const [confirmed, setConfirmed] = useState(false);
  const [scopes, setScopes] = useState<string[]>(member ? normalizeScopes(member.scopes) : ['*']);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const formId = useId();
  const duplicate = !member && selected ? members.some((item) => item.memberUserId === selected.userId) : false;
  const valid = selected && selected.userId !== ownerUserId && !duplicate && scopes.length > 0 && (member || confirmed);
  const changed = !member || JSON.stringify(normalizeScopes(member.scopes)) !== JSON.stringify(normalizeScopes(scopes));

  useEffect(() => () => request.current?.abort(), []);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!valid || !changed || request.current || !selected) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await readJsonResult<{ member?: ManagerMember }>(member ? `/api/bot-management/members/${encodeURIComponent(member.id)}` : '/api/bot-management/members', {
        method: member ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(member ? { scopes: normalizeScopes(scopes) } : { memberUserId: selected.userId, scopes: normalizeScopes(scopes) }),
      });
      if (controller.signal.aborted) return;
      if (response.ok) onSaved(member ? '관리자의 운영 권한을 변경했습니다.' : '봇 관리자를 등록했습니다.');
      else if (!member && response.status === 409) onSaved('이미 등록된 관리자입니다. 목록에서 권한을 확인해 주세요.');
      else if (response.status === 403) onDenied();
      else setError(errorMessage(response.status, response.status === 404 ? '계정을 찾지 못했습니다. 목록을 새로고침해 주세요.' : '권한을 저장하지 못했습니다. 다시 시도해 주세요.'));
    } catch {
      if (!controller.signal.aborted) setError('권한을 저장하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false); }
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className={modalClassName} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusTo.focus(); }} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-semibold">{member ? '관리자 권한 수정' : '봇 관리자 추가'}</Dialog.Title>
              <Dialog.Description className="mt-1 break-all text-sm text-muted-foreground">{channelName} 채널</Dialog.Description>
            </div>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" disabled={pending} aria-label="닫기" className="shrink-0"><X className="h-4 w-4" /></Button></Dialog.Close>
          </div>
          <form id={formId} onSubmit={save} aria-busy={pending} className="arubot-modal-scroll min-h-0 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
            <fieldset disabled={pending} className="min-w-0 space-y-6">
              {selected ? (
                <section aria-label={member ? '관리자 계정' : '선택한 계정'} className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <AccountIdentity user={selected} />
                    {!member ? <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => { setSelected(null); setConfirmed(false); setError(null); }}>다시 선택</Button> : null}
                  </div>
                  {!member ? <label className="flex cursor-pointer items-start gap-2 text-sm leading-6"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring" /><span>이 계정에 운영 권한을 부여합니다.</span></label> : null}
                  {duplicate ? <p role="alert" className="text-xs text-destructive">이미 등록된 관리자입니다. 목록에서 권한을 수정해 주세요.</p> : null}
                </section>
              ) : <AccountSearch ownerUserId={ownerUserId} members={members} onSelect={(user) => { setSelected(user); setConfirmed(false); }} />}
              <div className="border-t pt-5"><PermissionEditor scopes={scopes} groups={groups} disabled={pending} onChange={setScopes} /></div>
            </fieldset>
            {error ? <p role="alert" className="text-sm leading-6 text-destructive">{error}</p> : null}
          </form>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/20 px-5 py-4 sm:px-6">
            <Dialog.Close asChild><Button type="button" variant="ghost" disabled={pending}>취소</Button></Dialog.Close>
            <Button type="submit" form={formId} disabled={!valid || !changed || pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
              {pending ? '저장 중' : member ? '권한 저장' : '관리자 추가'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function RemoveMemberDialog({ member, channelName, returnFocusTo, onClose, onRemoved, onDenied }: {
  member: ManagerMember;
  channelName: string;
  returnFocusTo: HTMLButtonElement;
  onClose: () => void;
  onRemoved: () => void;
  onDenied: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function remove() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      const response = await readJsonResult<{ ok: boolean }>(`/api/bot-management/members/${encodeURIComponent(member.id)}`, { method: 'DELETE', signal: controller.signal });
      if (controller.signal.aborted) return;
      if ((response.ok && response.data?.ok === true) || (!response.ok && response.status === 404)) onRemoved();
      else if (!response.ok && response.status === 403) onDenied();
      else setError(errorMessage(response.status, '관리자를 해제하지 못했습니다. 다시 시도해 주세요.'));
    } catch {
      if (!controller.signal.aborted) setError('관리자를 해제하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      if (!controller.signal.aborted) { request.current = null; setPending(false); }
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <Dialog.Content className={cn(modalClassName, 'max-w-lg')} onCloseAutoFocus={(event) => { event.preventDefault(); returnFocusTo.focus(); }} onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }} onInteractOutside={(event) => { if (pending) event.preventDefault(); }}>
          <div className="border-b px-5 py-4">
            <Dialog.Title className="text-lg font-semibold">관리자를 해제할까요?</Dialog.Title>
            <Dialog.Description className="mt-2 break-words text-sm leading-6 text-muted-foreground"><span className="break-all">{channelName}</span> 채널의 봇 설정에 더 이상 접근할 수 없게 됩니다.</Dialog.Description>
          </div>
          <div className="min-h-0 space-y-4 overflow-y-auto px-5 py-5"><AccountIdentity user={asSearchUser(member)} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}</div>
          <div className="flex flex-wrap justify-end gap-2 border-t bg-muted/20 px-5 py-4" aria-busy={pending}>
            <Dialog.Close asChild><Button type="button" variant="outline" disabled={pending}>취소</Button></Dialog.Close>
            <Button type="button" variant="destructive" disabled={pending} onClick={remove}>{pending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Trash2 className="h-4 w-4" />}{pending ? '해제 중' : '관리자 해제'}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PermissionSummary({ scopes, groups }: { scopes: ManagerMember['scopes']; groups: ScopeGroup[] }) {
  const normalized = normalizeScopes(scopes);
  if (normalized.includes('*')) return <Badge tone="mint">전체 운영 권한</Badge>;
  const readCount = groups.filter((group) => normalized.includes(`${group.key}:read`)).length;
  const writeCount = groups.filter((group) => normalized.includes(`${group.key}:write`)).length;
  return (
    <details className="min-w-0 text-xs">
      <summary className="flex w-fit max-w-full cursor-pointer list-none items-center gap-2 rounded py-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"><span>조회 {readCount} · 수정 {writeCount}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /></summary>
      <ul className="mt-2 space-y-1 leading-5">
        {groups.filter((group) => normalized.includes(`${group.key}:read`)).map((group) => <li key={group.key} className="break-words">{group.label}<span className="ml-2 text-muted-foreground">{normalized.includes(`${group.key}:write`) ? '조회 · 수정' : '조회만'}</span></li>)}
        {!readCount ? <li className="text-muted-foreground">허용된 기능 없음</li> : null}
      </ul>
    </details>
  );
}

function ChannelManagers({ ownerUserId, channelName, allowed, isOwner, isSiteAdmin }: { ownerUserId: string; channelName: string; allowed: boolean; isOwner: boolean; isSiteAdmin: boolean }) {
  const [members, setMembers] = useState<ManagerMember[]>([]);
  const [groups, setGroups] = useState(defaultGroups);
  const [serverCanManage, setServerCanManage] = useState(false);
  const [loading, setLoading] = useState(allowed);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [editor, setEditor] = useState<{ member: ManagerMember | null; trigger: HTMLButtonElement } | null>(null);
  const [removing, setRemoving] = useState<{ member: ManagerMember; trigger: HTMLButtonElement } | null>(null);
  const canEdit = allowed && serverCanManage && !loading && !error;

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setServerCanManage(false);
    void (async () => {
      try {
        const response = await readJsonResult<MembersResponse>('/api/bot-management/members', { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (!response.ok) { setError(errorMessage(response.status, '관리자 목록을 불러오지 못했습니다.')); return; }
        setMembers(uniqueMembers(response.data?.members));
        setGroups(getScopeGroups(response.data?.scopeGroups));
        setServerCanManage(response.data?.canManage === true);
      } catch {
        if (!controller.signal.aborted) setError('관리자 목록을 불러오지 못했습니다. 다시 시도해 주세요.');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [allowed, ownerUserId, revision]);

  function denied() {
    setServerCanManage(false);
    setEditor(null);
    setRemoving(null);
    setError('이 채널의 관리자 권한을 변경할 수 없습니다.');
  }

  function saved(message: string) {
    setEditor(null);
    setRemoving(null);
    toast.success(message);
    setRevision((value) => value + 1);
  }

  return (
    <div className="min-w-0 space-y-6">
      <header className="flex min-w-0 flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-normal">봇 관리자</h1>
          <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 text-sm"><span className="text-muted-foreground">관리 채널</span><span className="min-w-0 break-all font-semibold">{channelName}</span><Badge tone={isOwner ? 'mint' : 'sky'}>{isOwner ? '내 채널' : isSiteAdmin ? '사이트 관리자' : '위임받은 채널'}</Badge></div>
        </div>
        {allowed ? <div className="flex shrink-0 items-center gap-2">
          <Tooltip content="관리자 목록 새로고침"><Button type="button" variant="outline" size="icon" aria-label="관리자 목록 새로고침" disabled={loading || Boolean(editor) || Boolean(removing)} onClick={() => setRevision((value) => value + 1)}><RefreshCw className={cn('h-4 w-4', loading && 'animate-spin motion-reduce:animate-none')} /></Button></Tooltip>
          <Button type="button" disabled={!canEdit} onClick={(event) => setEditor({ member: null, trigger: event.currentTarget })}><UserRoundPlus className="h-4 w-4" />관리자 추가</Button>
        </div> : null}
      </header>

      {!allowed || (!loading && !error && !serverCanManage) ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-3 border-b px-4 py-10 text-center" role="status"><LockKeyhole className="h-6 w-6 text-muted-foreground" aria-hidden="true" /><h2 className="text-sm font-semibold">관리자 변경 권한이 없습니다</h2><p className="text-sm text-muted-foreground">채널 소유자와 사이트 관리자만 변경할 수 있습니다.</p></div>
      ) : loading ? (
        <div role="status" aria-live="polite" className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />관리자 목록을 불러오는 중</div>
      ) : error ? (
        <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 px-4 py-10 text-center"><AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true" /><p className="text-sm">{error}</p><Button type="button" variant="outline" size="sm" onClick={() => setRevision((value) => value + 1)}><RefreshCw className="h-3.5 w-3.5" />다시 시도</Button></div>
      ) : (
        <section aria-labelledby="bot-managers-list-title" className="min-w-0">
          <div className="mb-3 flex items-center gap-2"><h2 id="bot-managers-list-title" className="text-sm font-semibold">등록된 관리자</h2><span className="text-xs tabular-nums text-muted-foreground">{members.length}명</span></div>
          {members.length ? (
            <ul className="divide-y border-y">
              {members.map((member) => (
                <li key={member.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-3 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.65fr)_auto]">
                  <AccountIdentity user={asSearchUser(member)} />
                  <div className="col-start-1 row-start-2 min-w-0 pl-14 sm:col-start-2 sm:row-start-1 sm:pl-0"><PermissionSummary scopes={member.scopes} groups={groups} /></div>
                  <div className="col-start-2 row-start-1 flex items-center gap-1 sm:col-start-3">
                    <Tooltip content="운영 권한 수정"><Button type="button" variant="ghost" size="icon" disabled={!canEdit} aria-label={`${member.displayName || member.memberUserId} 권한 수정`} onClick={(event) => setEditor({ member, trigger: event.currentTarget })}><Pencil className="h-4 w-4" /></Button></Tooltip>
                    <Tooltip content="관리자 해제"><Button type="button" variant="ghost" size="icon" disabled={!canEdit} aria-label={`${member.displayName || member.memberUserId} 관리자 해제`} onClick={(event) => setRemoving({ member, trigger: event.currentTarget })} className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></Button></Tooltip>
                  </div>
                </li>
              ))}
            </ul>
          ) : <div className="flex min-h-48 flex-col items-center justify-center gap-3 border-y px-4 py-10 text-center"><UsersRound className="h-7 w-7 text-muted-foreground" aria-hidden="true" /><h3 className="text-sm font-medium">등록된 봇 관리자가 없습니다</h3><Button type="button" variant="outline" size="sm" disabled={!canEdit} onClick={(event) => setEditor({ member: null, trigger: event.currentTarget })}><UserRoundPlus className="h-4 w-4" />관리자 추가</Button></div>}
          <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />사이트 관리자는 별도 등록 없이 관리할 수 있습니다.</p>
        </section>
      )}

      {canEdit && editor ? <MemberEditor member={editor.member} ownerUserId={ownerUserId} channelName={channelName} members={members} groups={groups} returnFocusTo={editor.trigger} onClose={() => setEditor(null)} onSaved={saved} onDenied={denied} /> : null}
      {canEdit && removing ? <RemoveMemberDialog member={removing.member} channelName={channelName} returnFocusTo={removing.trigger} onClose={() => setRemoving(null)} onRemoved={() => saved('봇 관리자를 해제했습니다.')} onDenied={denied} /> : null}
    </div>
  );
}

export function BotManagersPage() {
  const { active, canManageMembers, isSiteAdmin } = useBotChannel();
  if (!active?.ownerUserId) return <div role="status" className="py-12 text-center text-sm text-muted-foreground">관리할 채널을 선택해 주세요.</div>;
  const isOwner = active.role === 'owner';
  const allowed = isSiteAdmin || (isOwner && canManageMembers);
  // Remount to discard dialogs, search results and in-flight responses on channel/access changes.
  return <ChannelManagers key={`${active.ownerUserId}:${active.role}:${allowed}:${isSiteAdmin}`} ownerUserId={active.ownerUserId} channelName={active.displayName || active.ownerUserId} allowed={allowed} isOwner={isOwner} isSiteAdmin={isSiteAdmin} />;
}
