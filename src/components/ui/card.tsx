import { cn } from '@/shared/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('min-w-0 max-w-full rounded-[var(--radius-card)] border bg-card text-card-foreground shadow-subtle', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex min-w-0 flex-col gap-1.5 border-b p-[clamp(1rem,2vw,1.25rem)]', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-base font-semibold tracking-tight', className)}>{children}</h2>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm leading-6 text-muted-foreground', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('min-w-0 p-[clamp(1rem,2vw,1.25rem)]', className)}>{children}</div>;
}
