import { PredictionOverlay } from '@/features/viewer/prediction-overlay';

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  return <PredictionOverlay channelUid={channelUid} />;
}
