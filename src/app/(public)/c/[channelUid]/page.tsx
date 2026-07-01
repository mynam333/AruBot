import { PublicChannelHub } from '@/features/public/public-channel-page';

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  return <PublicChannelHub channelUid={channelUid} />;
}
