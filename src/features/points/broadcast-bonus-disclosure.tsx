import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function BroadcastBonusDisclosure({ children, active, hidden }: {
  children: ReactNode; active?: boolean; hidden?: boolean;
}) {
  return (
    <section aria-label="추가 포인트" hidden={hidden}>
      <details className="group border-t">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 group-open:rotate-90 motion-safe:transition-transform" />
          <span>추가 포인트</span>
          {active && <span className="text-xs font-medium text-primary">사용 중</span>}
        </summary>
        <div className="grid min-w-0 gap-3 pb-3">{children}</div>
      </details>
    </section>
  );
}
