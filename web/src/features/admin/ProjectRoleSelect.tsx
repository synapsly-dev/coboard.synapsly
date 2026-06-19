import type { ProjectRole } from 'shared';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui';
import { projectRoleLabels } from './labels';

/**
 * Reusable lead/member role picker for the admin console. Wraps the
 * SelectTrigger/Content/Item composition that the members dialog and the
 * bulk-add dialog otherwise duplicated, so the two role options stay in sync.
 */
export function ProjectRoleSelect({
  value,
  onValueChange,
  className,
  disabled,
  'aria-label': ariaLabel,
  id,
}: {
  value: ProjectRole;
  onValueChange: (role: ProjectRole) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  id?: string;
}): JSX.Element {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as ProjectRole)} disabled={disabled}>
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="member">{projectRoleLabels.member}</SelectItem>
        <SelectItem value="lead">{projectRoleLabels.lead}</SelectItem>
      </SelectContent>
    </Select>
  );
}
