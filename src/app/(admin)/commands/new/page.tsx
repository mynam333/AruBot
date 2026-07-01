import { MessageSquarePlus } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="명령어"
      config={{
        title: '명령어 규칙 추가',
        description: '기존 봇 규칙 구조를 유지하면서 새 명령어, 응답, 포인트 비용, 쿨다운을 등록합니다.',
        endpoint: '/api/bot/rules',
        icon: MessageSquarePlus,
        actions: [{ href: '/commands', label: '목록으로' }],
      }}
    />
  );
}
