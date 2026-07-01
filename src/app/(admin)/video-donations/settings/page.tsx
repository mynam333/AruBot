import { SlidersHorizontal } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="영상 후원"
      config={{
        title: '영상 후원 설정',
        description: '초당 포인트, 최대 재생 시간, 유저별 큐 제한, 수락 여부를 관리합니다.',
        endpoint: '/api/video-donation/settings',
        icon: SlidersHorizontal,
        actions: [{ href: '/video-donations/queue', label: '큐로 이동' }],
      }}
    />
  );
}
