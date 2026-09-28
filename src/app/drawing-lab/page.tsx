import { notFound } from 'next/navigation';
import { DrawingStudio } from '@/components/drawing/DrawingStudio';

export default function DrawingLab() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <main className="mx-auto min-h-screen max-w-7xl bg-background p-4 text-foreground sm:p-6"><h1 className="mb-4 text-lg font-semibold">그림 후원 스튜디오</h1><DrawingStudio channelUid="local-preview" viewerUserId="local-preview" localOnly points={100000} settings={{ pricingMode: 'ink', costPoints: 100, inkCostPerUnit: 1, replayMaxSec: 12, maxPoints: 6000, maxStrokes: 120, canvas: { widthRatio: 16, heightRatio: 9 } }} /></main>;
}
