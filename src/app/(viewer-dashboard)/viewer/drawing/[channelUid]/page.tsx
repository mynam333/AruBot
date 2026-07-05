import type { Metadata } from 'next';
import { DrawingDonationEditorPage } from '@/features/viewer/drawing-donation-page';

export const metadata: Metadata = {
  title: '그림 그리기 | AruBot',
  description: '방송 화면에 올라갈 그림을 그립니다.',
};

export default async function ViewerDrawingEditorRoute({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  return <DrawingDonationEditorPage channelUid={decodeURIComponent(channelUid)} />;
}
