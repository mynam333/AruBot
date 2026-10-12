'use client';

import { useRef, useState } from 'react';
import { Check, LogIn, Mic2, Plus, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button, LinkButton } from '@/components/ui/button';
import { readJsonResult } from '@/shared/api/http';
import { SongbookBrowser, SongbookModal, SongIdentity, useSongbookCatalog } from '@/features/songbook/songbook-ui';
import { useSongbookRequests } from '@/features/songbook/use-songbook-requests';
import { requestStatusLabels, type SongbookCatalog, type SongbookSong } from '@/features/songbook/types';

export function PublicSongbook({ channelUid, initialData }: { channelUid: string; initialData: unknown }) {
  const uid = encodeURIComponent(channelUid);
  const endpoint = `/api/viewer/songbook/${uid}/requests`;
  const catalog = useSongbookCatalog(`/api/public/${uid}/songbook`, initialData && typeof initialData === 'object' && Array.isArray((initialData as SongbookCatalog).songs) ? initialData as SongbookCatalog : null);
  const requests = useSongbookRequests(endpoint);
  const [selected, setSelected] = useState<{ song: SongbookSong; requestKey: string } | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const active = requests.items.filter(item => item.status === 'pending' || item.status === 'singing');
  const visibleRequests = [...active, ...requests.items.filter(item => item.status !== 'pending' && item.status !== 'singing').slice(0, 5)];
  const login = `/viewer/login?returnTo=${encodeURIComponent(`/c/${uid}/songbook`)}`;
  const limitReached = active.length >= (catalog.data?.settings.perUserLimit || 1);
  const submit = async () => {
    if (!selected || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await readJsonResult(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId: selected.song.id, requestKey: selected.requestKey, message }) });
      if (!result.ok) { setError(result.message); if (result.status === 401) requests.refresh(); catalog.refresh(); return; }
      setSelected(null); requests.refresh(); toast.success('노래 신청을 보냈습니다.');
    } finally { lock.current = false; setBusy(false); }
  };
  const cancel = async (id: string) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await readJsonResult(`${endpoint}/${id}/cancel`, { method: 'POST' });
      if (!result.ok) toast.error(result.message);
      else toast.success('신청을 취소했습니다.');
      requests.refresh();
    } finally { lock.current = false; setBusy(false); }
  };
  return <div className="min-w-0 space-y-6">
    <section className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
      <div className="flex items-center gap-2 text-sm"><span className={`h-2 w-2 rounded-full ${catalog.data?.settings.requestsEnabled ? 'bg-emerald-500' : 'bg-muted-foreground'}`} /><span className="font-semibold">{catalog.data?.settings.requestsEnabled ? '노래 신청 받는 중' : '노래 신청 마감'}</span><span className="text-muted-foreground">{catalog.data ? `1인 대기 · 진행 ${catalog.data.settings.perUserLimit}곡까지` : ''}</span></div>
      {requests.auth === 'login' ? <LinkButton href={login} variant="outline" size="sm"><LogIn className="h-4 w-4" />로그인하고 신청</LinkButton> : <Button size="sm" variant="ghost" onClick={() => { catalog.refresh(); requests.refresh(); }}><RefreshCw className="h-4 w-4" />새로고침</Button>}
    </section>
    {requests.auth === 'error' ? <p role="alert" className="text-sm text-destructive">내 신청 내역: {requests.error}</p> : null}
    {requests.auth === 'ready' && requests.items.length ? <section aria-label="내 신청" className="space-y-3"><h2 className="text-sm font-semibold">내 신청 <span className="ml-1 text-muted-foreground">{active.length}곡 대기 · 진행</span></h2><div className="divide-y rounded-lg border bg-card">
      {visibleRequests.map(item => <div key={item.id} className="flex items-center gap-3 p-3"><span className="shrink-0 text-primary">{item.status === 'singing' ? <Mic2 className="h-4 w-4" /> : item.status === 'done' ? <Check className="h-4 w-4" /> : <MusicStatus />}</span><div className="min-w-0 flex-1"><p className="break-words text-sm font-medium [overflow-wrap:anywhere]">{item.song.title}</p><p className="mt-0.5 text-xs text-muted-foreground">{requestStatusLabels[item.status]}</p></div>{item.status === 'pending' ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancel(item.id)}><X className="h-3.5 w-3.5" />취소</Button> : null}</div>)}
    </div></section> : null}
    <SongbookBrowser catalog={catalog} action={song => {
      const requested = active.some(item => item.songId === song.id);
      const disabled = !catalog.data?.settings.requestsEnabled || !song.requestable || requested || limitReached;
      if (requests.auth === 'login' && !disabled) return <LinkButton href={login} size="sm" variant="outline"><LogIn className="h-4 w-4" />신청</LinkButton>;
      return <Button size="sm" variant={requested ? 'secondary' : 'outline'} disabled={disabled || requests.auth !== 'ready'} onClick={() => { setSelected({ song, requestKey: crypto.randomUUID() }); setMessage(''); setError(''); }}><Plus className="h-4 w-4" />{requested ? '신청됨' : !song.requestable ? '신청 불가' : !catalog.data?.settings.requestsEnabled ? '마감' : limitReached ? '한도 도달' : '신청'}</Button>;
    }} />
    {selected ? <SongbookModal title="노래 신청" busy={busy} onClose={() => setSelected(null)}><form className="space-y-5" onSubmit={event => { event.preventDefault(); void submit(); }}><SongIdentity song={selected.song} /><label className="block text-sm font-medium">신청 메시지 <span className="font-normal text-muted-foreground">(선택)</span><textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={200} rows={3} className="mt-2 w-full resize-y rounded-md border bg-background p-3 text-sm" /></label>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><Button type="button" variant="ghost" disabled={busy} onClick={() => setSelected(null)}>취소</Button>{requests.auth === 'login' ? <LinkButton href={login}>로그인</LinkButton> : <Button type="submit" disabled={busy}>{busy ? '신청 중' : '신청 보내기'}</Button>}</div></form></SongbookModal> : null}
  </div>;
}

function MusicStatus() { return <span className="block h-1.5 w-1.5 rounded-full bg-current" />; }
