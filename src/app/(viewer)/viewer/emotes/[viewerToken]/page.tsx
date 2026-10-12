import type { Metadata } from 'next';
import { EmoteViewer } from '@/features/emote-overlay/emote-viewer';

export const metadata: Metadata = { title: '이모티콘 오버레이', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <EmoteViewer token={viewerToken} />;
}
