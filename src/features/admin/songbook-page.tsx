'use client';

import * as Switch from '@radix-ui/react-switch';
import { Check, Copy, ExternalLink, Mic2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useBotChannel } from '@/components/app-shell/bot-channel-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { readJsonResult } from '@/shared/api/http';
import { cn } from '@/shared/lib/utils';
import { SONGBOOK_DIFFICULTIES, songbookVideoId } from '../../../shared/songbook';
import { SongbookBrowser, SongbookModal, SongIdentity, selectClass, useSongbookCatalog } from '@/features/songbook/songbook-ui';
import { useSongbookRequests } from '@/features/songbook/use-songbook-requests';
import { SongbookOverlayEditor } from '@/features/songbook/songbook-overlay-editor';
import { SongbookCommandEditor } from '@/features/songbook/songbook-command-editor';
import { requestStatusLabels, type SongbookRequest, type SongbookSettings, type SongbookSong } from '@/features/songbook/types';

function SongEditor({ song, onClose, onSaved }: { song: SongbookSong | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ title: song?.title || '', artist: song?.artist || '', youtubeUrl: song?.youtubeUrl || '', keyShift: String(song?.keyShift || 0), difficulty: song?.difficulty || 3, note: song?.note || '', privateNote: song?.privateNote || '', visible: song?.visible !== false, requestable: song?.requestable !== false });
  const [tags, setTags] = useState(song?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const videoId = songbookVideoId(form.youtubeUrl);
  const set = <K extends keyof typeof form>(key: K, value: typeof form[K]) => setForm(current => ({ ...current, [key]: value }));
  const mergeTags = () => [...new Map([...tags, ...tagInput.split(/[,\n]/).map(tag => tag.trim()).filter(Boolean)].map(tag => [tag.toLocaleLowerCase(), tag])).values()];
  const addTags = () => {
    const next = mergeTags();
    if (next.length > 12 || next.some(tag => tag.length > 24)) { setError('태그는 각 24자, 최대 12개까지 등록할 수 있습니다.'); return; }
    setTags(next); setTagInput(''); setError('');
  };
  const save = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await readJsonResult('/api/songbook/songs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, keyShift: Number(form.keyShift), tags: mergeTags(), ...(song ? { id: song.id, revision: song.revision } : {}) }) });
      if (!result.ok) { setError(result.message); return; }
      toast.success(song ? '곡 정보를 수정했습니다.' : '노래책에 곡을 추가했습니다.'); onSaved();
    } finally { lock.current = false; setBusy(false); }
  };
  return <SongbookModal title={song ? '곡 정보 수정' : '곡 추가'} busy={busy} onClose={onClose}><form className="space-y-5" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-2 text-sm font-medium"><span>곡 제목 *</span><Input autoFocus required maxLength={200} value={form.title} onChange={event => set('title', event.target.value)} /></label><label className="space-y-2 text-sm font-medium"><span>가수 *</span><Input required maxLength={120} value={form.artist} onChange={event => set('artist', event.target.value)} /></label></div>
    <label className="block space-y-2 text-sm font-medium"><span>YouTube 영상</span><Input maxLength={2048} placeholder="https://www.youtube.com/watch?v=..." value={form.youtubeUrl} onChange={event => set('youtubeUrl', event.target.value)} /></label>
    {videoId ? <div className="flex items-center gap-3 rounded-md bg-muted/50 p-3"><img src={`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`} alt="영상 썸네일 미리보기" className="aspect-video w-28 shrink-0 rounded object-cover" /><a href={`https://www.youtube.com/watch?v=${videoId}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-primary">영상 확인<ExternalLink className="h-3.5 w-3.5" /></a></div> : form.youtubeUrl ? <p className="text-xs text-destructive">유효한 YouTube 영상 주소를 입력해 주세요.</p> : null}
    <div className="grid grid-cols-2 gap-4"><label className="space-y-2 text-sm font-medium"><span>키 조절 (반음)</span><Input type="number" min={-12} max={12} step={1} required value={form.keyShift} onChange={event => set('keyShift', event.target.value)} /></label><label className="flex flex-col gap-2 text-sm font-medium"><span>노래 난이도</span><select aria-label="노래 난이도" className={selectClass} value={form.difficulty} onChange={event => set('difficulty', Number(event.target.value))}>{SONGBOOK_DIFFICULTIES.map((item: { value: number; label: string }) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label></div>
    <div className="space-y-2"><label htmlFor="songbook-tags" className="text-sm font-medium">태그 <span className="font-normal text-muted-foreground">{tags.length}/12</span></label><div className="flex gap-2"><Input id="songbook-tags" placeholder="예: 발라드, 일본어, 연습 중" value={tagInput} maxLength={300} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addTags(); } }} /><Button type="button" variant="outline" size="icon" aria-label="태그 추가" onClick={addTags}><Plus className="h-4 w-4" /></Button></div><div className="flex flex-wrap gap-1.5">{tags.map(tag => <span key={tag} className="inline-flex max-w-full items-center gap-1 rounded bg-muted px-2 py-1 text-xs"><span className="break-all">{tag}</span><button type="button" aria-label={`${tag} 태그 삭제`} onClick={() => setTags(current => current.filter(value => value !== tag))}><X className="h-3.5 w-3.5" /></button></span>)}</div></div>
    <label className="block space-y-2 text-sm font-medium"><span>공개 메모</span><textarea rows={2} maxLength={1000} value={form.note} onChange={event => set('note', event.target.value)} className="w-full resize-y rounded-md border bg-background p-3 text-sm" /></label>
    <label className="block space-y-2 text-sm font-medium"><span>비공개 연습 메모</span><textarea rows={2} maxLength={2000} value={form.privateNote} onChange={event => set('privateNote', event.target.value)} className="w-full resize-y rounded-md border bg-background p-3 text-sm" /></label>
    <div className="flex flex-wrap gap-5 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={form.visible} onChange={event => set('visible', event.target.checked)} className="h-4 w-4 accent-primary" />시청자에게 공개</label><label className="flex items-center gap-2"><input type="checkbox" checked={form.requestable} onChange={event => set('requestable', event.target.checked)} className="h-4 w-4 accent-primary" />신청 가능한 곡</label></div>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<div className="flex justify-end gap-2 border-t pt-4"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>취소</Button><Button type="submit" disabled={busy || Boolean(form.youtubeUrl && !videoId)}>{busy ? '저장 중' : song ? '변경 저장' : '곡 추가'}</Button></div>
  </form></SongbookModal>;
}

function RequestsPanel({ canWrite }: { canWrite: boolean }) {
  const [history, setHistory] = useState(false);
  const queue = useSongbookRequests(`/api/songbook/requests${history ? '?history=1' : ''}`);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const singing = queue.items.some(item => item.status === 'singing');
  const change = async (item: SongbookRequest, status: SongbookRequest['status']) => {
    if (lock.current || !canWrite) return;
    lock.current = true; setBusy(true);
    try {
      const result = await readJsonResult(`/api/songbook/requests/${item.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, expectedStatus: item.status }) });
      if (!result.ok) toast.error(result.message);
      queue.refresh();
    } finally { lock.current = false; setBusy(false); }
  };
  return <section className="space-y-4" aria-label="노래 신청 관리"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-3"><button type="button" aria-pressed={!history} onClick={() => setHistory(false)} className={cn('border-b-2 py-2 text-sm font-medium', !history ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>대기 · 진행</button><button type="button" aria-pressed={history} onClick={() => setHistory(true)} className={cn('border-b-2 py-2 text-sm font-medium', history ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>최근 처리 내역</button></div><Button variant="ghost" size="sm" onClick={queue.refresh}><RefreshCw className="h-4 w-4" />새로고침</Button></div>
    {queue.error ? <p role="alert" className="text-sm text-destructive">{queue.error}</p> : null}
    {queue.auth === 'loading' ? <p role="status" className="py-8 text-center text-sm text-muted-foreground">신청을 불러오는 중</p> : !queue.items.length && queue.auth === 'ready' ? <p className="border-y py-14 text-center text-sm text-muted-foreground">{history ? '처리한 신청이 없습니다.' : '대기 중인 노래 신청이 없습니다.'}</p> : null}
    <div className="divide-y">{queue.items.map((item, index) => <article key={item.id} className={cn('grid gap-4 py-5 sm:grid-cols-[minmax(0,1fr)_auto]', item.status === 'singing' && 'border-l-2 border-primary bg-primary/5 px-4')}><div className="min-w-0"><div className="mb-3 flex flex-wrap items-center gap-2 text-xs"><span className={cn('font-semibold', item.status === 'singing' ? 'text-primary' : 'text-muted-foreground')}>{item.status === 'pending' ? `${index + 1}. 대기 중` : requestStatusLabels[item.status]}</span><span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><SongIdentity song={item.song} compact /><p className="mt-3 break-words text-sm [overflow-wrap:anywhere]"><span className="font-semibold">{item.username}</span><span className="ml-2 text-muted-foreground">{item.message || '메시지 없음'}</span></p></div><div className="flex items-start justify-end gap-2">{item.status === 'pending' ? <><Button size="sm" variant="ghost" disabled={!canWrite || busy} onClick={() => void change(item, 'rejected')}><X className="h-4 w-4" />거절</Button><Button size="sm" disabled={!canWrite || busy || singing} onClick={() => void change(item, 'singing')}><Mic2 className="h-4 w-4" />부르기</Button></> : item.status === 'singing' ? <Button size="sm" disabled={!canWrite || busy} onClick={() => void change(item, 'done')}><Check className="h-4 w-4" />완료</Button> : null}</div></article>)}</div>
  </section>;
}

export function SongbookPage() {
  const { canWrite, canRead, active } = useBotChannel();
  const writable = canWrite('songbook');
  const catalog = useSongbookCatalog('/api/songbook');
  const [tab, setTab] = useState<'songs' | 'requests' | 'methods' | 'overlay'>('songs');
  const [overlayOpened, setOverlayOpened] = useState(false);
  const [editing, setEditing] = useState<SongbookSong | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<SongbookSong | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [deleteError, setDeleteError] = useState('');
  const updateSettings = async (patch: Partial<SongbookSettings>) => {
    if (!writable || !catalog.data || lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const result = await readJsonResult<{ settings: SongbookSettings }>('/api/songbook/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...catalog.data.settings, ...patch }) });
      if (!result.ok) toast.error(result.message);
      else catalog.setData(data => data ? { ...data, settings: result.data.settings } : data);
      catalog.refresh();
    } finally { lock.current = false; setBusy(false); }
  };
  const remove = async () => {
    if (!deleting || !writable || lock.current) return;
    lock.current = true; setBusy(true); setDeleteError('');
    try {
      const result = await readJsonResult(`/api/songbook/songs/${deleting.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: deleting.revision }) });
      if (!result.ok) { setDeleteError(result.message); return; }
      setDeleting(null); catalog.refresh(); toast.success('곡을 삭제했습니다.');
    } finally { lock.current = false; setBusy(false); }
  };
  const copyLink = async () => {
    if (!catalog.data?.publicPath) return;
    try { await navigator.clipboard.writeText(new URL(catalog.data.publicPath, window.location.origin).href); toast.success('시청자 노래책 링크를 복사했습니다.'); }
    catch { toast.error('링크를 복사하지 못했습니다.'); }
  };
  return <div className="mx-auto w-full max-w-5xl space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-bold">노래책</h1><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!catalog.data?.publicPath} onClick={() => void copyLink()}><Copy className="h-4 w-4" />시청자 링크</Button><Button disabled={!writable} onClick={() => setEditing(null)}><Plus className="h-4 w-4" />곡 추가</Button></div></header>
    {!writable ? <p className="border-l-2 border-amber-500 pl-3 text-sm text-muted-foreground">이 채널의 노래책은 조회만 가능합니다.</p> : null}
    <section className="flex flex-wrap items-center justify-between gap-5 border-y py-4" aria-label="신청 설정"><div className="flex items-center gap-3"><Switch.Root id="songbook-open" aria-label="노래 신청 받기" disabled={!writable || busy || !catalog.data} checked={catalog.data?.settings.requestsEnabled || false} onCheckedChange={requestsEnabled => void updateSettings({ requestsEnabled })} className="relative h-6 w-11 rounded-full bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=checked]:bg-primary"><Switch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[22px]" /></Switch.Root><label htmlFor="songbook-open" className="text-sm font-semibold">노래 신청 받기</label><span className="text-xs text-muted-foreground">{catalog.data?.settings.requestsEnabled ? '접수 중' : '마감'}</span></div><label className="flex items-center gap-2 text-sm"><span>1인 신청 한도</span><select className={selectClass} value={catalog.data?.settings.perUserLimit || 1} disabled={!writable || busy || !catalog.data} onChange={event => void updateSettings({ perUserLimit: Number(event.target.value) })}>{Array.from({ length: 10 }, (_, index) => <option key={index} value={index + 1}>{index + 1}곡</option>)}</select></label></section>
    <div role="tablist" aria-label="노래책 관리" className="flex gap-4 overflow-x-auto border-b sm:gap-6">{([{ id: 'songs', label: '노래 목록' }, { id: 'requests', label: '신청 관리' }, { id: 'methods', label: '신청 방법' }, { id: 'overlay', label: '노래방 오버레이' }] as const).map(item => <button key={item.id} id={`songbook-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`songbook-panel-${item.id}`} type="button" onClick={() => { setTab(item.id); if (item.id === 'overlay') setOverlayOpened(true); }} className={cn('shrink-0 border-b-2 pb-3 text-sm font-semibold', tab === item.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground')}>{item.label}</button>)}</div>
    {tab !== 'overlay' ? <div role="tabpanel" id={`songbook-panel-${tab}`} aria-labelledby={`songbook-tab-${tab}`}>{tab === 'songs' ? <SongbookBrowser catalog={catalog} admin action={song => <><Tooltip content="곡 정보 수정"><Button size="icon" variant="ghost" aria-label={`${song.title} 수정`} disabled={!writable} onClick={() => setEditing(song)}><Pencil className="h-4 w-4" /></Button></Tooltip><Tooltip content="곡 삭제"><Button size="icon" variant="ghost" aria-label={`${song.title} 삭제`} disabled={!writable} onClick={() => { setDeleting(song); setDeleteError(''); }}><Trash2 className="h-4 w-4" /></Button></Tooltip></>} /> : tab === 'requests' ? <RequestsPanel canWrite={writable} /> : <SongbookCommandEditor key={active.ownerUserId} canRead={canRead('commands')} canWrite={writable && canWrite('commands')} requestsEnabled={catalog.data?.settings.requestsEnabled || false} />}</div> : null}
    {overlayOpened ? <div hidden={tab !== 'overlay'} role="tabpanel" id="songbook-panel-overlay" aria-labelledby="songbook-tab-overlay"><SongbookOverlayEditor key={active.ownerUserId} canWrite={writable} requestsEnabled={catalog.data?.settings.requestsEnabled || false} /></div> : null}
    {editing !== undefined && writable ? <SongEditor song={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); catalog.refresh(); }} /> : null}
    {deleting && writable ? <SongbookModal title="곡 삭제" busy={busy} onClose={() => setDeleting(null)}><p className="break-words text-sm leading-6 [overflow-wrap:anywhere]"><strong>{deleting.title}</strong> 곡을 삭제할까요? 이 곡의 대기 중인 신청도 취소됩니다.</p>{deleteError ? <p role="alert" className="mt-3 text-sm text-destructive">{deleteError}</p> : null}<div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>취소</Button><Button variant="destructive" disabled={busy} onClick={() => void remove()}>삭제</Button></div></SongbookModal> : null}
  </div>;
}
