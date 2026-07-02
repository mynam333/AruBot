/* eslint-disable react-refresh/only-export-components */
import type { Metadata } from 'next';
import { ViewerConnectPage } from '@/features/viewer/viewer-connect-page';

export const metadata: Metadata = {
  title: '계정 연결 | AruBot',
  description: 'CHZZK와 CIME 시청자 계정을 하나의 AruBot 계정에 연결합니다.',
};

export default function ViewerConnectRoute() {
  return <ViewerConnectPage />;
}
