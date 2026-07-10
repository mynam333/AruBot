import type { Metadata } from 'next';
import { ViewerPointsPage } from '@/features/viewer/viewer-points-page';

export const metadata: Metadata = {
  title: '내 포인트 | AruBot',
  description: '방송마다 쌓인 CHZZK와 CIME 포인트를 한곳에서 모아 봅니다.',
};

export default function ViewerMeRoute() {
  return <ViewerPointsPage />;
}
