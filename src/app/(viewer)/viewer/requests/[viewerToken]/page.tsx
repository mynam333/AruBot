import { RequestQueueOverlay } from '@/features/viewer/request-queue-overlay';

export const metadata = { title: '신청곡 리스트 | 아루봇', robots: { index: false, follow: false }, referrer: 'no-referrer' as const };

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <RequestQueueOverlay token={viewerToken} />;
}
