import { MessageSquare } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="명령어 상세"
      config={{
        title: `규칙 ${ruleId}`,
        description: '이 명령어가 채팅에서 어떤 답변과 포인트 반응으로 이어지는지 살펴봅니다.',
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
