'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderOpen, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { decodeDrawingArchive, MAX_ARUART_BYTES, type DrawingArchive } from '../../../shared/drawing/archive.js';
import { buildTimeline } from '../../../shared/drawing/document.js';
import { createDrawingRenderer, type DrawingRenderer } from '../../../shared/drawing/renderer.js';
import { downloadDrawingBlob } from '@/shared/drawing/archive-files';

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

export function DrawingArchivePlayer() {
  const [archive, setArchive] = useState<DrawingArchive | null>(null), [filename, setFilename] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0), [speed, setSpeed] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null), fileInput = useRef<HTMLInputElement>(null);
  const renderer = useRef<DrawingRenderer | null>(null), original = useRef<HTMLImageElement | null>(null);
  const frame = useRef(0), request = useRef(0), time = useRef(0);
  const duration = useMemo(() => archive ? buildTimeline(archive.document, archive.manifest.replayMaxSec).targetReplayMs : 0, [archive]);

  function stop() { cancelAnimationFrame(frame.current); frame.current = 0; setPlaying(false); }
  function draw(next: number) {
    if (!archive || !canvas.current) return;
    const ctx = canvas.current.getContext('2d'); if (!ctx) return;
    renderer.current ||= createDrawingRenderer((w, h) => { const output = document.createElement('canvas'); output.width = w; output.height = h; return output; });
    const source = next >= duration && original.current ? original.current : renderer.current.render(archive.document, next, archive.manifest.replayMaxSec);
    ctx.clearRect(0, 0, archive.document.width, archive.document.height); ctx.drawImage(source, 0, 0);
    time.current = next; setPosition(next);
  }
  async function open(file?: File) {
    if (!file) return;
    const id = ++request.current; stop(); setBusy(true); setError('');
    try {
      if (!file.name.toLowerCase().endsWith('.aruart') || file.size > MAX_ARUART_BYTES) throw new Error('invalid');
      const loaded = await decodeDrawingArchive(new Uint8Array(await file.arrayBuffer()));
      const url = URL.createObjectURL(new Blob([loaded.image], { type: loaded.manifest.contentType }));
      const image = new Image();
      try { image.src = url; await image.decode(); } finally { URL.revokeObjectURL(url); }
      if (image.naturalWidth !== loaded.document.width || image.naturalHeight !== loaded.document.height) throw new Error('invalid');
      if (id !== request.current) return;
      renderer.current?.clear(); original.current = image; time.current = 0;
      setArchive(loaded); setFilename(file.name); setPosition(0);
    } catch { if (id === request.current) setError('파일이 손상되었거나 지원하지 않는 그리기 기록입니다.'); }
    finally { if (id === request.current) setBusy(false); }
  }
  function play() {
    if (!archive || busy) return;
    if (playing) { stop(); return; }
    const offset = time.current >= duration ? 0 : time.current, started = performance.now();
    setPlaying(true);
    const tick = (now: number) => {
      const next = Math.min(duration, offset + (now - started) * speed); draw(next);
      if (next < duration) frame.current = requestAnimationFrame(tick); else stop();
    };
    frame.current = requestAnimationFrame(tick);
  }
  useEffect(() => {
    if (!archive || !canvas.current || !original.current) return;
    canvas.current.getContext('2d')?.drawImage(original.current, 0, 0);
    const end = buildTimeline(archive.document, archive.manifest.replayMaxSec).targetReplayMs;
    time.current = end; setPosition(end);
  }, [archive]);
  useEffect(() => () => { request.current++; cancelAnimationFrame(frame.current); renderer.current?.clear(); }, []);

  return <section className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-4"><h3 className="text-lg font-semibold">AruArt</h3><Button onClick={() => fileInput.current?.click()} disabled={busy}><FolderOpen size={17} />{busy ? '불러오는 중' : '파일 열기'}</Button></header>
    <input ref={fileInput} type="file" accept=".aruart" aria-label="AruArt 파일" className="sr-only" onChange={(e) => { void open(e.target.files?.[0]); e.target.value = ''; }} />
    {error ? <p role="alert" className="text-sm text-rose-600">{error}</p> : null}
    <div className="mx-auto flex max-h-[48dvh] min-h-48 w-full items-center justify-center overflow-hidden border bg-white" style={{ aspectRatio: archive ? `${archive.document.width}/${archive.document.height}` : '16/9', backgroundImage: 'conic-gradient(#eee 25%, #fff 0 50%, #eee 0 75%, #fff 0)', backgroundSize: '20px 20px' }}>
      {archive ? <canvas ref={canvas} width={archive.document.width} height={archive.document.height} aria-label="보관된 그림" className="h-full w-full object-contain" /> : <span className="text-sm text-muted-foreground">파일 없음</span>}
    </div>
    <div className="flex flex-wrap items-center gap-2 border-y py-3">
      <Tooltip content={playing ? '일시정지' : '재생'}><Button size="icon" variant="outline" aria-label={playing ? '일시정지' : '재생'} disabled={!archive || busy} onClick={play}>{playing ? <Pause size={17} /> : <Play size={17} />}</Button></Tooltip>
      <Tooltip content="처음으로"><Button size="icon" variant="outline" aria-label="처음으로" disabled={!archive || busy} onClick={() => { stop(); draw(0); }}><RotateCcw size={17} /></Button></Tooltip>
      <input type="range" min={0} max={Math.max(1, duration)} step={1} value={position} aria-label="재생 위치" className="min-w-24 flex-1 accent-primary" disabled={!archive || busy} onChange={(e) => { stop(); draw(Number(e.target.value)); }} />
      <output className="text-xs tabular-nums">{clock(position)} / {clock(duration)}</output>
      <select aria-label="재생 속도" value={speed} className="h-9 rounded-md border bg-background px-2 text-sm" onChange={(e) => { stop(); setSpeed(Number(e.target.value)); }}>{[0.5, 1, 2, 4].map((n) => <option key={n} value={n}>{n}x</option>)}</select>
      <Tooltip content="이미지 저장"><Button size="icon" variant="outline" aria-label="이미지 저장" disabled={!archive || busy} onClick={() => { if (archive) downloadDrawingBlob(new Blob([archive.image], { type: archive.manifest.contentType }), filename.replace(/\.aruart$/i, archive.manifest.contentType === 'image/webp' ? '.webp' : '.png')); }}><Download size={17} /></Button></Tooltip>
    </div>
    <div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span className="min-w-0 break-all">{filename || '.aruart'}</span>{archive ? <span>{archive.document.width} x {archive.document.height} · {archive.document.strokes.length}획</span> : null}</div>
  </section>;
}
