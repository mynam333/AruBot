import { AlertCircle, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { Button } from '@/components/ui/button';

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex min-w-0 flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-primary">{eyebrow}</div> : null}
        <h1 className="break-keep text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl break-keep text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function SectionHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox, className }: { title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; icon?: typeof Inbox; className?: string }) {
  return (
    <div className={cn('flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed bg-muted/20 px-5 py-10 text-center', className)}>
      <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg border bg-card text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = '정보를 불러오지 못했습니다', description, onRetry, className }: { title?: React.ReactNode; description?: React.ReactNode; onRetry?: () => void; className?: string }) {
  return (
    <div className={cn('flex min-h-48 flex-col items-center justify-center rounded-[var(--radius-card)] border border-destructive/25 bg-destructive/5 px-5 py-10 text-center', className)} role="alert">
      <span className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-destructive/10 text-destructive"><AlertCircle className="h-5 w-5" /></span>
      <div className="text-sm font-semibold">{title}</div>
      {description ? <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {onRetry ? <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}><RefreshCw className="h-4 w-4" />다시 시도</Button> : null}
    </div>
  );
}

export function StatusDot({ status = 'neutral', label }: { status?: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: React.ReactNode }) {
  const colors = { success: 'bg-emerald-500', warning: 'bg-amber-500', danger: 'bg-destructive', info: 'bg-sky-500', neutral: 'bg-slate-400' };
  return <span className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className={cn('h-2 w-2 rounded-full', colors[status])} />{label}</span>;
}
