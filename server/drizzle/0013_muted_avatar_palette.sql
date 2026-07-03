-- Data migration: retire the saturated Tailwind rainbow avatar palette in favour
-- of the muted "quiet-luxe" set (see server/src/lib/avatarPalette.ts). Remaps each
-- legacy colour positionally (old[i] -> new[i]) so existing accounts keep their
-- distinct slot while shifting into the on-brand palette. Custom/unknown colours
-- are left untouched. Case-insensitive to tolerate any stored uppercase hex.
UPDATE "users" SET "avatar_color" = CASE lower("avatar_color")
  WHEN '#3b82f6' THEN '#96604e'
  WHEN '#10b981' THEN '#4f7377'
  WHEN '#f59e0b' THEN '#5e6e8c'
  WHEN '#ef4444' THEN '#8f7440'
  WHEN '#8b5cf6' THEN '#6f5a78'
  WHEN '#ec4899' THEN '#97606a'
  WHEN '#14b8a6' THEN '#557165'
  WHEN '#f97316' THEN '#7e6e4f'
  ELSE "avatar_color"
END
WHERE lower("avatar_color") IN (
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
);
