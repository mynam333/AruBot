import { Upload } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="포인트"
      config={{
        title: '포인트 가져오기',
        description: '포인트 파일을 불러와 기존 내역에 더합니다.',
        endpoint: '/api/channelpoints/list',
        icon: Upload,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
