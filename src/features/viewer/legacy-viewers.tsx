'use client';

import dynamic from 'next/dynamic';

const PvdViewer = dynamic(() => import('@/components/PvdViewer').then((mod) => mod.default), {
  ssr: false,
});

const RouletteViewer = dynamic(() => import('@/components/RouletteViewer').then((mod) => mod.default), {
  ssr: false,
});

export function PvdViewerRoute({ token, playerRole = 'video' }: { token: string; playerRole?: 'video' | 'bgm' }) {
  return <PvdViewer viewerToken={token} playerRole={playerRole} />;
}

export function RouletteViewerRoute({ token }: { token: string }) {
  return <RouletteViewer viewerToken={token} />;
}
