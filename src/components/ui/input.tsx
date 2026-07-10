import { cn } from '@/shared/lib/utils';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'box-border min-h-[var(--control-height)] w-full min-w-0 max-w-full rounded-[var(--radius-control)] border bg-card px-3.5 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70',
        props.className,
      )}
    />
  );
}
