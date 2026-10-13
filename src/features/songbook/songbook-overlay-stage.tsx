'use client';

import { Grip, ListMusic, Mic2, Music2 } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { SONGBOOK_OVERLAY_SIZES, songbookOverlayRect, songbookOverlayCapacity, type SongbookBlock, type SongbookOrientation, type SongbookOverlayItem, type SongbookOverlaySnapshot } from '../../../shared/songbook-overlay';
import styles from './songbook-overlay.module.css';

function MovingText({ children, large = false }: { children: string; large?: boolean }) {
  const frame = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = frame.current;
    const content = text.current;
    if (!container || !content) return;
    let animation: Animation | undefined;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const measure = () => {
      animation?.cancel();
      const distance = Math.max(0, content.scrollWidth - container.clientWidth);
      if (distance < 2 || motion.matches) return;
      const travel = Math.max(3000, distance / 30 * 1000);
      const duration = travel + 4500;
      animation = content.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: 2500 / duration },
        { transform: `translateX(-${distance}px)`, offset: (2500 + travel) / duration },
        { transform: `translateX(-${distance}px)`, offset: 0.9999 },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration, iterations: Infinity, easing: 'linear' });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container); observer.observe(content); motion.addEventListener('change', measure); measure();
    return () => { observer.disconnect(); animation?.cancel(); motion.removeEventListener('change', measure); };
  }, [children]);
  return <div ref={frame} className={large ? styles.title : styles.scrolling} title={children}><span ref={text}>{children}</span></div>;
}

function Artwork({ item }: { item: SongbookOverlayItem }) {
  const [failed, setFailed] = useState(false);
  return <div className={styles.artwork}>{item.videoId && !failed ? <img src={`https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Music2 />}</div>;
}

type Props = {
  data: SongbookOverlaySnapshot;
  orientation?: SongbookOrientation;
  selected?: SongbookBlock;
  editable?: boolean;
  onSelect?: (block: SongbookBlock) => void;
  onLayout?: (orientation: SongbookOrientation, block: SongbookBlock, patch: { x?: number; y?: number; width?: number }) => void;
};

export function SongbookOverlayStage({ data, orientation: forced, selected, editable = false, onSelect, onLayout }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 });
  const drag = useRef<{ pointer: number; x: number; y: number; block: SongbookBlock; start: { x: number; y: number; width: number; height: number }; resize: boolean } | null>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setViewport({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const orientation = forced || (viewport.width >= viewport.height ? 'landscape' : 'portrait');
  const canvas = SONGBOOK_OVERLAY_SIZES[orientation];
  const zoom = Math.max(0.01, Math.min(viewport.width / canvas.width, viewport.height / canvas.height));
  const config = data.config;
  const capacity = songbookOverlayCapacity(config, orientation);
  const variables = {
    '--karaoke-accent': config.accent, '--karaoke-text': config.text,
    '--karaoke-bg': `${config.background}${Math.round(config.opacity / 100 * 255).toString(16).padStart(2, '0')}`,
    '--karaoke-unit': `${config.scale}px`,
  } as CSSProperties;
  const begin = (event: PointerEvent<HTMLElement>, block: SongbookBlock, resize = false) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); onSelect?.(block);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, block, resize, start: songbookOverlayRect(config, orientation, block) };
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = (event.clientX - current.x) / zoom;
    const dy = (event.clientY - current.y) / zoom;
    if (current.resize) {
      const width = Math.min(canvas.width - current.start.x, Math.max(canvas.width * (orientation === 'portrait' ? 0.4 : 0.18), current.start.width + dx));
      onLayout?.(orientation, current.block, { width: width / canvas.width * 100 });
    } else {
      const x = Math.max(0, Math.min(canvas.width - current.start.width, current.start.x + dx));
      const y = Math.max(0, Math.min(canvas.height - current.start.height, current.start.y + dy));
      onLayout?.(orientation, current.block, { x: x / canvas.width * 100, y: y / canvas.height * 100 });
    }
  };
  const end = () => { drag.current = null; };
  const blockProps = (block: SongbookBlock) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => begin(event, block), onPointerMove: move, onPointerUp: end, onPointerCancel: end,
    onLostPointerCapture: end,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (!editable || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); onSelect?.(block);
      const rect = songbookOverlayRect(config, orientation, block);
      const step = event.shiftKey ? 10 : 1;
      onLayout?.(orientation, block, {
        x: (rect.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)) / canvas.width * 100,
        y: (rect.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)) / canvas.height * 100,
      });
    },
    tabIndex: editable ? 0 : undefined,
    'data-selected': editable && selected === block,
    'data-editable': editable,
    style: (() => { const r = songbookOverlayRect(config, orientation, block); return { left: r.x, top: r.y, width: r.width, height: r.height }; })(),
  });
  const handle = (block: SongbookBlock) => editable ? <button type="button" className={styles.resize} aria-label={`${block === 'current' ? '현재 곡' : '신청 목록'} 너비 조절`} title="드래그하여 너비 조절" onPointerDown={event => begin(event, block, true)}><Grip /></button> : null;
  const currentVisible = config.layouts[orientation].current.visible && (editable || !config.hideEmpty || data.current);
  const queueVisible = config.layouts[orientation].queue.visible && (editable || !config.hideEmpty || data.queue.length > 0);
  return <div ref={root} className={styles.viewport} aria-label="노래방 오버레이" data-orientation={orientation}>
    <div className={styles.stage} style={{ ...variables, width: canvas.width, height: canvas.height, left: (viewport.width - canvas.width * zoom) / 2, top: (viewport.height - canvas.height * zoom) / 2, transform: `scale(${zoom})` }}>
      {currentVisible ? <section {...blockProps('current')} className={`${styles.block} ${styles.current}`} aria-label="현재 곡 위치" title={editable ? '드래그 이동 · 방향키 미세 이동 · Shift + 방향키 10px 이동' : undefined}>
        <div className={styles.nowLabel}><Mic2 /><span>{data.current ? '지금 부르는 곡' : '다음 곡을 기다리는 중'}</span>{data.current ? <span className={styles.liveDot} /> : null}</div>
        {data.current ? <div className={styles.currentBody} key={data.current.id}>
          {config.artwork ? <Artwork key={data.current.videoId} item={data.current} /> : null}
          <div className={styles.currentInfo}><MovingText large>{data.current.title}</MovingText><MovingText>{data.current.artist}</MovingText>
            <div className={styles.credit}>{config.requester ? <span>신청 <b>{data.current.username || '시청자'}</b></span> : null}{config.keyShift ? <span>키 <b>{data.current.keyShift === 0 ? '원키' : `${data.current.keyShift > 0 ? '+' : ''}${data.current.keyShift}`}</b></span> : null}</div>
          </div>
        </div> : <div className={styles.emptyCurrent}><Music2 /><span>잠시 쉬어갈게요</span></div>}
        {handle('current')}
      </section> : null}
      {queueVisible ? <section {...blockProps('queue')} className={`${styles.block} ${styles.queue}`} aria-label="신청 목록 위치" title={editable ? '드래그 이동 · 방향키 미세 이동' : undefined}>
        <header className={styles.queueHeader}><span><ListMusic />신청곡</span><span className={styles.count}>{data.queueCount}<small>곡</small></span></header>
        <ol className={styles.queueRows}>{data.queue.slice(0, capacity).map((item, i) => <li key={item.id} className={styles.queueRow}>
          <span className={styles.rank}>{String(i + 1).padStart(2, '0')}</span><div className={styles.rowInfo}><MovingText>{item.title}</MovingText><div className={styles.rowMeta}><span>{item.artist}</span>{config.requester ? <span>{item.username || '시청자'}</span> : null}</div></div>
        </li>)}</ol>
        {!data.queue.length ? <div className={styles.emptyQueue}><Music2 /><span>첫 신청곡을 기다려요</span></div> : null}
        <footer className={styles.queueFooter}><span className={styles.openState} data-open={data.requestsEnabled}>{data.requestsEnabled ? '신청 받는 중' : '신청 마감'}</span><span>{data.queueCount > capacity ? `+${data.queueCount - capacity}곡` : '노래책'}</span></footer>
        {handle('queue')}
      </section> : null}
    </div>
  </div>;
}
