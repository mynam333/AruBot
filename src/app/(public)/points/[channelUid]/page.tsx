import { notFound, redirect } from 'next/navigation';
import { decodeChannelRouteParam } from '@/shared/lib/channel-route-param';

export default async function Page({ params }: { params: Promise<{ channelUid: string }> }) {
  const { channelUid: routeChannelUid } = await params;
  const channelUid = decodeChannelRouteParam(routeChannelUid);
  if (!channelUid) notFound();
  redirect(`/c/${encodeURIComponent(channelUid)}/points`);
}
