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
  /**
   * Optional URL of an uploaded profile picture. When set, Radix shows the image
   * and auto-falls back to initials while loading or on error. Pass it only when
   * the user actually has one (e.g. `user.hasAvatar ? avatarUrl(user.id) : undefined`).
   */
  imageUrl?: string;
  size?: AvatarSize;
  className?: string;
}

/**
 * User avatar. Renders an uploaded image when `imageUrl` is provided, otherwise
 * initials on a per-user background color (§5 users.avatar_color) with a
 * contrast-safe foreground. Built on Radix Avatar, which falls back to the
 * initials automatically while the image loads or if it fails.
 */
export function Avatar({ name, color, imageUrl, size = 'md', className }: AvatarProps): JSX.Element {
  const initials = initialsFromName(name);
  const fg = readableTextColor(color);

  return (
    <AvatarPrimitive.Root
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-medium ring-1 ring-black/5 dark:ring-white/10',
        sizeClasses[size],
        className,
      )}
      title={name}
    >
      {imageUrl && (
        <AvatarPrimitive.Image
          src={imageUrl}
          alt={name}
          // Cross-fade the photo over the initials as it decodes, instead of a
          // hard pop — most visible on the always-present TopNav avatar and in
          // stacked claimant/member lists.
          className="h-full w-full object-cover motion-safe:animate-fade-in"
        />
      )}
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
