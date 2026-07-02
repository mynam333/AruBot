import Link from 'next/link';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-[var(--control-height)] max-w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-[clamp(0.875rem,1.6vw,1.125rem)] text-sm font-semibold tracking-normal transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-subtle hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0',
        secondary: 'bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-muted active:translate-y-0',
        ghost: 'hover:bg-muted active:translate-y-0',
        outline: 'border bg-card/80 hover:-translate-y-0.5 hover:border-primary/35 hover:bg-pastel-sky/45 active:translate-y-0 dark:hover:bg-muted',
        soft: 'bg-pastel-mint/70 text-teal-950 hover:-translate-y-0.5 hover:bg-pastel-mint dark:bg-primary/20 dark:text-teal-50 dark:hover:bg-primary/25',
        destructive: 'bg-destructive text-destructive-foreground shadow-subtle hover:-translate-y-0.5 hover:shadow-lift active:translate-y-0',
      },
      size: {
        default: 'min-h-[var(--control-height)]',
        sm: 'min-h-[var(--control-height-sm)] px-[clamp(0.75rem,1.2vw,1rem)] text-xs',
        lg: 'min-h-[var(--control-height-lg)] px-[clamp(1rem,1.9vw,1.375rem)]',
        icon: 'aspect-square min-h-[var(--control-height)] w-[var(--control-height)] px-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export function LinkButton({
  href,
  children,
  className,
  variant,
  size,
  prefetch = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: VariantProps<typeof buttonVariants>['variant'];
  size?: VariantProps<typeof buttonVariants>['size'];
  prefetch?: boolean;
}) {
  return (
    <Button asChild variant={variant} size={size} className={className}>
      <Link href={href} prefetch={prefetch}>{children}</Link>
    </Button>
  );
}
