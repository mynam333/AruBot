import { History } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="명령어 히스토리"
      config={{
        title: `규칙 ${ruleId} 사용 기록`,
        description: '명령어 사용 기록과 포인트 차감 결과를 확인합니다.',
        endpoint: '/api/bot/stats',
        icon: History,
        actions: [{ href: `/commands/rules/${ruleId}`, label: '상세로' }],
      }}
    />
  );
}
