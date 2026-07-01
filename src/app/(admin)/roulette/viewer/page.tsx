import { MonitorDot } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';
import { ViewerTokenPanel } from '@/features/admin/viewer-token-panel';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="룰렛"
      config={{
        title: '룰렛 OBS 주소',
        description: '룰렛 결과를 방송 화면에 띄울 OBS 브라우저 소스 주소를 관리해요.',
        endpoint: '/api/roulette/resolve-token',
        icon: MonitorDot,
      }}
    >
      <ViewerTokenPanel
        title="룰렛 화면 주소"
        description="이 주소를 OBS 브라우저 소스에 넣으면 룰렛 결과가 방송 화면에 표시돼요."
        endpoint="/api/roulette/viewer-url"
      />
    </AdminFeaturePage>
  );
}
