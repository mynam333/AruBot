import { PlaySquare } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="영상 후원 상세"
      config={{
        title: `영상 요청 ${itemId}`,
        description: '개별 영상 요청의 재생/환불/스킵 상태를 확인합니다.',
        endpoint: '/api/video-donation/queue',
        icon: PlaySquare,
        actions: [{ href: '/video-donations/queue', label: '큐로 이동' }],
      }}
    />
  );
}
