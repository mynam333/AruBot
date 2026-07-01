import { TimerReset } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="매크로"
      config={{
        title: '매크로 추가',
        description: '반복 채팅과 예약 공지를 `next_run_at` 기반으로 저장해 폴링 부하를 줄입니다.',
        endpoint: '/api/macros',
        icon: TimerReset,
        actions: [{ href: '/macros', label: '목록으로' }],
      }}
    />
  );
}
