import { MessageSquare } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="명령어 상세"
      config={{
        title: `규칙 ${ruleId}`,
        description: '명령어 규칙의 응답, 포인트, 확률, 최근 사용 정보를 확인합니다.',
        endpoint: '/api/bot/rules',
        icon: MessageSquare,
        actions: [
          { href: `/commands/rules/${ruleId}/edit`, label: '편집' },
          { href: `/commands/rules/${ruleId}/history`, label: '히스토리' },
        ],
      }}
    />
  );
}
