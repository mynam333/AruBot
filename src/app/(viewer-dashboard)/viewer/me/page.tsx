/* eslint-disable react-refresh/only-export-components */
import type { Metadata } from 'next';
import { ViewerPointsPage } from '@/features/viewer/viewer-points-page';

export const metadata: Metadata = {
  title: '내 포인트 | AruBot',
  description: 'CHZZK와 CIME 시청자 포인트를 한 계정으로 확인합니다.',
};

export default function ViewerMeRoute() {
  return <ViewerPointsPage />;
}
