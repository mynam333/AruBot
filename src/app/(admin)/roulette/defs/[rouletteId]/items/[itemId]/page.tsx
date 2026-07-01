import { ListChecks } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ rouletteId: string; itemId: string }> }) {
  const { rouletteId, itemId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="룰렛 아이템"
      config={{
        title: `룰렛 ${rouletteId} / 아이템 ${itemId}`,
        description: '개별 룰렛 아이템의 가중치, 메시지, 보상, 명령 실행 옵션을 확인합니다.',
        endpoint: '/api/roulette/definitions',
        icon: ListChecks,
        actions: [{ href: `/roulette/defs/${rouletteId}`, label: '룰렛으로' }],
      }}
    />
  );
}
