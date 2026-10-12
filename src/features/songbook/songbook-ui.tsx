'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Music2, RefreshCw, Search, X } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { readJsonResult } from '@/shared/api/http';
import { SONGBOOK_DIFFICULTIES } from '../../../shared/songbook';
import { keyLabel, type SongbookCatalog, type SongbookSong } from './types';

export const selectClass = 'h-10 min-w-0 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

export function SongbookModal({ title, children, onClose, busy = false }: { title: string; children: ReactNode; onClose: () => void; busy?: boolean }) {
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
    <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-xl">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-4"><Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title><Button type="button" variant="ghost" size="icon" aria-label="닫기" disabled={busy} onClick={onClose}><X className="h-4 w-4" /></Button></header>
      <div className="overflow-y-auto p-5">{children}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

export function SongIdentity({ song, compact = false }: { song: SongbookSong; compact?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <div className="flex min-w-0 items-start gap-3">
    <div className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted ${compact ? 'h-12 w-20' : 'h-16 w-24 sm:h-20 sm:w-32'}`}>
      {song.thumbnailUrl && failed !== song.thumbnailUrl ? <img src={song.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" onError={() => setFailed(song.thumbnailUrl)} /> : <Music2 className="h-6 w-6 text-muted-foreground" />}
    </div>
    <div className="min-w-0 flex-1">
      <h3 className="break-words text-sm font-semibold leading-5 [overflow-wrap:anywhere]">{song.title}</h3>
      <p className="mt-1 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{song.artist}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="font-semibold text-foreground">키 {keyLabel(song.keyShift)}</span><span>{SONGBOOK_DIFFICULTIES.find((item: { value: number }) => item.value === song.difficulty)?.label || '보통'}</span>
        {song.youtubeUrl ? <a href={song.youtubeUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" aria-label={`${song.title} YouTube 영상`}>YouTube<ExternalLink className="h-3 w-3" /></a> : null}
      </div>
    </div>
  </div>;
}

export function useSongbookCatalog(endpoint: string, initial?: SongbookCatalog | null) {
  const [data, setData] = useState<SongbookCatalog | null>(initial || null);
  const [search, setSearch] = useState('');
  const [tag, setTag] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [sort, setSort] = useState('title');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const update = () => { if (document.visibilityState === 'visible') refresh(); };
    const timer = window.setInterval(update, 30_000);
    document.addEventListener('visibilitychange', update);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const query = new URLSearchParams({ search, tag, difficulty, sort, page: String(page) });
      try {
        const result = await readJsonResult<SongbookCatalog>(`${endpoint}?${query}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.ok) { setData(result.data); setError(''); }
        else setError(result.message);
        setLoading(false);
      } catch { if (!controller.signal.aborted) { setError('노래책에 연결하지 못했습니다.'); setLoading(false); } }
    }, search ? 250 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [endpoint, search, tag, difficulty, sort, page, revision]);
  return { data, search, tag, difficulty, sort, page, loading, error, refresh, setData, setPage,
    setSearch: (value: string) => { setSearch(value); setPage(1); },
    setTag: (value: string) => { setTag(value); setPage(1); },
    setDifficulty: (value: string) => { setDifficulty(value); setPage(1); },
    setSort: (value: string) => { setSort(value); setPage(1); },
  };
}

export function SongbookBrowser({ catalog, action, admin = false }: { catalog: ReturnType<typeof useSongbookCatalog>; action: (song: SongbookSong) => ReactNode; admin?: boolean }) {
  const { data, loading, error } = catalog;
  return <section aria-label="노래 목록" className="min-w-0 space-y-4">
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="relative"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><Input aria-label="노래 검색" type="search" placeholder="곡 제목, 가수, 태그 검색" maxLength={100} value={catalog.search} onChange={event => catalog.setSearch(event.target.value)} className="pl-9" /></div>
      <select aria-label="노래 정렬" className={selectClass} value={catalog.sort} onChange={event => catalog.setSort(event.target.value)}><option value="title">제목순</option><option value="artist">가수순</option><option value="newest">최근 등록순</option></select>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="태그 필터" className={`${selectClass} max-w-[12rem] flex-1 sm:flex-none`} value={catalog.tag} onChange={event => catalog.setTag(event.target.value)}><option value="">모든 태그</option>{[...new Set([...(data?.tags || []), ...(catalog.tag ? [catalog.tag] : [])])].map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
      <select aria-label="난이도 필터" className={`${selectClass} flex-1 sm:flex-none`} value={catalog.difficulty} onChange={event => catalog.setDifficulty(event.target.value)}><option value="">모든 난이도</option>{SONGBOOK_DIFFICULTIES.map((item: { value: number; label: string }) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      {(catalog.search || catalog.tag || catalog.difficulty) ? <Button size="sm" variant="ghost" onClick={() => { catalog.setSearch(''); catalog.setTag(''); catalog.setDifficulty(''); }}>초기화</Button> : null}
      <span role="status" className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{data ? `${data.total.toLocaleString()}곡` : '불러오는 중'}</span>
    </div>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-destructive py-2 pl-3 text-sm text-destructive">{error}<Button variant="outline" size="sm" onClick={catalog.refresh}><RefreshCw className="h-4 w-4" />다시 시도</Button></div> : null}
    <div aria-busy={loading} className="divide-y border-y">
      {data?.songs.map(song => <article key={song.id} className="grid min-w-0 gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><SongIdentity song={song} />
          {song.tags.length ? <div className="mt-3 flex flex-wrap gap-1.5">{song.tags.map(tag => <button key={tag} type="button" onClick={() => catalog.setTag(tag)} className="max-w-full break-words rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground hover:bg-primary/10 hover:text-primary">#{tag}</button>)}</div> : null}
          {song.note ? <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{song.note}</p> : null}
          {admin && (song.visible === false || !song.requestable) ? <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-300">{song.visible === false ? '비공개' : '신청 불가'}</p> : null}
          {admin && song.privateNote ? <details className="mt-3 text-sm text-muted-foreground"><summary className="cursor-pointer text-xs font-medium">비공개 연습 메모</summary><p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{song.privateNote}</p></details> : null}
        </div><div className="flex items-start justify-end gap-1 sm:pl-4">{action(song)}</div>
      </article>)}
      {!data?.songs.length && !loading && !error ? <div className="py-14 text-center"><Music2 className="mx-auto mb-3 h-7 w-7 text-muted-foreground" /><p className="text-sm text-muted-foreground">{catalog.search || catalog.tag || catalog.difficulty ? '조건에 맞는 곡이 없습니다.' : admin ? '아직 등록한 곡이 없습니다.' : '아직 공개된 곡이 없습니다.'}</p></div> : null}
    </div>
    {data && data.total > data.limit ? <nav aria-label="노래 목록 페이지" className="flex items-center justify-center gap-4"><Button variant="outline" size="icon" aria-label="이전 페이지" disabled={loading || data.page <= 1} onClick={() => catalog.setPage(data.page - 1)}><ChevronLeft className="h-4 w-4" /></Button><span className="text-sm tabular-nums">{data.page} / {Math.ceil(data.total / data.limit)}</span><Button variant="outline" size="icon" aria-label="다음 페이지" disabled={loading || data.page * data.limit >= data.total} onClick={() => catalog.setPage(data.page + 1)}><ChevronRight className="h-4 w-4" /></Button></nav> : null}
  </section>;
}
