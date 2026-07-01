import { ViewerBodyClass } from '@/features/viewer/viewer-body-class';

export default function ViewerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="viewer-route min-h-screen bg-transparent">
      <ViewerBodyClass />
      {children}
    </div>
  );
}
