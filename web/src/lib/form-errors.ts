import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';
import type { FieldErrors } from '../api/client';

/**
 * Map an API {@link FieldErrors} map (field path → messages) onto react-hook-form's
 * `setError`, shared by every form (auth pages, admin dialogs) so the logic isn't
 * copy-pasted. Server keys may be dotted paths (e.g. `members.0.role`); the error
 * is attached to the top-level field segment, surfacing the first message.
 */
export function applyFieldErrors<T extends FieldValues>(
  fields: FieldErrors,
  setError: UseFormSetError<T>,
): void {
  for (const [path, messages] of Object.entries(fields)) {
    const message = messages[0];
    if (message) {
      setError(path.split('.')[0]! as Path<T>, { type: 'server', message });
    }
  }
}
