import DrawingDonationOverlay from '@/components/DrawingDonationOverlay';

export default async function DrawingOverlayRoute({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <DrawingDonationOverlay viewerToken={viewerToken} />;
}
