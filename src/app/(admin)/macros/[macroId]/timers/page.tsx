import { AlarmClock } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ macroId: string }> }) {
  const { macroId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="매크로 타이머"
      config={{
        title: `매크로 ${macroId} 실행 예약`,
        description: '예약된 안내가 언제 나가고 어떤 반응을 만들었는지 살펴봅니다.',
        endpoint: '/api/macros',
        icon: AlarmClock,
        actions: [{ href: `/macros/${macroId}/edit`, label: '편집' }],
      }}
    />
  );
}
