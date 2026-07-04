'use client';

import dynamic from 'next/dynamic';

const PvdViewer = dynamic(() => import('@/components/PvdViewer').then((mod) => mod.default), {
  ssr: false,
});

const RouletteViewer = dynamic(() => import('@/components/RouletteViewer').then((mod) => mod.default), {
  ssr: false,
});

export function PvdViewerRoute({ token }: { token: string }) {
  return <PvdViewer viewerToken={token} />;
}

export function RouletteViewerRoute({ token }: { token: string }) {
  return <RouletteViewer viewerToken={token} />;
}
