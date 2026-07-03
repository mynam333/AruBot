import { PencilLine } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="명령어 편집"
      config={{
        title: `규칙 ${ruleId} 편집`,
        description: '명령어 문구와 조건을 다듬어요.',
        endpoint: '/api/bot/rules',
        icon: PencilLine,
        actions: [{ href: `/commands/rules/${ruleId}`, label: '상세로' }],
      }}
    />
  );
}
