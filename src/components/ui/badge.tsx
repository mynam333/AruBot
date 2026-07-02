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
    neutral: 'border-border bg-muted/70 text-muted-foreground',
    cyan: 'border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
    emerald: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    violet: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300',
    mint: 'border-teal-500/25 bg-pastel-mint/55 text-teal-800 dark:text-teal-100',
    coral: 'border-orange-500/25 bg-pastel-coral/55 text-rose-900 dark:text-rose-100',
    lemon: 'border-amber-500/25 bg-pastel-lemon/60 text-amber-900 dark:text-amber-100',
    sky: 'border-sky-500/25 bg-pastel-sky/60 text-sky-900 dark:text-sky-100',
  };
  return (
    <span className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold leading-none tracking-normal', tones[tone], className)}>
      {children}
    </span>
  );
}
