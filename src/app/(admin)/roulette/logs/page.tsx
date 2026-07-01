import { History } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="룰렛"
      config={{
        title: '룰렛 로그',
        description: '공개 로그와 관리자 로그를 분리해 검색과 페이지네이션이 가능하게 구성합니다.',
        endpoint: '/api/roulette/logs',
        icon: History,
        actions: [{ href: '/roulette', label: '룰렛으로' }],
      }}
    />
  );
}
