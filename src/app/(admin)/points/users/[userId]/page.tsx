import { UserRound } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="포인트 유저"
      config={{
        title: `유저 ${userId}`,
        description: '개별 유저의 포인트 잔액, 영상 후원 차감, 룰렛 보상 이력을 확인합니다.',
        endpoint: '/api/channelpoints/list',
        icon: UserRound,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
