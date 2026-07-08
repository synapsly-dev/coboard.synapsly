import { useRef, useState } from 'react';
import { Building2, Plus, UserPlus, UsersRound } from 'lucide-react';
import type { OrgNodeKind } from 'shared';
import {
  Button,
  type ButtonSize,
  type ButtonVariant,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui';
import { cn } from '../../lib/utils';

interface OrgAddNodeButtonProps {
  onSelectKind: (kind: OrgNodeKind) => void;
  onAddMember?: () => void;
  label?: string;
  title?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  align?: 'start' | 'center' | 'end';
  className?: string;
  contentClassName?: string;
}

export function OrgAddNodeButton({
  onSelectKind,
  onAddMember,
  label,
  title = '新增节点',
  variant = label ? 'primary' : 'ghost',
  size = label ? 'sm' : 'icon',
  align = 'end',
  className,
  contentClassName,
}: OrgAddNodeButtonProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) {
      window.setTimeout(() => triggerRef.current?.blur(), 0);
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant={variant}
          size={size}
          className={cn(label ? undefined : 'h-7 w-7 rounded-full', className)}
          title={title}
          aria-label={title}
        >
          <Plus className="h-4 w-4" />
          {label && <span>{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn('min-w-[8.5rem]', contentClassName)}>
        <DropdownMenuItem onSelect={() => onSelectKind('department')}>
          <Building2 className="h-4 w-4 text-muted-foreground" />
          新增部门
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelectKind('group')}>
          <UsersRound className="h-4 w-4 text-muted-foreground" />
          新增小组
        </DropdownMenuItem>
        {onAddMember && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onAddMember}>
              <UserPlus className="h-4 w-4 text-muted-foreground" />
              加入员工
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
