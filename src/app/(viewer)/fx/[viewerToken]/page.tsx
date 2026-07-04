import { FxOverlay } from '@/components/FxOverlay';

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <FxOverlay token={viewerToken} />;
}
