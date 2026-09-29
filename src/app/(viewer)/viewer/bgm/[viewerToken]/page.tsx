import { PvdViewerRoute } from '@/features/viewer/legacy-viewers';

export const metadata = { title: 'BGM 플레이어 | 아루봇', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <PvdViewerRoute token={viewerToken} playerRole="bgm" />;
}
