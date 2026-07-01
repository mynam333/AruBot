import { Radio } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="도움말"
      config={{
        title: '실시간 연결 도움말',
        description: '채팅과 방송 화면 연동이 준비되어 있는지 간단히 확인해요.',
        endpoint: '/api/version',
        icon: Radio,
        actions: [{ href: '/connection', label: '플랫폼 연결' }],
      }}
    />
  );
}
