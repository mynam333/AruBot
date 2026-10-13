import { MarbleParticipantPage } from '@/features/marble/marble-participant-page';

export default async function Page({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await params;
  return <MarbleParticipantPage key={ownerId} ownerId={ownerId} />;
}
