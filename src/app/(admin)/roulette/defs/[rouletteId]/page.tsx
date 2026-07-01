import { Sparkles } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ rouletteId: string }> }) {
  const { rouletteId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="룰렛 상세"
      config={{
        title: `룰렛 ${rouletteId}`,
        description: '룰렛 아이템, 확률, 포인트 비용, 실행 옵션을 확인합니다.',
        endpoint: '/api/roulette/definitions',
        icon: Sparkles,
        actions: [
          { href: `/roulette/defs/${rouletteId}/edit`, label: '편집' },
          { href: `/roulette/defs/${rouletteId}/items/new`, label: '아이템 추가' },
        ],
      }}
    />
  );
}
