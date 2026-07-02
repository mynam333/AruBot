import { History } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="룰렛"
      config={{
        title: '룰렛 로그',
        description: '시청자와 함께 만든 룰렛 당첨 순간을 다시 살펴봅니다.',
        endpoint: '/api/roulette/logs',
        icon: History,
        actions: [{ href: '/roulette', label: '룰렛으로' }],
      }}
    />
  );
}
