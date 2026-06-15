import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export type BadgeVariant =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'warning'
  | 'destructive'
  | 'outline';

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning-foreground',
  destructive: 'bg-destructive/10 text-destructive',
  outline: 'border border-border text-muted-foreground',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

/** Small status / metadata pill (priority, status, counts). */
export function Badge({ className, variant = 'neutral', ...props }: BadgeProps): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium leading-none',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
