import { Download } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="포인트"
      config={{
        title: '포인트 내보내기',
        description: '유저별 포인트를 백업하거나 다른 환경으로 이전합니다.',
        endpoint: '/api/channelpoints/list',
        icon: Download,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
