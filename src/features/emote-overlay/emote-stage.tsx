'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createEmoteEngine } from './emote-engine';
import type { EmoteImage, EmoteSettings } from './types';

export type EmoteStageHandle = {
  emit: (items: EmoteImage[], settings?: EmoteSettings, seed?: number) => void;
  clear: () => void;
  pause: (paused: boolean) => void;
};

export const EmoteStage = forwardRef<EmoteStageHandle, { settings: EmoteSettings; className?: string; onCount?: (count: number) => void }>(function EmoteStage({ settings, className = '', onCount }, ref) {
  const container = useRef<HTMLDivElement>(null);
  const engine = useRef<ReturnType<typeof createEmoteEngine> | null>(null);
  const latest = useRef(settings);
  const countCallback = useRef(onCount);
  latest.current = settings;
  countCallback.current = onCount;
  useEffect(() => {
    if (!container.current) return;
    const instance = createEmoteEngine(container.current, latest.current, { onCount: (count: number) => countCallback.current?.(count) });
    engine.current = instance;
    return () => { instance.destroy(); engine.current = null; };
  }, []);
  useEffect(() => { engine.current?.setSettings(settings); }, [settings]);
  useImperativeHandle(ref, () => ({
    emit: (items, config, seed) => { engine.current?.emit(items, { settings: config || latest.current, seed }); },
    clear: () => { engine.current?.clear(); },
    pause: paused => { engine.current?.pause(paused); },
  }), []);
  return <div ref={container} aria-hidden="true" data-emote-stage className={`relative h-full w-full overflow-hidden pointer-events-none ${className}`} />;
});
