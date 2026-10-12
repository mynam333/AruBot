import { PublicChannelPage } from '@/features/public/public-channel-page';

export const metadata = { title: '노래책 | AruBot' };

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  return <PublicChannelPage channelUid={channelUid} kind="songbook" />;
}
