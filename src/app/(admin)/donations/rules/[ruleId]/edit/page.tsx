import { Gift } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="후원 규칙 편집"
      config={{
        title: `후원 규칙 ${ruleId} 편집`,
        description: '기존 후원 응답과 외부 이벤트 연동을 유지하며 세부 조건을 수정합니다.',
        endpoint: '/api/donation/rules',
        icon: Gift,
        actions: [{ href: '/donations/rules', label: '목록으로' }],
      }}
    />
  );
}
