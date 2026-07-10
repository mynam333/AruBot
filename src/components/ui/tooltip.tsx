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
            'relative z-50 max-w-[min(22rem,76vw)] overflow-hidden rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-medium leading-5 text-slate-50 shadow-lift dark:border-border dark:bg-card',
            'data-[state=delayed-open]:animate-tooltip-in data-[side=bottom]:origin-top data-[side=left]:origin-right data-[side=right]:origin-left data-[side=top]:origin-bottom',
            className,
          )}
        >
          <span className="relative z-10 block">{content}</span>
          <TooltipPrimitive.Arrow className="fill-slate-950 dark:fill-card" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
