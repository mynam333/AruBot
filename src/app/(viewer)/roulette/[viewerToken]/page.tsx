import { RouletteViewerRoute } from '@/features/viewer/legacy-viewers';

export default async function Page({ params }: { params: Promise<{ viewerToken: string }> }) {
  const { viewerToken } = await params;
  return <RouletteViewerRoute token={viewerToken} />;
}
