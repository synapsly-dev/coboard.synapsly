import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { type ReactNode } from 'react';
import { cn } from '../../lib/utils';

/** Provider — mount once near the app root so all tooltips share timing. */
export const TooltipProvider = TooltipPrimitive.Provider;

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  /** Delay before showing, ms. */
  delayDuration?: number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Optional surface override for richer tooltip/hover-card content. */
  contentClassName?: string;
  arrowClassName?: string;
}

/** Lightweight tooltip wrapper around Radix Tooltip. */
export function Tooltip({
  content,
  children,
  side = 'top',
  align = 'center',
  delayDuration = 200,
  open,
  onOpenChange,
  contentClassName,
  arrowClassName,
}: TooltipProps): JSX.Element {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration} open={open} onOpenChange={onOpenChange}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            'z-50 max-w-xs rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-md',
            'animate-popover-in',
            contentClassName,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className={cn('fill-foreground', arrowClassName)} />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
