import { Gift } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="후원 규칙"
      config={{
        title: '후원 규칙 추가',
        description: '금액 조건, 응답, 이벤트, 변수 치환을 조합해 새 후원 규칙을 만듭니다.',
        endpoint: '/api/donation/rules',
        icon: Gift,
        actions: [{ href: '/donations/rules', label: '목록으로' }],
      }}
    />
  );
}
