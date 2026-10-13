'use client';

import Link from 'next/link';
import * as Switch from '@radix-ui/react-switch';
import { ArrowUpRight, BookOpen, MessageSquarePlus, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { readJsonResult } from '@/shared/api/http';
import { parseCommandTriggers, formatCommandTriggers } from '@/features/admin/command-triggers';
import { RegexSwitch } from '@/features/admin/regex-switch';
import { SongbookModal } from './songbook-ui';
import { commandEditVersion, songbookCommandKinds, songbookCommandTemplate, songbookTriggerConflict, type SongbookCommandKind, type SongbookCommandRule } from '../../../shared/songbook-commands';

type Props = { canRead: boolean; canWrite: boolean; requestsEnabled: boolean };
type Draft = { original: SongbookCommandRule | null; rule: SongbookCommandRule; triggers: string; response: string; cooldown: string };
const endpoint = '/api/bot/rules';

export function SongbookCommandEditor({ canRead, canWrite, requestsEnabled }: Props) {
  const [rules, setRules] = useState<SongbookCommandRule[] | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<SongbookCommandRule | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (!canRead) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const result = await readJsonResult<{ rules: SongbookCommandRule[] }>(endpoint, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!result.ok) setError(result.message);
      else { setRules(result.data.rules || []); setError(''); }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '명령어를 불러오지 못했습니다.'); }
  }, [canRead]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!document.hidden) void load(); };
    const resource = (event: Event) => { if (!(event as CustomEvent).detail?.endpoint || (event as CustomEvent).detail.endpoint === endpoint) refresh(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('arubot:resource-refresh', resource);
    return () => { window.clearInterval(timer); request.current?.abort(); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('arubot:resource-refresh', resource); };
  }, [load]);

  const mutate = async (path: string, body: unknown) => {
    if (!canWrite || pending.current) return false;
    pending.current = true; setBusy(true); setFormError('');
    try {
      const result = await readJsonResult(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!result.ok) { setFormError(result.message); toast.error(result.message); return false; }
      window.dispatchEvent(new CustomEvent('arubot:resource-refresh', { detail: { endpoint } }));
      await load();
      return true;
    } finally { pending.current = false; setBusy(false); }
  };
  const open = (rule: SongbookCommandRule, original: SongbookCommandRule | null) => {
    setFormError('');
    setDraft({ original, rule, triggers: formatCommandTriggers(rule.keywords, { regex: rule.regex }), response: (rule.responses || []).join('\n'), cooldown: String((rule.cooldown ?? 3000) / 1000) });
  };
  const add = (kind: SongbookCommandKind) => open(songbookCommandTemplate(kind, crypto.randomUUID()), null);
  const save = async () => {
    if (!draft || !rules) return;
    const keywords = parseCommandTriggers(draft.triggers, { regex: draft.rule.regex });
    const responses = draft.response.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const cooldown = Number(draft.cooldown);
    const maxLength = draft.rule.regex ? 256 : 100;
    if (!keywords.length || keywords.length > 20 || keywords.some(value => value.length > maxLength)) { setFormError(`명령어는 ${maxLength}자 이내로, 최대 20개까지 입력해 주세요.`); return; }
    if (!Number.isFinite(cooldown) || cooldown < 1 || cooldown > 86400) { setFormError('재사용 대기시간은 1~86,400초로 입력해 주세요.'); return; }
    const rule = { ...draft.rule, name: draft.rule.name?.trim() || keywords[0], keywords, responses, cooldown: cooldown * 1000 };
    if (!songbookCommandKinds(rule).length) { setFormError('노래책 신청 또는 링크 변수가 응답에 하나 이상 필요합니다.'); return; }
    const conflict = songbookTriggerConflict(rule, rules);
    if (conflict) { setFormError(`이미 사용 중인 명령어입니다: ${conflict.name || conflict.keywords?.[0]}`); return; }
    if (await mutate(`${endpoint}/upsert`, { rule, expectedVersion: commandEditVersion(draft.original) })) { setDraft(null); toast.success('명령어를 저장했습니다.'); }
  };
  const linked = (rules || []).filter(rule => songbookCommandKinds(rule).length);
  if (!canRead) return <p className="border-l-2 border-amber-500 py-2 pl-3 text-sm text-muted-foreground">채팅 명령어 조회 권한이 필요합니다.</p>;
  return <section className="space-y-5" aria-label="노래 신청 방법">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">채팅 명령어</h2><div className="flex items-center gap-2"><Tooltip content="명령어 새로고침"><span className="inline-flex"><Button variant="ghost" size="icon" aria-label="명령어 새로고침" onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button></span></Tooltip><Link href="/commands" className="inline-flex items-center gap-1 text-sm font-medium text-primary">전체 명령어<ArrowUpRight className="h-4 w-4" /></Link></div></div>
    {!canWrite ? <p className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">명령어와 노래책 수정 권한이 필요합니다.</p> : null}
    {!requestsEnabled ? <p className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">노래 신청 접수가 마감되어 있습니다.</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">{([{ kind: 'request', label: '노래 신청', example: '!노래신청 곡명', Icon: MessageSquarePlus }, { kind: 'url', label: '노래책 링크', example: '!노래책', Icon: BookOpen }] as const).map(({ kind, label, example, Icon }) => <div key={kind} className="flex min-w-0 items-center gap-3 rounded-lg border p-4"><Icon className="h-5 w-5 shrink-0 text-primary" /><div className="min-w-0 flex-1"><h3 className="text-sm font-semibold">{label}</h3><code className="break-all text-xs text-muted-foreground">{example}</code></div><Tooltip content={`${label} 명령어 추가`}><span className="inline-flex"><Button size="icon" variant="outline" aria-label={`${label} 명령어 추가`} disabled={!canWrite || busy || !rules} onClick={() => add(kind)}><Plus className="h-4 w-4" /></Button></span></Tooltip></div>)}</div>
    {!rules && !error ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">명령어를 불러오는 중</p> : null}
    {rules && !linked.length ? <p className="border-y py-10 text-center text-sm text-muted-foreground">등록된 노래책 명령어가 없습니다.</p> : null}
    <ul className="divide-y">{linked.map(rule => <li key={rule.id} className="flex flex-wrap items-center gap-3 py-4"><div className="min-w-0 flex-1 basis-40"><div className="flex flex-wrap items-center gap-2"><span className="break-words text-sm font-semibold [overflow-wrap:anywhere]">{rule.name || rule.keywords?.[0]}</span><span className="text-xs text-muted-foreground">{songbookCommandKinds(rule).includes('request') ? '노래 신청' : '링크 안내'}</span></div><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">{rule.keywords?.map(value => <code key={value} className="break-all text-sm text-primary">{value}</code>)}</div><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{(rule.cooldown ?? 3000) / 1000}초 간격</span>{Number(rule.pointsCost) > 0 ? <span>{Number(rule.pointsCost).toLocaleString()}P</span> : null}{(rule.requiredRoleLevel || (rule.adminOnly ? 3 : 1)) > 1 ? <span>사용 권한 제한</span> : null}</div></div><div className="flex items-center gap-2"><Switch.Root aria-label={`${rule.name || rule.keywords?.[0]} 사용`} checked={rule.enabled !== false} disabled={!canWrite || busy} onCheckedChange={enabled => void mutate(`${endpoint}/upsert`, { rule: { ...rule, enabled }, expectedVersion: commandEditVersion(rule) })} className="relative h-6 w-11 rounded-full bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary"><Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" /></Switch.Root><Tooltip content="명령어 수정"><span className="inline-flex"><Button size="icon" variant="ghost" aria-label={`${rule.name} 수정`} disabled={!canWrite || busy} onClick={() => open(rule, rule)}><Pencil className="h-4 w-4" /></Button></span></Tooltip><Tooltip content="명령어 삭제"><span className="inline-flex"><Button size="icon" variant="ghost" aria-label={`${rule.name} 삭제`} disabled={!canWrite || busy} onClick={() => { setDeleting(rule); setFormError(''); }}><Trash2 className="h-4 w-4" /></Button></span></Tooltip></div></li>)}</ul>
    {draft ? <SongbookModal title={draft.original ? '신청 명령어 수정' : '신청 명령어 추가'} busy={busy} onClose={() => setDraft(null)}><form className="space-y-4" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="block space-y-1.5 text-sm font-medium"><span>이름</span><Input maxLength={100} value={draft.rule.name || ''} onChange={event => setDraft({ ...draft, rule: { ...draft.rule, name: event.target.value } })} /></label>
      <label className="block space-y-1.5 text-sm font-medium"><span>{draft.rule.regex ? '채팅 명령어 정규식 (한 줄에 하나)' : '채팅 명령어'}</span>{draft.rule.regex ? <textarea className="min-h-24 w-full rounded-md border bg-background p-3 font-mono" maxLength={5140} required value={draft.triggers} onChange={event => setDraft({ ...draft, triggers: event.target.value })} /> : <Input placeholder="!노래신청 !신청" maxLength={2000} required value={draft.triggers} onChange={event => setDraft({ ...draft, triggers: event.target.value })} />}</label>
      <RegexSwitch checked={draft.rule.regex === true} disabled={busy} onCheckedChange={regex => setDraft({ ...draft, rule: { ...draft.rule, regex } })} />
      <label className="block space-y-1.5 text-sm font-medium"><span>재사용 대기시간 (초)</span><Input type="number" min={1} max={86400} step="any" required value={draft.cooldown} onChange={event => setDraft({ ...draft, cooldown: event.target.value })} /></label>
      <label className="block space-y-1.5 text-sm font-medium"><span>응답</span><textarea className="min-h-24 w-full resize-y rounded-md border bg-background p-3 font-normal" maxLength={4000} required value={draft.response} onChange={event => setDraft({ ...draft, response: event.target.value })} /></label>
      <div className="flex flex-wrap gap-2">{([{ kind: 'request', label: '신청 결과' }, { kind: 'url', label: '노래책 주소' }] as const).map(item => <Button key={item.kind} type="button" size="sm" variant="outline" onClick={() => setDraft({ ...draft, response: `${draft.response}${draft.response ? ' ' : ''}\${songbook_${item.kind}}` })}><Plus className="h-3.5 w-3.5" />{item.label}</Button>)}</div>
      {formError ? <p role="alert" className="text-sm text-destructive">{formError}</p> : null}
      <div className="flex flex-wrap items-center justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>취소</Button><Button type="submit" disabled={busy}><Save className="h-4 w-4" />{busy ? '저장 중' : '저장'}</Button></div>
    </form></SongbookModal> : null}
    {deleting ? <SongbookModal title="명령어 삭제" busy={busy} onClose={() => setDeleting(null)}><p className="break-all text-sm">{deleting.name || deleting.keywords?.[0]} 명령어를 삭제할까요? 명령어 페이지에서도 삭제됩니다.</p>{formError ? <p role="alert" className="mt-3 text-sm text-destructive">{formError}</p> : null}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>취소</Button><Button variant="destructive" disabled={busy} onClick={async () => { if (await mutate(`${endpoint}/delete`, { id: deleting.id, expectedVersion: commandEditVersion(deleting) })) { setDeleting(null); toast.success('명령어를 삭제했습니다.'); } }}>삭제</Button></div></SongbookModal> : null}
  </section>;
}
