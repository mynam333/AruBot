import { PencilLine } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ rouletteId: string }> }) {
  const { rouletteId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="룰렛 편집"
      config={{
        title: `룰렛 ${rouletteId} 편집`,
        description: '룰렛 정의를 수정하되 기존 뷰어와 로그 경로는 유지합니다.',
        endpoint: '/api/roulette/definitions',
        icon: PencilLine,
        actions: [{ href: `/roulette/defs/${rouletteId}`, label: '상세로' }],
      }}
    />
  );
}
