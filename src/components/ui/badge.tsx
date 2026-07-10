import { cn } from '@/shared/lib/utils';

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'cyan' | 'emerald' | 'amber' | 'rose' | 'violet' | 'mint' | 'coral' | 'lemon' | 'sky';
  className?: string;
}) {
  const tones = {
    neutral: 'border-border bg-muted text-muted-foreground',
    cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    mint: 'border-primary/25 bg-primary/10 text-primary',
    coral: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    lemon: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    sky: 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  };
  return (
    <span className={cn('inline-flex max-w-full shrink-0 items-center justify-center rounded-md border px-2 py-0.5 text-center text-[0.6875rem] font-semibold leading-5 tracking-normal sm:whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}
