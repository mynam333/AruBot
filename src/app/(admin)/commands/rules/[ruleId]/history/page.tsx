import { History } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="명령어 히스토리"
      config={{
        title: `규칙 ${ruleId} 사용 기록`,
        description: '실행 횟수, 실패, 포인트 차감 결과를 추적하기 위한 전용 화면입니다.',
        endpoint: '/api/bot/stats',
        icon: History,
        actions: [{ href: `/commands/rules/${ruleId}`, label: '상세로' }],
      }}
    />
  );
}
