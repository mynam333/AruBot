import { Upload } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="포인트"
      config={{
        title: '포인트 가져오기',
        description: '기존 백업 파일 또는 외부 포인트 목록을 안전하게 병합합니다.',
        endpoint: '/api/channelpoints/list',
        icon: Upload,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
