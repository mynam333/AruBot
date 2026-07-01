'use client';

import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/shared/lib/utils';

export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
}: {
  children: React.ReactNode;
  content: React.ReactNode;
  side?: TooltipPrimitive.TooltipContentProps['side'];
  align?: TooltipPrimitive.TooltipContentProps['align'];
  className?: string;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          align={align}
          collisionPadding={12}
          side={side}
          sideOffset={10}
          className={cn(
            'relative z-50 max-w-[min(22rem,76vw)] overflow-hidden rounded-[var(--radius-control)] border bg-card/95 px-[clamp(0.75rem,1.4vw,1rem)] py-[clamp(0.625rem,1vw,0.8125rem)] text-xs font-semibold leading-5 text-foreground shadow-lift backdrop-blur-xl',
            'before:absolute before:inset-x-0 before:top-0 before:h-[max(0.125rem,0.16vw)] before:bg-[linear-gradient(90deg,hsl(var(--accent-sky)),hsl(var(--accent-mint)),hsl(var(--accent-coral)))]',
            'data-[state=delayed-open]:animate-tooltip-in data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom',
            className,
          )}
        >
          <span className="relative z-10 block">{content}</span>
          <TooltipPrimitive.Arrow className="fill-card stroke-border stroke-[max(0.0625rem,0.08vw)]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
