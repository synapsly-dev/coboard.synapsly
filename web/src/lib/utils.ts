import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge conditional class names and resolve Tailwind conflicts (last wins).
 * The canonical `cn` helper used by every UI primitive.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * URL of a user's uploaded avatar image (served by GET /api/users/:id/avatar).
 * Radix Avatar falls back to initials automatically when the user has none and
 * the request 404s, so callers can pass this unconditionally — but in practice
 * we only pass it when `user.hasAvatar` is true to avoid a wasted request.
 */
export function avatarUrl(userId: string): string {
  return `/api/users/${userId}/avatar`;
}

/**
 * Derive up-to-2-character initials from a display name for avatar fallbacks.
 * Handles CJK names (single glyph) and latin names ("Ada Lovelace" -> "AL").
 */
export function initialsFromName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  const single = parts[0]!;
  // For CJK, the first glyph is enough; for latin, take up to 2 chars.
  if (/[一-鿿]/.test(single)) {
    return single.slice(0, 1);
  }
  return single.slice(0, 2).toUpperCase();
}

/**
 * Pick a foreground color (near-black or white) with adequate contrast against a
 * given hex background. Used so avatar/badge text stays readable on any color.
 */
export function readableTextColor(hex: string): string {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return '#ffffff';
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  // Relative luminance (sRGB approximation).
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1f2937' : '#ffffff';
}
