import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SpinnerProps {
  className?: string;
  /** Accessible label; visually hidden. */
  label?: string;
}

/** Indeterminate loading indicator. */
export function Spinner({ className, label = '加载中' }: SpinnerProps): JSX.Element {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center">
      <Loader2 className={cn('h-4 w-4 animate-spin text-muted-foreground', className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Full-area centered spinner for route/page-level loading states. */
export function FullPageSpinner({ label = '加载中' }: { label?: string }): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center py-24">
      <Spinner className="h-6 w-6" label={label} />
    </div>
  );
}
