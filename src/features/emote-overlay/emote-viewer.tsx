'use client';

import { useEffect, useRef, useState } from 'react';
import { apiUrl } from '@/shared/api/http';
import { DEFAULT_EMOTE_SETTINGS, normalizeEmoteSettings } from '../../../shared/emote-overlay';
import { connectEmoteOverlay } from './emote-connection';
import { EmoteStage, type EmoteStageHandle } from './emote-stage';
import type { EmoteSettings, EmoteSnapshot } from './types';

export function EmoteViewer({ token }: { token: string }) {
  const stage = useRef<EmoteStageHandle>(null);
  const [settings, setSettings] = useState<EmoteSettings>(DEFAULT_EMOTE_SETTINGS);
  useEffect(() => connectEmoteOverlay({
    streamUrl: apiUrl(`/api/emote-overlay/stream?token=${encodeURIComponent(token)}`),
    stateUrl: apiUrl(`/api/emote-overlay/state?token=${encodeURIComponent(token)}`),
    onClear: () => stage.current?.clear(),
    onSnapshot: (snapshot: EmoteSnapshot & { cleared: boolean }) => {
      const config = normalizeEmoteSettings(snapshot.settings);
      setSettings(config);
      if (snapshot.cleared || !config.enabled) stage.current?.clear();
      if (config.enabled) for (const packet of snapshot.events) {
        stage.current?.emit(packet.items, normalizeEmoteSettings(packet.settings), packet.seed);
      }
    },
  }), [token]);
  return <main className="fixed inset-0 overflow-hidden bg-transparent"><EmoteStage ref={stage} settings={settings} /></main>;
}
