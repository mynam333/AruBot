import { cn } from '@/shared/lib/utils';

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('min-w-0 max-w-full rounded-[var(--radius-card)] border bg-card/90 text-card-foreground shadow-subtle backdrop-blur-xl', className)} {...props}>
      {children}
    </section>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex min-w-0 flex-col gap-2 p-[clamp(1rem,2vw,1.25rem)]', className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h2 className={cn('text-lg font-semibold tracking-normal', className)}>{children}</h2>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('text-sm leading-6 text-muted-foreground', className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('min-w-0 p-[clamp(1rem,2vw,1.25rem)] pt-0', className)}>{children}</div>;
}
