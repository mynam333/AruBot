import { AlarmClock } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ macroId: string }> }) {
  const { macroId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="매크로 타이머"
      config={{
        title: `매크로 ${macroId} 실행 예약`,
        description: '다음 실행 시각과 최근 실행 결과를 분리해 확인합니다.',
        endpoint: '/api/macros',
        icon: AlarmClock,
        actions: [{ href: `/macros/${macroId}/edit`, label: '편집' }],
      }}
    />
  );
}
