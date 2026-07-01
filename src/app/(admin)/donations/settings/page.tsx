import { Settings2 } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="후원"
      config={{
        title: '후원 설정',
        description: '후원 이벤트 수신, 메시지 출력, 외부 연동 정책을 설정합니다.',
        endpoint: '/api/donation/settings',
        icon: Settings2,
        actions: [{ href: '/donations/rules', label: '규칙으로' }],
      }}
    />
  );
}
