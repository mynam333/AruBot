'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { MarbleStage } from './marble-stage';
import { useMarbleSnapshot } from './use-marble-snapshot';
import styles from './marble-stage.module.css';

export function MarbleOverlayViewer({ token }: { token: string }) {
  const { snapshot, error, refresh } = useMarbleSnapshot(`/api/overlays/marble?token=${encodeURIComponent(token)}`);
  return <main className={styles.obs} aria-label="주루마블 방송 화면">
    {snapshot ? <MarbleStage snapshot={snapshot} /> : null}
    {error ? <div className={styles.connection} role="status" data-stale={!!snapshot}>
      <WifiOff aria-hidden="true" /><span>{snapshot ? '연결 복구 중' : error}</span>
      <button type="button" onClick={() => void refresh()} aria-label="다시 연결" title={error}><RefreshCw /></button>
    </div> : !snapshot ? <div className={styles.connection} role="status"><span className={styles.loadingDot} />게임 연결 중</div> : null}
  </main>;
}
