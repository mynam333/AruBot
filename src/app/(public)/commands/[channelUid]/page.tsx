import { redirect } from 'next/navigation';

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid } = await params;
  redirect(`/c/${encodeURIComponent(channelUid)}/commands`);
}
