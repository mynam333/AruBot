import Link from 'next/link';
import { cn } from '@/shared/lib/utils';

export function LegalFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('mt-8 border-t pt-5 text-xs text-muted-foreground sm:text-sm', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="font-medium">AruBot</span>
        <nav aria-label="서비스 정책" className="flex flex-wrap gap-x-4 gap-y-2">
          <Link href="/terms" prefetch={false} className="transition hover:text-foreground">
            이용약관
          </Link>
          <Link href="/privacy" prefetch={false} className="transition hover:text-foreground">
            개인정보처리방침
          </Link>
        </nav>
      </div>
    </footer>
  );
}
