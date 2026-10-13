'use client';

import { useEffect, useState } from 'react';
import { apiUrl } from '@/shared/api/http';
import { connectSongbookOverlay } from '@/shared/api/songbook-overlay-connection';
import type { SongbookOverlaySnapshot } from '../../../shared/songbook-overlay';
import { SongbookOverlayStage } from './songbook-overlay-stage';
import styles from './songbook-overlay.module.css';

export function SongbookOverlayViewer({ token }: { token: string }) {
  const [data, setData] = useState<SongbookOverlaySnapshot | null>(null);
  useEffect(() => {
    setData(null);
    return connectSongbookOverlay({ url: apiUrl(`/api/overlays/songbook?token=${encodeURIComponent(token)}`), onData: setData });
  }, [token]);
  return <main className={styles.obs}>{data ? <SongbookOverlayStage data={data} /> : null}</main>;
}
