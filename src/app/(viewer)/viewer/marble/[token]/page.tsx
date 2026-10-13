import { MarbleOverlayViewer } from '@/features/marble/marble-overlay-viewer';

export const metadata = { title: '주루마블 OBS', robots: { index: false, follow: false } };

export default async function MarbleViewerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <MarbleOverlayViewer token={token} />;
}
