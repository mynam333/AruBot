import Link from 'next/link';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';

const buttonVariants = cva(
  'inline-flex min-h-[var(--control-height)] max-w-full min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] px-4 text-center text-sm font-semibold leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border border-primary bg-primary text-primary-foreground shadow-subtle hover:bg-primary/90',
        secondary: 'border border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/75',
        ghost: 'border border-transparent hover:bg-muted hover:text-foreground',
        outline: 'border bg-card text-foreground shadow-subtle hover:border-primary/40 hover:bg-muted/70',
        soft: 'border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15',
        destructive: 'border border-destructive bg-destructive text-destructive-foreground shadow-subtle hover:bg-destructive/90',
      },
      size: {
        default: 'min-h-[var(--control-height)]',
        sm: 'min-h-[var(--control-height-sm)] px-3 text-xs',
        lg: 'min-h-[var(--control-height-lg)] px-5',
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
