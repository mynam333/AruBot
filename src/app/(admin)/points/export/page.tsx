import { Download } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="포인트"
      config={{
        title: '포인트 내보내기',
        description: '포인트 내역을 파일로 내려받습니다.',
        endpoint: '/api/channelpoints/list',
        icon: Download,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
