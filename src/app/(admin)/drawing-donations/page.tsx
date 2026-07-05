import type { Metadata } from 'next';
import { DrawingDonationPage } from '@/features/admin/drawing-donation-page';

export const metadata: Metadata = {
  title: '그림 후원 | AruBot',
  description: '시청자가 그린 그림을 방송 화면에 오버레이로 띄웁니다.',
};

export default function DrawingDonationsRoute() {
  return <DrawingDonationPage />;
}
