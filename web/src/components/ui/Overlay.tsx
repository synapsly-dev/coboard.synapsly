import * as DialogPrimitive from '@radix-ui/react-dialog';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

/**
 * Shared modal scrim used by both Dialog and Drawer (both are built on the Radix
 * Dialog primitive, §4). A dimmed, fading backdrop. `blur` adds a subtle backdrop
 * blur — the centered Dialog uses it; the edge-anchored Drawer omits it so the
 * slide stays crisp.
 */
export const Overlay = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { blur?: boolean }
>(function Overlay({ className, blur, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/40 will-change-[opacity]',
        'data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out',
        blur && 'backdrop-blur-[1px]',
        className,
      )}
      {...props}
    />
  );
});
