import { MonitorPlay } from 'lucide-react';
import { AdminFeaturePage } from '@/features/admin/admin-page';
import { ViewerTokenPanel } from '@/features/admin/viewer-token-panel';

export default function Page() {
  return (
    <AdminFeaturePage
      eyebrow="영상 후원"
      config={{
        title: '영상 후원 OBS 주소',
        description: 'OBS 브라우저 소스에 붙여 넣을 영상 후원 화면 주소를 관리해요.',
        endpoint: '/api/video-donation/viewer-url',
        icon: MonitorPlay,
      }}
    >
      <ViewerTokenPanel
        title="영상 후원 화면 주소"
        description="이 주소를 OBS 브라우저 소스에 넣으면 시청자가 보낸 영상이 방송 화면에 표시돼요."
        endpoint="/api/video-donation/viewer-url"
        rotateEndpoint="/api/video-donation/rotate-viewer-token"
      />
    </AdminFeaturePage>
  );
}
