import { PublicChannelPage } from '@/features/public/public-channel-page';

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  return <PublicChannelPage channelUid={channelUid} kind="points" />;
}
