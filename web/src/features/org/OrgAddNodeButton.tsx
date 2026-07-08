import { Plus } from 'lucide-react';
import type { OrgNodeKind } from 'shared';
import { Button, type ButtonSize, type ButtonVariant } from '../../components/ui';
import { cn } from '../../lib/utils';

interface OrgAddNodeButtonProps {
  onSelectKind: (kind: OrgNodeKind) => void;
  kind?: OrgNodeKind;
  label?: string;
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

export function OrgAddNodeButton({
  onSelectKind,
  kind = 'group',
  label,
  title = kind === 'department' ? '新增部门' : '新增小组',
  variant = label ? 'primary' : 'ghost',
  size = label ? 'sm' : 'icon',
  className,
}: OrgAddNodeButtonProps): JSX.Element {
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(label ? undefined : 'h-7 w-7 rounded-full', className)}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.currentTarget.blur();
        onSelectKind(kind);
      }}
    >
      <Plus className="h-4 w-4" />
      {label && <span>{label}</span>}
    </Button>
  );
}
