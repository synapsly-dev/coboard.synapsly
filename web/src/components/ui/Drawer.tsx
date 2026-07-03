import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { Overlay } from './Overlay';

/**
 * Right-side sheet (§4 — TaskDetailDrawer). Built on Radix Dialog for the same
 * focus-trap / escape / scroll-lock semantics, but slides in from the right edge.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;

export interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /** Drawer width; defaults to a comfortable detail-panel size. */
  widthClassName?: string;
  hideClose?: boolean;
}

export const DrawerContent = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(function DrawerContent(
  { className, children, widthClassName = 'w-full sm:max-w-xl', hideClose, ...props },
  ref,
) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 right-0 z-50 flex h-full flex-col border-l border-border bg-card text-card-foreground shadow-2xl',
          'data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right',
          widthClassName,
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring sm:right-4 sm:top-4 sm:h-6 sm:w-6"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn('flex flex-col gap-1 border-b border-border px-6 py-4', className)}
      {...props}
    />
  );
}

export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={cn('scrollbar-thin flex-1 overflow-y-auto px-6 py-4', className)} {...props} />
  );
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div
      className={cn(
        // Stack full-width on phones (avoids cramped/overflowing button rows on a
        // full-width mobile drawer); a right-aligned row from sm up.
        'flex flex-col-reverse gap-2 border-t border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-end',
        className,
      )}
      {...props}
    />
  );
}

export const DrawerTitle = forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
});
