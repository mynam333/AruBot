import { SongbookOverlayViewer } from '@/features/songbook/songbook-overlay-viewer';

export const metadata = { title: '노래방 오버레이 | 아루봇', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <SongbookOverlayViewer token={viewerToken} />;
}
