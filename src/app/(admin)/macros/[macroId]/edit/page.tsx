import { Timer } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ macroId: string }> }) {
  const { macroId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="매크로 편집"
      config={{
        title: `매크로 ${macroId} 편집`,
        description: '기존 매크로 메시지와 실행 주기를 변경합니다.',
        endpoint: '/api/macros',
        icon: Timer,
        actions: [{ href: `/macros/${macroId}/timers`, label: '타이머 보기' }],
      }}
    />
  );
}
