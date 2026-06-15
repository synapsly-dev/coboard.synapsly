import * as AvatarPrimitive from '@radix-ui/react-avatar';
import { cn, initialsFromName, readableTextColor } from '../../lib/utils';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

const sizeClasses: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-14 w-14 text-base',
};

export interface AvatarProps {
  /** Display name — used for initials and the accessible label. */
  name: string;
  /** Hex background color (`users.avatarColor`, §5). */
  color: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * User avatar. v1 has no uploaded images, so it always renders initials on a
 * per-user background color (§5 users.avatar_color) with a contrast-safe
 * foreground. Built on Radix Avatar for a clean fallback contract.
 */
export function Avatar({ name, color, size = 'md', className }: AvatarProps): JSX.Element {
  const initials = initialsFromName(name);
  const fg = readableTextColor(color);

  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium ring-1 ring-black/5',
        sizeClasses[size],
        className,
      )}
      title={name}
    >
      <AvatarPrimitive.Fallback
        className="flex h-full w-full items-center justify-center"
        style={{ backgroundColor: color, color: fg }}
      >
        <span aria-hidden>{initials}</span>
        <span className="sr-only">{name}</span>
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}
