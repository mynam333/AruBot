import { cn } from '@/shared/lib/utils';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-[var(--control-height)] rounded-[var(--radius-control)] border bg-background/80 px-[clamp(0.75rem,1.4vw,1rem)] text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary/45 focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        props.className,
      )}
    />
  );
}
