import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Renders error styling and sets aria-invalid. */
  invalid?: boolean;
}

/** Single-line text input with consistent focus ring and error state. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = 'text', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      aria-invalid={invalid || undefined}
      className={cn(
        // text-base on mobile keeps the font >=16px so iOS Safari doesn't auto-zoom
        // (and jolt the fixed app shell) on focus; h-10 is a comfier touch height.
        'flex h-10 w-full rounded-md border bg-background px-3 py-1 text-base text-foreground shadow-sm transition-[background-color,border-color,box-shadow,color] duration-base ease-standard sm:h-9 sm:text-sm',
        'placeholder:text-muted-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50',
        invalid ? 'border-destructive focus-visible:ring-destructive' : 'border-input',
        className,
      )}
      {...props}
    />
  );
});
