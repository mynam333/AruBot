'use client';

import { Copy, Eye, EyeOff, Monitor, RotateCcw, Save, Smartphone, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { readJsonResult } from '@/shared/api/http';
import { DEFAULT_SONGBOOK_OVERLAY, normalizeSongbookOverlay, type SongbookBlock, type SongbookOrientation, type SongbookOverlayConfig, type SongbookOverlaySnapshot } from '../../../shared/songbook-overlay';
import { SongbookOverlayStage } from './songbook-overlay-stage';
import { useSongbookRequests } from './use-songbook-requests';
import { SongbookModal } from './songbook-ui';
import styles from './songbook-overlay.module.css';

type SavedOverlay = { config: SongbookOverlayConfig; revision: number; viewerPath: string };
const samples = [
  { id: 'sample-1', title: '밤편지', artist: '아이유', username: '시청자 1', videoId: 'BzYnNdJhZQw', keyShift: 0 },
  { id: 'sample-2', title: '사건의 지평선', artist: '윤하', username: '시청자 2', videoId: null, keyShift: -1 },
  { id: 'sample-3', title: '한 페이지가 될 수 있게', artist: 'DAY6', username: '시청자 3', videoId: null, keyShift: 0 },
  { id: 'sample-4', title: '오래된 노래', artist: '스탠딩 에그', username: '시청자 4', videoId: null, keyShift: 0 },
  { id: 'sample-5', title: '너의 모든 순간', artist: '성시경', username: '시청자 5', videoId: null, keyShift: 1 },
  { id: 'sample-6', title: '다시 만난 세계', artist: '소녀시대', username: '시청자 6', videoId: null, keyShift: 0 },
  { id: 'sample-7', title: '긴 노래 제목도 잘 보이도록 천천히 흐르는 신청곡 미리보기', artist: '예시 가수', username: '시청자 7', videoId: null, keyShift: 0 },
];

export function SongbookOverlayEditor({ canWrite, requestsEnabled }: { canWrite: boolean; requestsEnabled: boolean }) {
  const [saved, setSaved] = useState<SavedOverlay | null>(null);
  const [config, setConfig] = useState(() => normalizeSongbookOverlay());
  const [orientation, setOrientation] = useState<SongbookOrientation>('landscape');
  const [selected, setSelected] = useState<SongbookBlock>('current');
  const [example, setExample] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState<'rotate' | 'reload' | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const requests = useSongbookRequests('/api/songbook/requests');
  const dirty = saved !== null && JSON.stringify(config) !== JSON.stringify(saved.config);
  const accept = useCallback((data: SavedOverlay) => { setSaved(data); setConfig(normalizeSongbookOverlay(data.config)); setError(''); }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    setBusy(true);
    const result = await readJsonResult<SavedOverlay>('/api/songbook/overlay', { signal });
    if (signal?.aborted || !mounted.current) return;
    if (result.ok) accept(result.data); else setError(result.message);
    setBusy(false);
  }, [accept]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load]);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const update = (patch: Partial<SongbookOverlayConfig>) => setConfig(value => normalizeSongbookOverlay({ ...value, ...patch }));
  const layout = (mode: SongbookOrientation, block: SongbookBlock, patch: Partial<SongbookOverlayConfig['layouts']['landscape']['current']>) => {
    if (!canWrite || busy || !saved) return;
    setConfig(value => normalizeSongbookOverlay({ ...value, layouts: { ...value.layouts, [mode]: { ...value.layouts[mode], [block]: { ...value.layouts[mode][block], ...patch } } } }));
  };
  const persist = async (rotate = false) => {
    if (!saved || !canWrite || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await readJsonResult<SavedOverlay>(`/api/songbook/overlay${rotate ? '/rotate' : ''}`, {
        method: rotate ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rotate ? {} : { config, revision: saved.revision }),
      });
      if (!mounted.current) return;
      if (result.ok) {
        if (rotate) { setSaved(result.data); setRevealed(false); }
        else accept(result.data);
        setConfirmation(null); toast.success(rotate ? '새 오버레이 주소를 발급했습니다.' : '오버레이 배치를 저장했습니다.');
      } else setError(result.message);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const url = saved && typeof window !== 'undefined' ? new URL(saved.viewerPath, window.location.origin).href : '';
  const current = requests.items.find(item => item.status === 'singing');
  const mapRequest = (item: typeof requests.items[number]) => ({ id: item.id, title: item.song.title, artist: item.song.artist, videoId: item.song.videoId, username: item.username, keyShift: item.song.keyShift });
  const data: SongbookOverlaySnapshot = { config, requestsEnabled: example ? true : requestsEnabled,
    current: example ? samples[0] : current ? mapRequest(current) : null,
    queueCount: example ? samples.length - 1 : requests.items.filter(item => item.status === 'pending').length,
    queue: example ? samples.slice(1) : requests.items.filter(item => item.status === 'pending').map(mapRequest) };
  const blocked = !canWrite || busy || !saved;
  const placement = config.layouts[orientation][selected];
  return <section className="space-y-5" aria-label="노래방 오버레이 설정">
    <div className="space-y-2"><label className="text-sm font-semibold">OBS 노래방 오버레이 주소</label><div className={styles.address}>
      <button type="button" disabled={!url} aria-label={revealed ? '오버레이 주소 숨기기' : '오버레이 주소 표시'} data-hidden={!revealed} onClick={() => setRevealed(value => !value)}><span>{url || '주소를 불러오는 중'}</span></button>
      <Tooltip content={revealed ? '주소 숨기기' : '주소 표시'}><Button size="icon" variant="outline" disabled={!url} aria-label="주소 표시 전환" onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</Button></Tooltip>
      <Tooltip content="주소 복사"><Button size="icon" variant="outline" disabled={!url} aria-label="OBS 주소 복사" onClick={async () => { try { await navigator.clipboard.writeText(url); toast.success('OBS 주소를 복사했습니다.'); } catch { setRevealed(true); toast.error('복사하지 못했습니다. 표시된 주소를 확인해 주세요.'); } }}><Copy className="h-4 w-4" /></Button></Tooltip>
      <Tooltip content="새 주소 발급"><Button size="icon" variant="ghost" disabled={blocked} aria-label="새 오버레이 주소 발급" onClick={() => setConfirmation('rotate')}><RotateCcw className="h-4 w-4" /></Button></Tooltip>
    </div></div>
    {error ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-destructive pl-3 text-sm text-destructive"><span>{error}</span><Button size="sm" variant="outline" disabled={busy} onClick={() => dirty ? setConfirmation('reload') : void load()}>다시 불러오기</Button></div> : null}
    <div className={styles.editor}>
      <div className="min-w-0"><div className={styles.toolbar}>
        <div className={styles.segmented} aria-label="배치 화면비"><button type="button" aria-pressed={orientation === 'landscape'} onClick={() => setOrientation('landscape')}><Monitor />16:9</button><button type="button" aria-pressed={orientation === 'portrait'} onClick={() => setOrientation('portrait')}><Smartphone />9:16</button></div>
        <div className={styles.segmented} aria-label="미리보기 데이터"><button type="button" aria-pressed={example} onClick={() => setExample(true)}>예시 데이터</button><button type="button" aria-pressed={!example} onClick={() => setExample(false)}>실제 신청</button></div>
      </div><div className={styles.preview} data-orientation={orientation}><SongbookOverlayStage data={data} orientation={orientation} editable={!blocked} selected={selected} onSelect={setSelected} onLayout={layout} /></div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{orientation === 'landscape' ? '가로 배치 · 1920 × 1080' : '세로 배치 · 1080 × 1920'}</span><span role="status">{busy ? '불러오는 중' : dirty ? '저장하지 않은 변경 사항' : saved ? '저장된 배치' : '연결 대기'}</span></div>
        {!example && requests.error ? <p role="alert" className="mt-3 text-sm text-destructive">{requests.error}</p> : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2"><Tooltip content="선택한 화면비 배치 초기화"><Button variant="ghost" size="sm" disabled={blocked} onClick={() => update({ layouts: { ...config.layouts, [orientation]: DEFAULT_SONGBOOK_OVERLAY.layouts[orientation] } })}><RotateCcw className="h-4 w-4" />배치 초기화</Button></Tooltip><Button variant="outline" size="sm" disabled={blocked || !dirty} onClick={() => saved && accept(saved)}><Undo2 className="h-4 w-4" />변경 취소</Button><Button size="sm" disabled={blocked || !dirty} onClick={() => void persist()}><Save className="h-4 w-4" />{busy ? '저장 중' : '배치 저장'}</Button></div>
      </div>
      <div className={styles.controls}>
        <fieldset disabled={blocked}><legend>영역 배치</legend><div className={styles.fields}>
          <div className={styles.segmented}><button type="button" aria-pressed={selected === 'current'} onClick={() => setSelected('current')}>현재 곡</button><button type="button" aria-pressed={selected === 'queue'} onClick={() => setSelected('queue')}>신청 목록</button></div>
          <label className={styles.field}>영역 표시<input type="checkbox" checked={placement.visible} onChange={event => layout(orientation, selected, { visible: event.target.checked })} /></label>
          {(['x', 'y', 'width'] as const).map((key, i) => <label key={key} className={styles.field}><span>{['가로 위치', '세로 위치', '너비'][i]} (%)</span><input aria-label={`${['가로 위치', '세로 위치', '너비'][i]} (%)`} type="number" min={key === 'width' ? orientation === 'portrait' ? 40 : 18 : 0} max={100} step={0.1} value={Math.round(placement[key] * 10) / 10} onChange={event => { if (event.target.value !== '') layout(orientation, selected, { [key]: Number(event.target.value) }); }} /></label>)}
        </div></fieldset>
        <fieldset disabled={blocked}><legend>디자인</legend><div className={styles.fields}>
          {(['accent', 'text', 'background'] as const).map((key, i) => <label key={key} className={styles.field}>{['포인트 색', '글자 색', '배경 색'][i]}<input type="color" value={config[key]} onChange={event => update({ [key]: event.target.value })} /></label>)}
          <label className={styles.field}><span>배경 불투명도 {config.opacity}%</span><input aria-label="배경 불투명도" type="range" min={0} max={100} value={config.opacity} onChange={event => update({ opacity: Number(event.target.value) })} /></label>
          <label className={styles.field}><span>표시 크기 {Math.round(config.scale * 100)}%</span><input aria-label="표시 크기" type="range" min={70} max={150} value={Math.round(config.scale * 100)} onChange={event => update({ scale: Number(event.target.value) / 100 })} /></label>
          <label className={styles.field}>목록 표시 곡 수<input type="number" min={1} max={8} value={config.maxRows} onChange={event => { if (event.target.value) update({ maxRows: Number(event.target.value) }); }} /></label>
        </div></fieldset>
        <fieldset disabled={blocked}><legend>표시 정보</legend><div className={styles.fields}>
          {(['artwork', 'requester', 'keyShift', 'hideEmpty'] as const).map((key, i) => <label key={key} className={styles.field}>{['현재 곡 썸네일', '신청자', '현재 곡 키 조절', '빈 영역 숨기기'][i]}<input type="checkbox" checked={config[key]} onChange={event => update({ [key]: event.target.checked })} /></label>)}
        </div></fieldset>
      </div>
    </div>
    {confirmation ? <SongbookModal title={confirmation === 'rotate' ? '오버레이 주소 재발급' : '설정 다시 불러오기'} busy={busy} onClose={() => setConfirmation(null)}><p className="text-sm leading-6">{confirmation === 'rotate' ? '기존 주소는 즉시 사용할 수 없게 됩니다. 재발급 후 OBS 브라우저 소스의 주소도 변경해야 합니다.' : '저장하지 않은 변경을 버리고 서버에 저장된 배치를 불러올까요?'}</p><div className="mt-5 flex justify-end gap-2"><Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>취소</Button><Button disabled={busy} onClick={() => { if (confirmation === 'rotate') void persist(true); else { setConfirmation(null); void load(); } }}>{confirmation === 'rotate' ? '주소 재발급' : '다시 불러오기'}</Button></div></SongbookModal> : null}
  </section>;
}
