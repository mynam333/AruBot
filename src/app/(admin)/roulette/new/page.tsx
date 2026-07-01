import { Sparkles } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="룰렛"
      config={{
        title: '룰렛 추가',
        description: '기존 룰렛 실행 로직과 결과 채팅을 유지하며 새 정의를 등록합니다.',
        endpoint: '/api/roulette/definitions',
        icon: Sparkles,
        actions: [{ href: '/roulette', label: '목록으로' }],
      }}
    />
  );
}
