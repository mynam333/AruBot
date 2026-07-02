import { UserRound } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default async function Page({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;
  return (
    <AdminFeaturePage
      eyebrow="포인트 유저"
      config={{
        title: `유저 ${userId}`,
        description: '한 시청자의 포인트 흐름과 참여 기록을 한눈에 살펴봅니다.',
        endpoint: '/api/channelpoints/list',
        icon: UserRound,
        actions: [{ href: '/points', label: '목록으로' }],
      }}
    />
  );
}
