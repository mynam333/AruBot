'use client';

import { Clapperboard, ListMusic, Music2, Pause, Radio } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/shared/api/http';
import { titleScrollTiming, visibleQueueRows } from './request-queue-layout';
import styles from './request-queue-overlay.module.css';

type QueueItem = {
  id: string;
  title: string;
  username: string;
  kind: 'video' | 'bgm';
  idle: boolean;
  resumed: boolean;
  durationSec: number;
  thumbnailUrl: string | null;
};

type QueueDisplay = {
  currentItem: QueueItem | null;
  waitingItems: QueueItem[];
  waitingCount: number;
  elapsedSec: number;
  status: 'playing' | 'paused' | 'waiting' | 'empty';
  serverNow: number;
};

function seconds(value: number) {
  const total = Math.max(0, Math.floor(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function ScrollingTitle({ title }: { title: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = frame.current;
    const content = text.current;
    if (!container || !content) return;
    let animation: Animation | undefined;
    let previous = -1;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const measure = () => {
      const distance = Math.max(0, content.scrollWidth - container.clientWidth);
      if (distance === previous) return;
      previous = distance;
      animation?.cancel();
      if (distance < 2 || motion.matches) return;
      const timing = titleScrollTiming(distance);
      animation = content.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: timing.start },
        { transform: `translateX(-${distance}px)`, offset: timing.end },
        { transform: `translateX(-${distance}px)`, offset: timing.reset },
        { transform: 'translateX(0)', offset: 1 },
      ], { duration: timing.duration, iterations: Infinity, easing: 'linear' });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(content);
    const changeMotion = () => { previous = -1; measure(); };
    motion.addEventListener('change', changeMotion);
    measure();
    return () => { observer.disconnect(); animation?.cancel(); motion.removeEventListener('change', changeMotion); };
  }, [title]);
  return <div ref={frame} className={styles.titleClip} title={title}><span ref={text} className={styles.titleText}>{title}</span></div>;
}

function Artwork({ item }: { item: QueueItem }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.thumbnailUrl]);
  return <div className={styles.artwork} data-kind={item.kind}>
    {item.kind === 'bgm' ? <Music2 /> : <Clapperboard />}
    {item.thumbnailUrl && !failed ? <img src={item.thumbnailUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : null}
  </div>;
}

export function RequestQueueOverlay({ token }: { token: string }) {
  const [data, setData] = useState<QueueDisplay | null>(null);
  const [connection, setConnection] = useState<'connecting' | 'online' | 'retrying' | 'expired'>('connecting');
  const [receivedAt, setReceivedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [capacity, setCapacity] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    let failures = 0;
    setData(null);
    setConnection('connecting');
    async function sync() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let delay = 2000;
      try {
        const response = await fetch(apiUrl(`/api/video-donation/queue-display?token=${encodeURIComponent(token)}`), {
          signal: controller.signal, credentials: 'omit', cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 400 || response.status === 404) {
            if (!disposed) { setData(null); setConnection('expired'); }
            delay = 30000;
          }
          throw new Error('queue_unavailable');
        }
        const next = await response.json() as QueueDisplay;
        if (!Array.isArray(next.waitingItems) || !Number.isFinite(next.waitingCount)) throw new Error('invalid_queue');
        if (!disposed) {
          setData(next);
          setReceivedAt(performance.now());
          setClock(performance.now());
          setConnection('online');
        }
        failures = 0;
      } catch {
        if (!disposed && delay !== 30000) setConnection('retrying');
        delay = Math.max(delay, Math.min(30000, 2000 * 2 ** Math.min(++failures, 4)));
      } finally {
        clearTimeout(timeout);
        if (!disposed) timer = setTimeout(sync, delay);
      }
    }
    void sync();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [token]);

  useEffect(() => {
    const timer = setInterval(() => setClock(performance.now()), 500);
    return () => clearInterval(timer);
  }, []);

  const waitingCount = data?.waitingCount || 0;
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const css = getComputedStyle(element);
      setCapacity(visibleQueueRows(element.clientHeight, parseFloat(css.getPropertyValue('--queue-row-height')) || 72, waitingCount));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, [waitingCount]);

  const current = data?.currentItem;
  const playing = connection === 'online' && data?.status === 'playing';
  const elapsed = Math.min(current?.durationSec || Infinity, (data?.elapsedSec || 0)
    + (playing ? Math.max(0, clock - receivedAt) / 1000 : 0));
  const visible = data?.waitingItems.slice(0, capacity) || [];
  const hidden = Math.max(0, waitingCount - visible.length);
  const status = connection === 'expired' ? '주소 만료' : connection === 'retrying' ? '다시 연결 중'
    : connection === 'connecting' ? '연결 중' : data?.status === 'paused' ? '일시정지'
      : data?.status === 'waiting' ? '재생 대기' : current ? '지금 재생 중' : '재생 대기';

  return (
    <main className={styles.surface} aria-label="신청곡 리스트 오버레이">
      <section className={styles.frame}>
        <header className={styles.header}>
          <div className={styles.heading}><ListMusic aria-hidden="true" /><h1>신청곡</h1></div>
          <span className={styles.total}>대기 <b>{waitingCount}</b>곡</span>
        </header>
        <section className={styles.current} data-kind={current?.kind || 'bgm'} data-playing={playing} aria-label="현재 재생">
          <div className={styles.nowLabel}>
            <span className={styles.playbackState}>
              {playing ? <span className={styles.equalizer} aria-hidden="true"><i /><i /><i /><i /></span> : data?.status === 'paused' ? <Pause /> : <Radio />}
              {status}
            </span>
            {current ? <span className={styles.kind}>{current.idle ? '대기 음악' : current.kind === 'bgm' ? 'BGM' : '영상 후원'}</span> : null}
          </div>
          {current ? <>
            <div className={styles.currentTrack}>
              <Artwork item={current} />
              <div className={styles.currentInfo}>
                <ScrollingTitle title={current.title} />
                <div className={styles.byline}>{current.idle ? '자동 재생' : current.username || '시청자 신청'}{current.resumed ? ' · 이어 재생' : ''}</div>
              </div>
            </div>
            <div className={styles.progressLine}>
              <div className={styles.progress}><span style={{ width: `${current.durationSec ? Math.min(100, elapsed / current.durationSec * 100) : 0}%` }} /></div>
              <span>{seconds(elapsed)}<span className={styles.duration}> / {current.durationSec ? seconds(current.durationSec) : '--:--'}</span></span>
            </div>
          </> : <div className={styles.emptyCurrent}><Music2 /><span>{waitingCount ? '다음 곡을 기다리고 있어요' : '신청곡을 기다리고 있어요'}</span></div>}
        </section>
        <div className={styles.nextHeading}><span>다음 재생</span><span>UP NEXT</span></div>
        <div className={styles.list} ref={list}>
          <ol>
            {visible.map((item, index) => <li key={item.id} className={styles.row} data-kind={item.kind}>
              <span className={styles.rank}>{String(index + 1).padStart(2, '0')}</span>
              <Artwork item={item} />
              <div className={styles.rowInfo}>
                <ScrollingTitle title={item.title} />
                <div className={styles.rowDetails}><span className={styles.kind}>{item.kind === 'bgm' ? 'BGM' : '영상 후원'}</span><span className={styles.requester}>{item.resumed ? '이어 재생 · ' : ''}{item.username || '시청자 신청'}</span></div>
              </div>
              <span className={styles.rowDuration}>{item.durationSec ? seconds(item.durationSec) : '--:--'}</span>
            </li>)}
          </ol>
          {hidden > 0 ? <div className={styles.overflow} aria-label={`추가 대기 ${hidden}곡`}>… <b>+{hidden}곡</b></div>
            : !waitingCount ? <div className={styles.emptyQueue}>대기 중인 신청곡이 없습니다</div> : null}
        </div>
      </section>
    </main>
  );
}
