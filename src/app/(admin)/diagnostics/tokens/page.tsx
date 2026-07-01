import { KeyRound } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="도움말"
      config={{
        title: '주소와 연결 도움말',
        description: '공개 페이지와 OBS 화면 주소가 준비되어 있는지 간단히 확인해요.',
        endpoint: '/api/channel/tokens/list',
        icon: KeyRound,
        actions: [{ href: '/settings', label: '설정 열기' }],
      }}
    />
  );
}
