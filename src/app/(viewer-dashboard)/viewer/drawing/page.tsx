import type { Metadata } from 'next';
import { DrawingDonationListPage } from '@/features/viewer/drawing-donation-page';

export const metadata: Metadata = {
  title: '그림 후원 | AruBot',
  description: '포인트를 사용해 방송 화면에 그림을 띄웁니다.',
};

export default function ViewerDrawingRoute() {
  return <DrawingDonationListPage />;
}
